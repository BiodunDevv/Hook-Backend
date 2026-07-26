import { Request, Response } from 'express';
import { isValidObjectId, Model } from 'mongoose';
import { AccountStatus, AccountType, ScopeType, UserRole } from '@lib/constants';
import { getPagination, paginated, routeParam } from '@lib/api-utils';
import { hashPassword } from '@lib/security';
import { Permission, Role } from '@models/platform/access.model';
import { PlatformAuditLog } from '@models/platform/audit-log.model';
import { PublicIdCounter } from '@models/platform/counter.model';
import { OperationCity, OperationState, ServiceZone } from '@models/platform/geography.model';
import { DispatchHub, Market } from '@models/platform/network.model';
import {
  HookPartner,
  RunnerMarketAssignment,
  RunnerProfile,
  StaffProfile,
} from '@models/platform/operations-accounts.model';
import { User } from '@models/users/user.model';
import { assertPermission, assertScope, resolveAccessContext, scopedFilter } from '@services/access-control.service';
import { revokeAccountSessions } from '@services/account-session.service';
import { recordAudit } from '@services/platform-audit.service';
import { nextPublicId, repairPublicIdCounter, PublicIdDomain } from '@services/public-id.service';
import { issueAccountInvitation } from '@services/account-invitation.service';
import { HttpError, sendCreated, sendSuccess } from '@utils/http';

async function byIdentifier<T>(model: Model<T>, identifier: string) {
  const query = isValidObjectId(identifier)
    ? { $or: [{ _id: identifier }, { publicId: identifier }] }
    : { publicId: identifier };
  const record = await model.findOne(query).lean({ virtuals: true });
  if (!record) throw new HttpError(404, 'Record not found', undefined, 'NOT_FOUND');
  return record as T & { id: string; _id: { toString(): string }; publicId?: string };
}

function stateAndHub(req: Request) {
  return {
    stateId: req.platformContext?.stateId || (req.query.stateId as string | undefined),
    hubId: req.platformContext?.hubId || (req.query.hubId as string | undefined),
  };
}

async function access(req: Request, permission: string) {
  const context = await resolveAccessContext(req.user!.sub);
  assertPermission(context, permission);
  return context;
}

async function listScoped<T>(
  req: Request,
  model: Model<T>,
  permission: string,
  extra: Record<string, unknown> = {},
) {
  const context = await access(req, permission);
  const { stateId, hubId } = stateAndHub(req);
  const { page, limit, skip } = getPagination(req.query);
  const filter = scopedFilter<T>(context, extra, stateId, hubId);
  const [data, total] = await Promise.all([
    model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean({ virtuals: true }),
    model.countDocuments(filter),
  ]);
  return paginated(data, total, page, limit);
}

async function detailScoped<T>(
  req: Request,
  model: Model<T>,
  permission: string,
  identifier = routeParam(req.params.id),
) {
  const context = await access(req, permission);
  const record = await byIdentifier(model, identifier);
  const scopedRecord = record as Record<string, any>;
  assertScope(context, scopedRecord.stateId, scopedRecord.hubId || scopedRecord.preferredHubId);
  return record;
}

async function ensureState(id: string, active = false) {
  const state = await byIdentifier(OperationState, id);
  if (active && state.status !== 'active') throw new HttpError(409, 'Operation State is not active', undefined, 'CONFLICT');
  return state;
}

async function ensureCity(id: string, stateId: string, active = false) {
  const city = await byIdentifier(OperationCity, id);
  if (city.stateId !== stateId) throw new HttpError(409, 'City does not belong to the selected state', undefined, 'CONFLICT');
  if (active && city.status !== 'active') throw new HttpError(409, 'Operation City is not active', undefined, 'CONFLICT');
  return city;
}

async function ensureHub(id: string, stateId: string) {
  const hub = await byIdentifier(DispatchHub, id);
  if (hub.stateId !== stateId) throw new HttpError(409, 'Dispatch Hub does not belong to the selected state', undefined, 'CONFLICT');
  return hub;
}

async function lifecycle(
  req: Request,
  res: Response,
  model: Model<any>,
  permission: string,
  entityType: string,
  status: string,
) {
  await access(req, permission);
  const record = await byIdentifier(model, routeParam(req.params.id));
  const context = await resolveAccessContext(req.user!.sub);
  const stateId = entityType === 'state' ? record._id.toString() : record.stateId;
  assertScope(context, stateId, record.hubId);
  const before = { status: record.status };
  const updated = await model.findByIdAndUpdate(
    record._id,
    { $set: { status } },
    { returnDocument: 'after' },
  ).lean({ virtuals: true });
  await recordAudit(req, {
    action: `${entityType}.${status}`,
    entityType,
    entityId: record._id.toString(),
    entityPublicId: record.publicId,
    stateId,
    hubId: record.hubId,
    before,
    after: { status },
    reason: req.body.reason,
  });
  sendSuccess(res, updated);
}

