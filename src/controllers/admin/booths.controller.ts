import { Request, Response } from 'express';
import { normalizeStateCode, resolveActiveOperationalState } from '@services/operational-state.service';
import { HttpError, sendCreated, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';
import { BoothAccessService } from '@services/booth-access.service';
import { BoothAttendantAssignment } from '@models/booths/booth-attendant-assignment.model';
import { Order } from '@models/orders/order.model';
import { User } from '@models/users/user.model';
import { UserRole } from '@lib/constants';
import { hashPassword } from '@lib/security';
import { auditAdminAction } from '@lib/audit';
import { randomBytes } from 'crypto';

// Nested populate (fieldAgent → user) isn't supported by MongoRepository,
// so booths join their attendant agent in memory.
async function attachAgents(booths: any[]): Promise<any[]> {
  const agents = await adminRepos.fieldAgents().find({ relations: { agent: true } });
  const agentById = new Map((agents as any[]).map((agent) => [agent.id, agent]));
  return booths.map((booth) => ({
    ...booth,
    fieldAgent: booth.fieldAgentId ? agentById.get(booth.fieldAgentId) || null : null,
  }));
}

export class AdminBoothsController {
  private readonly boothAccess = new BoothAccessService();
  list = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const stateCode = normalizeStateCode(req.query.stateCode);
    const where: Record<string, unknown> = {};
    if (stateCode) where['location.stateCode'] = stateCode;
    const [data, total] = await adminRepos.booths().findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
    sendSuccess(res, paginated(await attachAgents(data as any[]), total, page, limit));
  };

  analytics = async (_req: Request, res: Response) => {
    const booths = await adminRepos.booths().find({});
    const rows = booths as any[];
    const active = rows.filter((booth) => booth.isActive).length;
    sendSuccess(res, {
      total: rows.length,
      active,
      inactive: rows.length - active,
      withAgent: rows.filter((booth) => booth.fieldAgentId).length,
      phygital: rows.filter((booth) => booth.boothType === 'phygital').length,
      microHub: rows.filter((booth) => booth.boothType === 'micro_hub').length,
    });
  };

  detail = async (req: Request, res: Response) => {
    const booth = await adminRepos.booths().findOne({ where: { id: routeParam(req.params.id) } });
    if (!booth) throw new HttpError(404, 'Booth not found');
    const [enriched] = await attachAgents([booth]);
    const inventory = await adminRepos.boothInventory().find({ where: { boothId: booth.id, isActive: true }, relations: { product: true, vendor: true } });
    const [attendant, assignmentHistory, orders] = await Promise.all([
      booth.attendantUserId ? User.findById(booth.attendantUserId).select('firstName lastName email phone role isActive').lean({ virtuals: true }) : null,
      BoothAttendantAssignment.find({ boothId: booth.id }).sort({ assignedAt: -1 }).lean({ virtuals: true }),
      Order.find({ boothId: booth.id }).sort({ createdAt: -1 }).limit(50).lean({ virtuals: true }),
    ]);
    const paidOrders = orders.filter((order) => ['successful', 'partially_refunded', 'refunded'].includes(String(order.paymentStatus)));
    const metrics = {
      orders: orders.length,
      gmv: paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0),
      refunds: paidOrders.reduce((sum, order) => sum + (String(order.paymentStatus).includes('refunded') ? Number(order.total || 0) : 0), 0),
      payNow: orders.filter((order) => order.paymentMode === 'pay_now').length,
      payOnDelivery: orders.filter((order) => order.paymentMode === 'pay_on_delivery').length,
      conversionRate: 0,
    };
    sendSuccess(res, { ...enriched, attendant, assignmentHistory, inventory, orders, metrics });
  };

  status = async (req: Request, res: Response) => {
    const repo = adminRepos.booths();
    const booth = await repo.findOne({ where: { id: routeParam(req.params.id) } });
    if (!booth) throw new HttpError(404, 'Booth not found');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    booth.isActive = typeof body.isActive === 'boolean' ? body.isActive : !booth.isActive;
    await repo.save(booth);
    sendSuccess(res, { id: booth.id, isActive: booth.isActive });
  };

  create = async (req: Request, res: Response) => {
    const repo = adminRepos.booths();
    const payload = { ...req.body, location: { ...req.body.location } };
    delete payload.newAttendant;
    if (payload.location?.stateCode) {
      const state = await resolveActiveOperationalState(payload.location.stateCode);
      payload.location.stateCode = state.stateCode;
      payload.location.stateName = state.stateName;
    }
    if (req.body.newAttendant && await User.exists({ email: req.body.newAttendant.email.toLowerCase().trim() })) {
      throw new HttpError(409, 'An account already exists with the attendant email');
    }
    const code = await this.boothAccess.generateUniqueCode();
    const qr = this.boothAccess.generateQrCredential();
    Object.assign(payload, {
      accessCodeDigest: this.boothAccess.digestCode(code), accessCodeVersion: 1, accessCodeRotatedAt: new Date(),
      qrPublicId: qr.publicId, qrTokenHash: qr.tokenDigest, qrVersion: 1, qrRotatedAt: new Date(),
      lastCredentialRotationActorId: req.user!.sub,
    });
    const booth = await repo.save(repo.create(payload));
    let attendantUserId = req.body.attendantUserId;
    if (!attendantUserId && req.body.fieldAgentId) {
      const fieldAgent = await adminRepos.fieldAgents().findOne({ where: { id: req.body.fieldAgentId } });
      attendantUserId = fieldAgent?.agentId;
    }
    if (req.body.newAttendant) {
      const input = req.body.newAttendant;
      const attendant = await User.create({ ...input, email: input.email.toLowerCase().trim(), password: await hashPassword(randomBytes(12).toString('base64url')), role: UserRole.FIELD_AGENT, isActive: true, isEmailVerified: true, isPhoneVerified: false });
      attendantUserId = attendant.id;
    }
    if (attendantUserId) await this.assignAttendant(booth.id, attendantUserId, req.user!.sub);
    const safeBooth: any = { ...booth };
    delete safeBooth.accessCodeDigest;
    delete safeBooth.qrTokenHash;
    sendCreated(res, { booth: safeBooth, accessCode: code, qrToken: qr.token, qrScanPath: `/api/v1/booths/scan/${qr.publicId}?token=${qr.token}` });
  };

  setAttendant = async (req: Request, res: Response) => {
    const boothId = routeParam(req.params.id);
    const attendant = req.body.attendantUserId
      ? await User.findById(req.body.attendantUserId)
      : await User.create({
        email: req.body.email.toLowerCase().trim(), firstName: req.body.firstName, lastName: req.body.lastName,
        phone: req.body.phone, password: await hashPassword(req.body.password || randomBytes(12).toString('base64url')),
        role: UserRole.FIELD_AGENT, isActive: true, isEmailVerified: true, isPhoneVerified: false,
      });
    if (!attendant) throw new HttpError(404, 'Attendant not found');
    if (![UserRole.FIELD_AGENT, UserRole.SUPPORT].includes(attendant.role) || !attendant.isActive || !attendant.phone || !attendant.firstName || !attendant.lastName) {
      throw new HttpError(409, 'Attendant must be an active field agent or support user with a verified profile and phone number');
    }
    await this.assignAttendant(boothId, attendant.id, req.user!.sub);
    await auditAdminAction(req, 'booth.attendant.assign', 'booth', boothId, { attendantUserId: attendant.id });
    sendSuccess(res, { attendant: attendant.toJSON() });
  };

  releaseAttendant = async (req: Request, res: Response) => {
    const boothId = routeParam(req.params.id);
    const booth = await adminRepos.booths().findOne({ where: { id: boothId } });
    if (!booth) throw new HttpError(404, 'Booth not found');
    await BoothAttendantAssignment.updateOne({ boothId, releasedAt: { $exists: false } }, { $set: { releasedAt: new Date(), releasedBy: req.user!.sub } });
    booth.attendantUserId = undefined;
    booth.fieldAgentId = undefined;
    await adminRepos.booths().save(booth);
    await auditAdminAction(req, 'booth.attendant.release', 'booth', boothId, {});
    sendSuccess(res, { released: true });
  };

  private async assignAttendant(boothId: string, attendantUserId: string, actorId: string) {
    const booth = await adminRepos.booths().findOne({ where: { id: boothId } });
    const attendant = await User.findById(attendantUserId);
    if (!booth || !attendant) throw new HttpError(404, 'Booth or attendant not found');
    await BoothAttendantAssignment.updateMany({ boothId, releasedAt: { $exists: false } }, { $set: { releasedAt: new Date(), releasedBy: actorId } });
    await BoothAttendantAssignment.create({ boothId, attendantUserId, attendantName: `${attendant.firstName} ${attendant.lastName}`.trim(), attendantEmail: attendant.email, attendantPhone: attendant.phone, assignedAt: new Date(), assignedBy: actorId });
    booth.attendantUserId = attendantUserId;
    await adminRepos.booths().save(booth);
  }
}
