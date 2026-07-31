import { createHash } from 'crypto';
import { Request, Response } from 'express';
import { PaymentService } from '@services/payment.service';
import { HttpError, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';
import { auditAdminAction } from '@lib/audit';

export class AdminCommerceController {
  private paymentService = new PaymentService(adminRepos.payments(), adminRepos.orders(), adminRepos.escrowLedger());

  deletionRequests = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const [data, total] = await adminRepos.deletionRequests().findAndCount({ order: { createdAt: 'DESC' }, skip, take: limit, relations: { user: true } });
    sendSuccess(res, paginated(data, total, page, limit));
  };

  updateDeletion = async (req: Request, res: Response) => {
    const request = await adminRepos.deletionRequests().findOne({ where: { id: routeParam(req.params.id) } });
    if (!request) throw new HttpError(404, 'Deletion request not found');
    if (req.body.status === 'anonymized') {
      if (!request.identityVerifiedAt) throw new HttpError(409, 'Identity must be verified before anonymization');
      if (request.coolingOffUntil > new Date()) throw new HttpError(409, 'The deletion cooling-off period has not ended');
      const user = await adminRepos.users().findOne({ where: { id: request.userId } });
      if (!user) throw new HttpError(404, 'User not found');
      const anonymousKey = createHash('sha256').update(user.id).digest('hex').slice(0, 16);
      Object.assign(user, {
        email: `deleted-${anonymousKey}@anonymized.hook`, phone: undefined, password: undefined,
        googleId: undefined, firstName: 'Deleted', lastName: 'User', avatarUrl: undefined,
        address: undefined, preferences: undefined, refreshToken: undefined,
        isActive: false, isEmailVerified: false, isPhoneVerified: false,
        accountStatus: 'anonymized', deletedAt: new Date(),
      });
      await adminRepos.users().save(user);
      request.anonymizedAt = new Date();
    }
    Object.assign(request, req.body);
    if (req.body.status === 'identity_verified') request.identityVerifiedAt = new Date();
    await adminRepos.deletionRequests().save(request);
    await auditAdminAction(req, 'account_deletion.update', 'account_deletion', request.id, { status: request.status });
    sendSuccess(res, request);
  };

  refundRequests = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const where: Record<string, unknown> = {};
    if (typeof req.query.status === 'string') where.status = req.query.status;
    const [data, total] = await adminRepos.refundRequests().findAndCount({ where, order: { createdAt: 'DESC' }, skip, take: limit });
    sendSuccess(res, paginated(data, total, page, limit));
  };

  reviewRefund = async (req: Request, res: Response) => {
    const request = await adminRepos.refundRequests().findOne({ where: { id: routeParam(req.params.id) } });
    if (!request) throw new HttpError(404, 'Refund request not found');
    if (!['requested', 'under_review'].includes(request.status)) throw new HttpError(409, 'This refund request has already been decided');
    request.status = req.body.status;
    request.assignedSupportUserId = req.body.assignedSupportUserId || req.user!.sub;
    request.decisionNote = req.body.decisionNote;
    request.decidedBy = req.body.status === 'rejected' ? req.user!.sub : undefined;
    request.auditHistory.push({ action: req.body.status, actorId: req.user!.sub, note: req.body.decisionNote, at: new Date() });
    await adminRepos.refundRequests().save(request);
    await auditAdminAction(req, `refund.${req.body.status}`, 'refund_request', request.id, { orderId: request.orderId });
    sendSuccess(res, request);
  };

  approveRefund = async (req: Request, res: Response) => {
    const request = await adminRepos.refundRequests().findOne({ where: { id: routeParam(req.params.id) } });
    if (!request) throw new HttpError(404, 'Refund request not found');
    if (!['requested', 'under_review', 'approved'].includes(request.status)) throw new HttpError(409, 'This refund request cannot be approved');
    if (!request.paymentId) throw new HttpError(409, 'The captured payment could not be resolved');
    request.status = 'provider_pending';
    request.decidedBy = req.user!.sub;
    request.decisionNote = req.body.reason;
    request.auditHistory.push({ action: 'approved', actorId: req.user!.sub, at: new Date() });
    await adminRepos.refundRequests().save(request);
    const event = await this.paymentService.refund(request.paymentId, request.amount, request.idempotencyKey);
    request.status = 'refunded';
    request.providerReference = event.providerReference;
    request.auditHistory.push({ action: 'refunded', actorId: req.user!.sub, at: new Date(), providerReference: event.providerReference });
    await adminRepos.refundRequests().save(request);
    await auditAdminAction(req, 'refund.approve', 'refund_request', request.id, { amount: request.amount, orderId: request.orderId });
    sendSuccess(res, request);
  };

  checkoutAnalytics = async (_req: Request, res: Response) => {
    const events = await adminRepos.checkoutEvents().find({});
    const counts = (events as any[]).reduce((out, event) => ({ ...out, [event.event]: (out[event.event] || 0) + 1 }), {} as Record<string, number>);
    const payNow = (events as any[]).filter((event) => event.event === 'payment_method_selected' && event.paymentMode === 'pay_now').length;
    const pod = (events as any[]).filter((event) => event.event === 'payment_method_selected' && event.paymentMode === 'pay_on_delivery').length;
    sendSuccess(res, { counts, paymentSelection: { payNow, payOnDelivery: pod }, totalSessions: new Set((events as any[]).map((event) => event.sessionId)).size });
  };
}