export class PlatformController {
  permissions = async (_req: Request, res: Response) => {
    sendSuccess(res, await Permission.find({ isActive: true }).sort({ domain: 1, key: 1 }).lean({ virtuals: true }));
  };

  roles = async (_req: Request, res: Response) => {
    sendSuccess(res, await Role.find().sort({ name: 1 }).lean({ virtuals: true }));
  };

  roleDetail = async (req: Request, res: Response) => sendSuccess(res, await byIdentifier(Role, routeParam(req.params.id)));

  createRole = async (req: Request, res: Response) => {
    await access(req, 'roles.manage');
    const role = await Role.create({ ...req.body, key: req.body.key.toUpperCase() });
    await recordAudit(req, { action: 'role.created', entityType: 'role', entityId: role.id, after: role.toObject() });
    sendCreated(res, role);
  };

  updateRole = async (req: Request, res: Response) => {
    await access(req, 'roles.manage');
    const role = await byIdentifier(Role, routeParam(req.params.id));
    if (role.isSystem && req.body.key && req.body.key !== role.key) {
      throw new HttpError(409, 'System role keys cannot be changed', undefined, 'CONFLICT');
    }
    const updated = await Role.findByIdAndUpdate(role._id, { $set: req.body }, { returnDocument: 'after' }).lean({ virtuals: true });
    await recordAudit(req, { action: 'role.updated', entityType: 'role', entityId: role._id.toString(), before: role, after: updated, reason: req.body.reason });
    sendSuccess(res, updated);
  };

  listStaff = async (req: Request, res: Response) => {
    const context = await access(req, 'staff.view');
    const { page, limit, skip } = getPagination(req.query);
    const filter = context.scopeType === ScopeType.GLOBAL ? {} : { stateIds: { $in: context.stateIds } };
    const [data, total] = await Promise.all([StaffProfile.find(filter).skip(skip).limit(limit).lean({ virtuals: true }), StaffProfile.countDocuments(filter)]);
    sendSuccess(res, paginated(data, total, page, limit));
  };

  staffDetail = async (req: Request, res: Response) => {
    await access(req, 'staff.view');
    const profile = await byIdentifier(StaffProfile, routeParam(req.params.id));
    const context = await resolveAccessContext(req.user!.sub);
    for (const stateId of profile.stateIds) assertScope(context, stateId);
    const [account, roles] = await Promise.all([
      User.findById(profile.accountId).select('-password -refreshToken').lean({ virtuals: true }),
      Role.find({ _id: { $in: profile.roleIds } }).lean({ virtuals: true }),
    ]);
    sendSuccess(res, { ...profile, account, roles });
  };

  createStaff = async (req: Request, res: Response) => {
    const context = await access(req, 'staff.create');
    for (const stateId of req.body.stateIds || []) assertScope(context, stateId);
    for (const hubId of req.body.hubIds || []) assertScope(context, undefined, hubId);
    const publicId = await nextPublicId('staff');
    const account = await User.create({
      publicId,
      accountType: AccountType.STAFF,
      accountStatus: AccountStatus.INVITED,
      email: req.body.email,
      phone: req.body.phone,
      password: req.body.password ? await hashPassword(req.body.password) : undefined,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      role: UserRole.SUPPORT,
      roleIds: req.body.roleIds,
      scopeType: req.body.scopeType,
      assignedStateIds: req.body.stateIds,
      assignedHubIds: req.body.hubIds,
      isEmailVerified: false,
      isPhoneVerified: false,
      isActive: true,
    });
    const profile = await StaffProfile.create({
      publicId,
      accountId: account.id,
      roleIds: req.body.roleIds,
      scopeType: req.body.scopeType,
      stateIds: req.body.stateIds,
      hubIds: req.body.hubIds,
      status: AccountStatus.INVITED,
    });
    const invitation = await issueAccountInvitation({
      accountId: account.id,
      accountType: AccountType.STAFF,
      email: account.email,
      name: `${account.firstName} ${account.lastName}`.trim(),
      invitedBy: req.user!.sub,
    });
    await recordAudit(req, { action: 'staff.created', entityType: 'staff', entityId: profile.id, entityPublicId: publicId, after: profile.toObject() });
    sendCreated(res, { ...profile.toObject(), account: account.toJSON(), invitation });
  };

  updateStaff = async (req: Request, res: Response) => {
    const context = await access(req, 'staff.edit');
    const profile = await byIdentifier(StaffProfile, routeParam(req.params.id));
    for (const stateId of req.body.stateIds || profile.stateIds) assertScope(context, stateId);
    const patch = {
      ...(req.body.roleIds && { roleIds: req.body.roleIds }),
      ...(req.body.scopeType && { scopeType: req.body.scopeType }),
      ...(req.body.stateIds && { stateIds: req.body.stateIds }),
      ...(req.body.hubIds && { hubIds: req.body.hubIds }),
    };
    const updated = await StaffProfile.findByIdAndUpdate(profile._id, { $set: patch }, { returnDocument: 'after' }).lean({ virtuals: true });
    await User.updateOne({ _id: profile.accountId }, {
      $set: {
        ...(req.body.roleIds && { roleIds: req.body.roleIds }),
        ...(req.body.scopeType && { scopeType: req.body.scopeType }),
        ...(req.body.stateIds && { assignedStateIds: req.body.stateIds }),
        ...(req.body.hubIds && { assignedHubIds: req.body.hubIds }),
      },
    });
    await recordAudit(req, { action: 'staff.updated', entityType: 'staff', entityId: profile._id.toString(), entityPublicId: profile.publicId, before: profile, after: updated, reason: req.body.reason });
    sendSuccess(res, updated);
  };

  staffStatus = async (req: Request, res: Response) => {
    await access(req, 'staff.suspend');
    const profile = await byIdentifier(StaffProfile, routeParam(req.params.id));
    const status = req.path.endsWith('/reactivate') ? AccountStatus.ACTIVE : AccountStatus.SUSPENDED;
    const active = status === AccountStatus.ACTIVE;
    await Promise.all([
      StaffProfile.updateOne({ _id: profile._id }, { $set: { status } }),
      User.updateOne({ _id: profile.accountId }, { $set: { accountStatus: status, isActive: active } }),
      active ? Promise.resolve() : revokeAccountSessions(profile.accountId, 'staff_suspended', req.user!.sub),
    ]);
    await recordAudit(req, { action: `staff.${status}`, entityType: 'staff', entityId: profile._id.toString(), entityPublicId: profile.publicId, before: { status: profile.status }, after: { status }, reason: req.body.reason });
    sendSuccess(res, { status });
  };

  revokeStaffSessions = async (req: Request, res: Response) => {
    await access(req, 'staff.revoke_sessions');
    const profile = await byIdentifier(StaffProfile, routeParam(req.params.id));
    await revokeAccountSessions(profile.accountId, req.body.reason || 'administrative_revocation', req.user!.sub);
    await recordAudit(req, { action: 'staff.sessions_revoked', entityType: 'staff', entityId: profile._id.toString(), entityPublicId: profile.publicId, reason: req.body.reason });
    sendSuccess(res, { revoked: true });
  };

  resendStaffInvitation = async (req: Request, res: Response) => {
    await access(req, 'staff.create');
    const profile = await byIdentifier(StaffProfile, routeParam(req.params.id));
    const account = await User.findById(profile.accountId);
    if (!account || profile.status !== AccountStatus.INVITED) {
      throw new HttpError(409, 'Only invited staff accounts can receive a new invitation', undefined, 'CONFLICT');
    }
    const invitation = await issueAccountInvitation({
      accountId: account.id,
      accountType: AccountType.STAFF,
      email: account.email,
      name: `${account.firstName} ${account.lastName}`.trim(),
      invitedBy: req.user!.sub,
    });
    await recordAudit(req, { action: 'staff.invitation_resent', entityType: 'staff', entityId: profile._id.toString(), entityPublicId: profile.publicId });
    sendSuccess(res, invitation);
  };

  listStates = async (req: Request, res: Response) => {
    const context = await access(req, 'states.view');
    const { page, limit, skip } = getPagination(req.query);
    const filter = context.scopeType === ScopeType.GLOBAL ? {} : { _id: { $in: context.stateIds } };
    const [data, total] = await Promise.all([OperationState.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean({ virtuals: true }), OperationState.countDocuments(filter)]);
    sendSuccess(res, paginated(data, total, page, limit));
  };
  stateDetail = async (req: Request, res: Response) => {
    const context = await access(req, 'states.view');
    const state = await byIdentifier(OperationState, routeParam(req.params.id));
    assertScope(context, state._id.toString());
    sendSuccess(res, state);
  };
  createState = async (req: Request, res: Response) => {
    await access(req, 'states.manage');
    const state = await OperationState.create({ ...req.body, publicId: await nextPublicId('state') });
    await recordAudit(req, { action: 'state.created', entityType: 'state', entityId: state.id, entityPublicId: state.publicId, stateId: state.id, after: state.toObject() });
    sendCreated(res, state);
  };
  updateState = async (req: Request, res: Response) => {
    const context = await access(req, 'states.manage');
    const state = await byIdentifier(OperationState, routeParam(req.params.id));
    assertScope(context, state._id.toString());
    const updated = await OperationState.findByIdAndUpdate(state._id, { $set: req.body }, { returnDocument: 'after' }).lean({ virtuals: true });
    await recordAudit(req, { action: 'state.updated', entityType: 'state', entityId: state._id.toString(), entityPublicId: state.publicId, stateId: state._id.toString(), before: state, after: updated, reason: req.body.reason });
    sendSuccess(res, updated);
  };
  stateStatus = (req: Request, res: Response) => lifecycle(req, res, OperationState, 'states.manage', 'state', req.path.endsWith('/activate') ? 'active' : 'inactive');

  listCities = async (req: Request, res: Response) => sendSuccess(res, await listScoped(req, OperationCity, 'cities.view'));
  cityDetail = async (req: Request, res: Response) => sendSuccess(res, await detailScoped(req, OperationCity, 'cities.view'));
  createCity = async (req: Request, res: Response) => {
    const context = await access(req, 'cities.manage');
    const state = await ensureState(req.body.stateId, true);
    assertScope(context, state._id.toString());
    const city = await OperationCity.create({ ...req.body, stateId: state._id.toString(), publicId: await nextPublicId('city') });
    await recordAudit(req, { action: 'city.created', entityType: 'city', entityId: city.id, entityPublicId: city.publicId, stateId: city.stateId, after: city.toObject() });
    sendCreated(res, city);
  };
  updateCity = async (req: Request, res: Response) => {
    await access(req, 'cities.manage');
    const city = await byIdentifier(OperationCity, routeParam(req.params.id));
    const context = await resolveAccessContext(req.user!.sub); assertScope(context, city.stateId);
    const updated = await OperationCity.findByIdAndUpdate(city._id, { $set: req.body }, { returnDocument: 'after' }).lean({ virtuals: true });
    await recordAudit(req, { action: 'city.updated', entityType: 'city', entityId: city._id.toString(), entityPublicId: city.publicId, stateId: city.stateId, before: city, after: updated, reason: req.body.reason });
    sendSuccess(res, updated);
  };
  cityStatus = (req: Request, res: Response) => lifecycle(req, res, OperationCity, 'cities.manage', 'city', req.path.endsWith('/activate') ? 'active' : 'inactive');

  listZones = async (req: Request, res: Response) => sendSuccess(res, await listScoped(req, ServiceZone, 'zones.view'));
  zoneDetail = async (req: Request, res: Response) => sendSuccess(res, await detailScoped(req, ServiceZone, 'zones.view'));
  createZone = async (req: Request, res: Response) => {
    const context = await access(req, 'zones.manage');
    const state = await ensureState(req.body.stateId, true);
    const city = await ensureCity(req.body.cityId, state._id.toString(), true);
    assertScope(context, state._id.toString());
    const zone = await ServiceZone.create({ ...req.body, stateId: state._id.toString(), cityId: city._id.toString(), publicId: await nextPublicId('zone') });
    await recordAudit(req, { action: 'zone.created', entityType: 'zone', entityId: zone.id, entityPublicId: zone.publicId, stateId: zone.stateId, after: zone.toObject() });
    sendCreated(res, zone);
  };
  updateZone = async (req: Request, res: Response) => {
    await access(req, 'zones.manage');
    const zone = await byIdentifier(ServiceZone, routeParam(req.params.id));
    const context = await resolveAccessContext(req.user!.sub); assertScope(context, zone.stateId);
    const updated = await ServiceZone.findByIdAndUpdate(zone._id, { $set: req.body }, { returnDocument: 'after' }).lean({ virtuals: true });
    await recordAudit(req, { action: 'zone.updated', entityType: 'zone', entityId: zone._id.toString(), entityPublicId: zone.publicId, stateId: zone.stateId, before: zone, after: updated, reason: req.body.reason });
    sendSuccess(res, updated);
  };
  zoneStatus = (req: Request, res: Response) => lifecycle(req, res, ServiceZone, 'zones.manage', 'zone', req.path.endsWith('/activate') ? 'active' : 'inactive');

  listMarkets = async (req: Request, res: Response) => sendSuccess(res, await listScoped(req, Market, 'markets.view'));
  marketDetail = async (req: Request, res: Response) => sendSuccess(res, await detailScoped(req, Market, 'markets.view'));
  createMarket = async (req: Request, res: Response) => {
    const context = await access(req, 'markets.manage');
    const state = await ensureState(req.body.stateId, true);
    const city = await ensureCity(req.body.cityId, state._id.toString(), true);
    assertScope(context, state._id.toString());
    if (req.body.hubId) await ensureHub(req.body.hubId, state._id.toString());
    const market = await Market.create({
      ...req.body,
      publicId: await nextPublicId('market'),
      stateId: state._id.toString(),
      cityId: city._id.toString(),
      normalizedName: req.body.name.trim().toLowerCase(),
    });
    await recordAudit(req, { action: 'market.created', entityType: 'market', entityId: market.id, entityPublicId: market.publicId, stateId: market.stateId, hubId: market.hubId, after: market.toObject() });
    sendCreated(res, market);
  };
  updateMarket = async (req: Request, res: Response) => {
    await access(req, 'markets.manage');
    const market = await byIdentifier(Market, routeParam(req.params.id));
    const context = await resolveAccessContext(req.user!.sub); assertScope(context, market.stateId, market.hubId);
    if (req.body.hubId) await ensureHub(req.body.hubId, market.stateId);
    const updated = await Market.findByIdAndUpdate(market._id, { $set: { ...req.body, ...(req.body.name && { normalizedName: req.body.name.trim().toLowerCase() }) } }, { returnDocument: 'after' }).lean({ virtuals: true });
    await recordAudit(req, { action: 'market.updated', entityType: 'market', entityId: market._id.toString(), entityPublicId: market.publicId, stateId: market.stateId, hubId: market.hubId, before: market, after: updated, reason: req.body.reason });
    sendSuccess(res, updated);
  };
  marketStatus = (req: Request, res: Response) => lifecycle(req, res, Market, 'markets.manage', 'market', req.path.endsWith('/activate') ? 'active' : 'inactive');
  assignMarketHub = async (req: Request, res: Response) => {
    await access(req, 'markets.assign_hub');
    const market = await byIdentifier(Market, routeParam(req.params.id));
    const hub = await ensureHub(req.body.hubId, market.stateId);
    const updated = await Market.findByIdAndUpdate(market._id, { $set: { hubId: hub._id.toString() } }, { returnDocument: 'after' }).lean({ virtuals: true });
    await recordAudit(req, { action: 'market.hub_assigned', entityType: 'market', entityId: market._id.toString(), entityPublicId: market.publicId, stateId: market.stateId, hubId: hub._id.toString(), before: { hubId: market.hubId }, after: { hubId: hub._id.toString() }, reason: req.body.reason });
    sendSuccess(res, updated);
  };

  listHubs = async (req: Request, res: Response) => sendSuccess(res, await listScoped(req, DispatchHub, 'hubs.view'));
  hubDetail = async (req: Request, res: Response) => sendSuccess(res, await detailScoped(req, DispatchHub, 'hubs.view'));
  createHub = async (req: Request, res: Response) => {
    const context = await access(req, 'hubs.manage');
    const state = await ensureState(req.body.stateId, true);
    const city = await ensureCity(req.body.cityId, state._id.toString(), true);
    assertScope(context, state._id.toString());
    const hub = await DispatchHub.create({ ...req.body, publicId: await nextPublicId('hub'), stateId: state._id.toString(), cityId: city._id.toString() });
    await recordAudit(req, { action: 'hub.created', entityType: 'hub', entityId: hub.id, entityPublicId: hub.publicId, stateId: hub.stateId, hubId: hub.id, after: hub.toObject() });
    sendCreated(res, hub);
  };
  updateHub = async (req: Request, res: Response) => {
    await access(req, 'hubs.manage');
    const hub = await byIdentifier(DispatchHub, routeParam(req.params.id));
    const context = await resolveAccessContext(req.user!.sub); assertScope(context, hub.stateId, hub._id.toString());
    const updated = await DispatchHub.findByIdAndUpdate(hub._id, { $set: req.body }, { returnDocument: 'after' }).lean({ virtuals: true });
    await recordAudit(req, { action: 'hub.updated', entityType: 'hub', entityId: hub._id.toString(), entityPublicId: hub.publicId, stateId: hub.stateId, hubId: hub._id.toString(), before: hub, after: updated, reason: req.body.reason });
    sendSuccess(res, updated);
  };
  hubStatus = (req: Request, res: Response) => lifecycle(req, res, DispatchHub, 'hubs.manage', 'hub', req.path.endsWith('/activate') ? 'active' : 'inactive');
  assignHubMarkets = async (req: Request, res: Response) => {
    await access(req, 'hubs.assign_markets');
    const hub = await byIdentifier(DispatchHub, routeParam(req.params.id));
    const markets = await Market.find({ _id: { $in: req.body.marketIds } }).lean();
    if (markets.length !== req.body.marketIds.length || markets.some((market) => market.stateId !== hub.stateId)) {
      throw new HttpError(409, 'Every Market must belong to the Dispatch Hub state', undefined, 'CONFLICT');
    }
    await Promise.all([
      DispatchHub.updateOne({ _id: hub._id }, { $set: { marketIds: req.body.marketIds } }),
      Market.updateMany({ _id: { $in: req.body.marketIds } }, { $set: { hubId: hub._id.toString() } }),
    ]);
    await recordAudit(req, { action: 'hub.markets_assigned', entityType: 'hub', entityId: hub._id.toString(), entityPublicId: hub.publicId, stateId: hub.stateId, hubId: hub._id.toString(), before: { marketIds: hub.marketIds }, after: { marketIds: req.body.marketIds }, reason: req.body.reason });
    sendSuccess(res, { marketIds: req.body.marketIds });
  };

  listPartners = async (req: Request, res: Response) => sendSuccess(res, await listScoped(req, HookPartner, 'partners.view'));
  partnerDetail = async (req: Request, res: Response) => sendSuccess(res, await detailScoped(req, HookPartner, 'partners.view'));
  createPartner = async (req: Request, res: Response) => {
    const context = await access(req, 'partners.manage');
    const state = await ensureState(req.body.stateId, true);
    const city = await ensureCity(req.body.cityId, state._id.toString(), true);
    assertScope(context, state._id.toString());
    const publicId = await nextPublicId('partner');
    const account = await User.create({
      publicId, accountType: AccountType.PARTNER, accountStatus: AccountStatus.INVITED,
      email: req.body.email, phone: req.body.phone, password: req.body.password ? await hashPassword(req.body.password) : undefined,
      firstName: req.body.firstName, lastName: req.body.lastName, role: UserRole.SUPPORT,
      isActive: true, isEmailVerified: false, isPhoneVerified: false, scopeType: ScopeType.SELF,
    });
    const partner = await HookPartner.create({ ...req.body, publicId, accountId: account.id, stateId: state._id.toString(), cityId: city._id.toString(), status: 'invited' });
    const invitation = await issueAccountInvitation({
      accountId: account.id,
      accountType: AccountType.PARTNER,
      email: account.email,
      name: `${account.firstName} ${account.lastName}`.trim(),
      invitedBy: req.user!.sub,
    });
    await recordAudit(req, { action: 'partner.created', entityType: 'partner', entityId: partner.id, entityPublicId: publicId, stateId: partner.stateId, after: partner.toObject() });
    sendCreated(res, { ...partner.toObject(), invitation });
  };
  updatePartner = async (req: Request, res: Response) => {
    await access(req, 'partners.manage');
    const partner = await byIdentifier(HookPartner, routeParam(req.params.id));
    const context = await resolveAccessContext(req.user!.sub); assertScope(context, partner.stateId);
    const updated = await HookPartner.findByIdAndUpdate(partner._id, { $set: req.body }, { returnDocument: 'after' }).lean({ virtuals: true });
    await recordAudit(req, { action: 'partner.updated', entityType: 'partner', entityId: partner._id.toString(), entityPublicId: partner.publicId, stateId: partner.stateId, before: partner, after: updated, reason: req.body.reason });
    sendSuccess(res, updated);
  };
  partnerStatus = async (req: Request, res: Response) => {
    await access(req, 'partners.manage');
    const partner = await byIdentifier(HookPartner, routeParam(req.params.id));
    const status = req.path.endsWith('/activate') || req.path.endsWith('/reactivate') ? 'active' : 'suspended';
    await Promise.all([
      HookPartner.updateOne({ _id: partner._id }, { $set: { status } }),
      User.updateOne({ _id: partner.accountId }, { $set: { accountStatus: status, isActive: status === 'active' } }),
      status === 'active' ? Promise.resolve() : revokeAccountSessions(partner.accountId, 'partner_suspended', req.user!.sub),
    ]);
    await recordAudit(req, { action: `partner.${status}`, entityType: 'partner', entityId: partner._id.toString(), entityPublicId: partner.publicId, stateId: partner.stateId, before: { status: partner.status }, after: { status }, reason: req.body.reason });
    sendSuccess(res, { status });
  };

  resendPartnerInvitation = async (req: Request, res: Response) => {
    await access(req, 'partners.manage');
    const partner = await byIdentifier(HookPartner, routeParam(req.params.id));
    const account = await User.findById(partner.accountId);
    if (!account || partner.status !== AccountStatus.INVITED) {
      throw new HttpError(409, 'Only invited Partner accounts can receive a new invitation', undefined, 'CONFLICT');
    }
    const invitation = await issueAccountInvitation({
      accountId: account.id,
      accountType: AccountType.PARTNER,
      email: account.email,
      name: `${account.firstName} ${account.lastName}`.trim(),
      invitedBy: req.user!.sub,
    });
    await recordAudit(req, { action: 'partner.invitation_resent', entityType: 'partner', entityId: partner._id.toString(), entityPublicId: partner.publicId, stateId: partner.stateId });
    sendSuccess(res, invitation);
  };

  listRunners = async (req: Request, res: Response) => {
    const context = await access(req, 'runners.view');
    const { page, limit, skip } = getPagination(req.query);
    const filter = context.scopeType === ScopeType.GLOBAL ? {} : { stateIds: { $in: context.stateIds } };
    const [data, total] = await Promise.all([RunnerProfile.find(filter).skip(skip).limit(limit).lean({ virtuals: true }), RunnerProfile.countDocuments(filter)]);
    sendSuccess(res, paginated(data, total, page, limit));
  };
  runnerDetail = async (req: Request, res: Response) => {
    const context = await access(req, 'runners.view');
    const runner = await byIdentifier(RunnerProfile, routeParam(req.params.id));
    if (context.scopeType !== ScopeType.GLOBAL && !runner.stateIds.some((stateId) => context.stateIds.includes(stateId))) {
      throw new HttpError(403, 'Runner is outside your assigned operational scope', undefined, 'SCOPE_DENIED');
    }
    sendSuccess(res, runner);
  };
  createRunner = async (req: Request, res: Response) => {
    const context = await access(req, 'runners.manage');
    for (const stateId of req.body.stateIds) assertScope(context, stateId);
    const publicId = await nextPublicId('runner');
    const account = await User.create({
      publicId, accountType: AccountType.RUNNER, accountStatus: AccountStatus.INVITED,
      email: req.body.email, phone: req.body.phone, password: req.body.password ? await hashPassword(req.body.password) : undefined,
      firstName: req.body.firstName, lastName: req.body.lastName, role: UserRole.FIELD_AGENT,
      isActive: true, isEmailVerified: false, isPhoneVerified: false, scopeType: ScopeType.SELF,
    });
    const runner = await RunnerProfile.create({ publicId, accountId: account.id, stateIds: req.body.stateIds, hubIds: req.body.hubIds || [], availability: 'unavailable', status: 'invited' });
    const invitation = await issueAccountInvitation({
      accountId: account.id,
      accountType: AccountType.RUNNER,
      email: account.email,
      name: `${account.firstName} ${account.lastName}`.trim(),
      invitedBy: req.user!.sub,
    });
    await recordAudit(req, { action: 'runner.created', entityType: 'runner', entityId: runner.id, entityPublicId: publicId, after: runner.toObject() });
    sendCreated(res, { ...runner.toObject(), invitation });
  };
  updateRunner = async (req: Request, res: Response) => {
    const context = await access(req, 'runners.manage');
    const runner = await byIdentifier(RunnerProfile, routeParam(req.params.id));
    for (const stateId of req.body.stateIds || runner.stateIds) assertScope(context, stateId);
    const updated = await RunnerProfile.findByIdAndUpdate(runner._id, { $set: req.body }, { returnDocument: 'after' }).lean({ virtuals: true });
    await recordAudit(req, { action: 'runner.updated', entityType: 'runner', entityId: runner._id.toString(), entityPublicId: runner.publicId, before: runner, after: updated, reason: req.body.reason });
    sendSuccess(res, updated);
  };
  runnerStatus = async (req: Request, res: Response) => {
    await access(req, 'runners.manage');
    const runner = await byIdentifier(RunnerProfile, routeParam(req.params.id));
    const status = req.path.endsWith('/activate') || req.path.endsWith('/reactivate') ? 'active' : 'suspended';
    await Promise.all([
      RunnerProfile.updateOne({ _id: runner._id }, { $set: { status } }),
      User.updateOne({ _id: runner.accountId }, { $set: { accountStatus: status, isActive: status === 'active' } }),
      status === 'active' ? Promise.resolve() : revokeAccountSessions(runner.accountId, 'runner_suspended', req.user!.sub),
    ]);
    await recordAudit(req, { action: `runner.${status}`, entityType: 'runner', entityId: runner._id.toString(), entityPublicId: runner.publicId, before: { status: runner.status }, after: { status }, reason: req.body.reason });
    sendSuccess(res, { status });
  };

  resendRunnerInvitation = async (req: Request, res: Response) => {
    await access(req, 'runners.manage');
    const runner = await byIdentifier(RunnerProfile, routeParam(req.params.id));
    const account = await User.findById(runner.accountId);
    if (!account || runner.status !== AccountStatus.INVITED) {
      throw new HttpError(409, 'Only invited Runner accounts can receive a new invitation', undefined, 'CONFLICT');
    }
    const invitation = await issueAccountInvitation({
      accountId: account.id,
      accountType: AccountType.RUNNER,
      email: account.email,
      name: `${account.firstName} ${account.lastName}`.trim(),
      invitedBy: req.user!.sub,
    });
    await recordAudit(req, { action: 'runner.invitation_resent', entityType: 'runner', entityId: runner._id.toString(), entityPublicId: runner.publicId });
    sendSuccess(res, invitation);
  };

  listAssignments = async (req: Request, res: Response) => sendSuccess(res, await listScoped(req, RunnerMarketAssignment, 'runners.assign'));
  assignmentDetail = async (req: Request, res: Response) => sendSuccess(res, await detailScoped(req, RunnerMarketAssignment, 'runners.assign'));
  createAssignment = async (req: Request, res: Response) => {
    const context = await access(req, 'runners.assign');
    const runner = await byIdentifier(RunnerProfile, req.body.runnerId);
    const market = await byIdentifier(Market, req.body.marketId);
    assertScope(context, market.stateId, req.body.preferredHubId);
    if (!runner.stateIds.includes(market.stateId)) throw new HttpError(409, 'Runner is not assigned to the Market state', undefined, 'CONFLICT');
    if (req.body.preferredHubId) await ensureHub(req.body.preferredHubId, market.stateId);
    const assignment = await RunnerMarketAssignment.create({
      ...req.body,
      stateId: market.stateId,
      runnerId: runner._id.toString(),
      marketId: market._id.toString(),
      createdBy: req.user!.sub,
      history: [{ action: 'created', at: new Date(), actorId: req.user!.sub }],
    });
    await recordAudit(req, { action: 'runner_assignment.created', entityType: 'runner_assignment', entityId: assignment.id, stateId: assignment.stateId, hubId: assignment.preferredHubId, after: assignment.toObject() });
    sendCreated(res, assignment);
  };
  updateAssignment = async (req: Request, res: Response) => {
    await access(req, 'runners.assign');
    const assignment = await byIdentifier(RunnerMarketAssignment, routeParam(req.params.id));
    const context = await resolveAccessContext(req.user!.sub); assertScope(context, assignment.stateId, assignment.preferredHubId);
    const updated = await RunnerMarketAssignment.findByIdAndUpdate(assignment._id, {
      $set: { ...req.body, updatedBy: req.user!.sub },
      $push: { history: { action: 'updated', at: new Date(), actorId: req.user!.sub, reason: req.body.reason } },
    }, { returnDocument: 'after' }).lean({ virtuals: true });
    await recordAudit(req, { action: 'runner_assignment.updated', entityType: 'runner_assignment', entityId: assignment._id.toString(), stateId: assignment.stateId, hubId: assignment.preferredHubId, before: assignment, after: updated, reason: req.body.reason });
    sendSuccess(res, updated);
  };
  assignmentStatus = async (req: Request, res: Response) => {
    await access(req, 'runners.assign');
    const assignment = await byIdentifier(RunnerMarketAssignment, routeParam(req.params.id));
    const status = req.path.endsWith('/activate') ? 'active' : req.path.endsWith('/pause') ? 'paused' : 'ended';
    const updated = await RunnerMarketAssignment.findByIdAndUpdate(assignment._id, {
      $set: { status, updatedBy: req.user!.sub, ...(status === 'ended' && { activeTo: new Date() }) },
      $push: { history: { action: status, at: new Date(), actorId: req.user!.sub, reason: req.body.reason } },
    }, { returnDocument: 'after' }).lean({ virtuals: true });
    await recordAudit(req, { action: `runner_assignment.${status}`, entityType: 'runner_assignment', entityId: assignment._id.toString(), stateId: assignment.stateId, hubId: assignment.preferredHubId, before: { status: assignment.status }, after: { status }, reason: req.body.reason });
    sendSuccess(res, updated);
  };

  auditLogs = async (req: Request, res: Response) => {
    await access(req, 'audit.view');
    const { page, limit, skip } = getPagination(req.query);
    const filter: Record<string, unknown> = {};
    for (const key of ['action', 'entityType', 'actorId', 'stateId']) {
      if (req.query[key]) filter[key] = req.query[key];
    }
    if (req.query.from || req.query.to) filter.createdAt = {
      ...(req.query.from && { $gte: new Date(String(req.query.from)) }),
      ...(req.query.to && { $lte: new Date(String(req.query.to)) }),
    };
    const [data, total] = await Promise.all([
      PlatformAuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean({ virtuals: true }),
      PlatformAuditLog.countDocuments(filter),
    ]);
    sendSuccess(res, paginated(data, total, page, limit));
  };
  auditDetail = async (req: Request, res: Response) => {
    await access(req, 'audit.view');
    sendSuccess(res, await byIdentifier(PlatformAuditLog, routeParam(req.params.id)));
  };

  counters = async (_req: Request, res: Response) => sendSuccess(res, await PublicIdCounter.find().sort({ year: -1, prefix: 1 }).lean({ virtuals: true }));
  repairCounter = async (req: Request, res: Response) => {
    await access(req, 'settings.manage');
    const updated = await repairPublicIdCounter(req.body.domain as PublicIdDomain, req.body.sequence, req.user!.sub, req.body.year);
    await recordAudit(req, { action: 'public_id_counter.repaired', entityType: 'public_id_counter', entityId: updated?.id, before: undefined, after: updated, reason: req.body.reason });
    sendSuccess(res, updated);
  };
}
