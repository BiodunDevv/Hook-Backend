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
import { issueAccountInvitation, revokeAccountInvitations } from '@services/account-invitation.service';
import { presentMarketRecords, presentPlatformRecords } from '@services/platform-presentation.service';
import { publishRealtime } from '@services/realtime.service';
import { MarketVendorService } from '@services/market-vendor.service';
import { HttpError, sendCreated, sendSuccess } from '@utils/http';
import { adminAccessCatalogCache, adminStaffCache } from '@lib/ttl-cache';

async function byIdentifier<T>(model: Model<T>, identifier: string) {
  const query = isValidObjectId(identifier)
    ? { $or: [{ _id: identifier }, { publicId: identifier }] }
    : { publicId: identifier };
  const record = await model.findOne(query).lean({ virtuals: true });
  if (!record) throw new HttpError(404, 'Record not found', undefined, 'NOT_FOUND');
  return record as T & { id: string; _id: { toString(): string }; publicId?: string };
}

async function stateAndHub(req: Request) {
  const requestedStateValue = req.platformContext?.stateId || (req.query.stateId as string | undefined);
  const requestedHubValue = req.platformContext?.hubId || (req.query.hubId as string | undefined);
  const requestedState = requestedStateValue?.trim().toLowerCase() === 'all' ? undefined : requestedStateValue;
  const requestedHub = requestedHubValue?.trim().toLowerCase() === 'all' ? undefined : requestedHubValue;
  const state = requestedState ? await byIdentifier(OperationState, requestedState) : undefined;
  const hub = requestedHub ? await byIdentifier(DispatchHub, requestedHub) : undefined;
  if (state && hub && hub.stateId !== state._id.toString()) {
    throw new HttpError(409, 'Selected Dispatch Hub does not belong to the selected state', undefined, 'CONFLICT');
  }
  return {
    stateId: state?._id.toString(),
    hubId: hub?._id.toString(),
  };
}

async function access(req: Request, permission: string) {
  const user = req.user!;
  const context = {
    permissions: user.permissions || [],
    roleKeys: user.roleKeys || [],
    scopeType: user.scopeType || ScopeType.SELF,
    stateIds: user.assignedStateIds || [],
    hubIds: user.assignedHubIds || [],
  };
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
  const { stateId, hubId } = await stateAndHub(req);
  const { page, limit, skip } = getPagination(req.query);
  const filter = scopedFilter<T>(context, extra, stateId, hubId);
  const [data, total] = await Promise.all([
    model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean({ virtuals: true }),
    model.countDocuments(filter),
  ]);
  return paginated(await presentPlatformRecords(data), total, page, limit);
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
  return presentPlatformRecords(record);
}

async function sendPlatformSuccess(res: Response, value: any) {
  sendSuccess(res, await presentPlatformRecords(value));
}

async function sendPlatformCreated(res: Response, value: any) {
  sendCreated(res, await presentPlatformRecords(value));
}

function publishMarketUpdate(market: any) {
  const event = {
    entityId: market.publicId || market.id || market._id?.toString(),
    version: Number(market.version || 1),
    ...(market.stateId ? { scope: { stateId: String(market.stateId) } } : {}),
  };
  const targets = {
    public: true,
    admin: true,
    ...(market.stateId ? { stateId: String(market.stateId) } : {}),
    ...(market.hubId ? { hubId: String(market.hubId) } : {}),
  };
  publishRealtime({ type: 'catalog.updated', ...event }, targets);
  publishRealtime({ type: 'home.updated', ...event }, targets);
  publishRealtime({ type: 'admin.dashboard.updated', ...event }, targets);
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
  const state = await ensureState(stateId);
  const selectedStateIds = new Set([state._id.toString(), state.publicId]);
  if (!selectedStateIds.has(String(hub.stateId))) {
    throw new HttpError(409, 'Dispatch Hub does not belong to the selected state', undefined, 'CONFLICT');
  }
  return hub;
}

async function ensureZone(id: string, stateId: string, cityId: string) {
  const zone = await byIdentifier(ServiceZone, id);
  if (zone.stateId !== stateId || zone.cityId !== cityId) {
    throw new HttpError(409, 'Service Zone does not belong to the selected City and State', undefined, 'CONFLICT');
  }
  return zone;
}

async function resolveLocation(input: {
  stateId: string;
  cityId: string;
  zoneId?: string;
}, active = true) {
  const state = await ensureState(input.stateId, active);
  const city = await ensureCity(input.cityId, state._id.toString(), active);
  const zone = input.zoneId
    ? await ensureZone(input.zoneId, state._id.toString(), city._id.toString())
    : undefined;
  return {
    state,
    city,
    zone,
    ids: {
      stateId: state._id.toString(),
      cityId: city._id.toString(),
      ...(zone && { zoneId: zone._id.toString() }),
    },
  };
}

async function resolveIdentifiers<T>(model: Model<T>, identifiers: string[]) {
  return Promise.all(identifiers.map(async (identifier) => {
    const record = await byIdentifier(model, identifier);
    return record._id.toString();
  }));
}

async function validatePermissionKeys(permissionKeys: string[]) {
  const normalized = [...new Set(permissionKeys.map((key) => key.trim().toLowerCase()).filter(Boolean))];
  const active = await Permission.find({ key: { $in: normalized }, isActive: true }).select('key').lean();
  if (active.length !== normalized.length) {
    throw new HttpError(409, 'Every selected permission must be active and defined', undefined, 'CONFLICT');
  }
  return normalized;
}

async function countStaffAssignedToRole(roleId: string) {
  const [profiles, accounts] = await Promise.all([
    StaffProfile.find({ roleIds: roleId }).select('accountId').lean(),
    User.find({ accountType: AccountType.STAFF, roleIds: roleId }).select('_id').lean(),
  ]);
  return new Set([
    ...profiles.map((profile) => String(profile.accountId || profile._id)),
    ...accounts.map((account) => account._id.toString()),
  ]).size;
}

async function resolveStaffScope(input: {
  roleIds: string[];
  stateIds?: string[];
  hubIds?: string[];
  scopeType: ScopeType;
}) {
  const roleIds = await resolveIdentifiers(Role, input.roleIds);
  const roles = await Role.find({ _id: { $in: roleIds }, isActive: true }).lean();
  if (roles.length !== roleIds.length) {
    throw new HttpError(409, 'Every selected role must be active', undefined, 'CONFLICT');
  }
  const requestedStateIds = input.scopeType === ScopeType.GLOBAL ? [] : input.stateIds || [];
  const requestedHubIds = input.scopeType === ScopeType.HUB ? input.hubIds || [] : [];
  const states = await Promise.all(requestedStateIds.map((id) => ensureState(id, true)));
  const stateIds = states.map((state) => state._id.toString());
  const selectedStateIds = new Set(states.flatMap((state) => [state._id.toString(), state.publicId]));
  const hubs = await Promise.all(requestedHubIds.map(async (id) => {
    const hub = await byIdentifier(DispatchHub, id);
    if (hub.status !== 'active') {
      throw new HttpError(409, 'Every selected Dispatch Hub must be active', undefined, 'CONFLICT');
    }
    if (!selectedStateIds.has(String(hub.stateId))) {
      throw new HttpError(409, 'Every selected Dispatch Hub must belong to a selected state', undefined, 'CONFLICT');
    }
    return hub;
  }));
  const hubIds = hubs.map((hub) => hub._id.toString());

  if (input.scopeType === ScopeType.GLOBAL && (stateIds.length || hubIds.length)) {
    throw new HttpError(409, 'Global staff cannot have state or Hub restrictions', undefined, 'CONFLICT');
  }
  if (input.scopeType === ScopeType.SINGLE_STATE && stateIds.length !== 1) {
    throw new HttpError(409, 'Single-state scope requires exactly one state', undefined, 'CONFLICT');
  }
  if (input.scopeType === ScopeType.MULTI_STATE && stateIds.length < 2) {
    throw new HttpError(409, 'Multi-state scope requires at least two states', undefined, 'CONFLICT');
  }
  if (input.scopeType === ScopeType.HUB && (!stateIds.length || !hubIds.length)) {
    throw new HttpError(409, 'Hub scope requires at least one state and Dispatch Hub', undefined, 'CONFLICT');
  }
  return { roleIds, stateIds, hubIds };
}

async function resolveRunnerScope(stateIdentifiers: string[], hubIdentifiers: string[] = []) {
  const states = await Promise.all(stateIdentifiers.map((id) => ensureState(id, true)));
  const stateIds = states.map((state) => state._id.toString());
  const selectedStateIds = new Set(states.flatMap((state) => [state._id.toString(), state.publicId]));
  const hubs = await Promise.all(hubIdentifiers.map(async (id) => {
    const hub = await byIdentifier(DispatchHub, id);
    if (hub.status !== 'active' || !selectedStateIds.has(String(hub.stateId))) {
      throw new HttpError(409, 'Every selected Dispatch Hub must be active and belong to a Runner state', undefined, 'CONFLICT');
    }
    return hub;
  }));
  return { stateIds, hubIds: hubs.map((hub) => hub._id.toString()) };
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
  if (entityType === 'market') publishMarketUpdate(updated);
  await sendPlatformSuccess(res, updated);
}

export class PlatformController {
  permissions = async (req: Request, res: Response) => {
    await access(req, 'roles.view');
    const cached = adminAccessCatalogCache.get('permissions');
    if (cached) {
      sendSuccess(res, cached);
      return;
    }
    const rows = await Permission.find({ isActive: true })
      .select('key domain description isActive')
      .sort({ domain: 1, key: 1 })
      .lean();
    adminAccessCatalogCache.set('permissions', rows);
    sendSuccess(res, rows);
  };

  roles = async (req: Request, res: Response) => {
    await access(req, 'roles.view');
    const cached = adminAccessCatalogCache.get('roles');
    if (cached) {
      sendSuccess(res, cached);
      return;
    }
    const rows = await Role.find()
      .select('key name description permissionKeys defaultScopeType isSystem isActive')
      .sort({ name: 1 })
      .lean({ virtuals: true });
    const roleIds = rows.map((row) => row._id.toString());
    const [staffProfiles, staffAccounts] = await Promise.all([
      StaffProfile.find({ roleIds: { $in: roleIds } }).select('accountId roleIds').lean(),
      User.find({ accountType: AccountType.STAFF, roleIds: { $in: roleIds } }).select('_id roleIds').lean(),
    ]);
    const assignmentCounts = new Map<string, Set<string>>();
    for (const row of rows) assignmentCounts.set(row._id.toString(), new Set());
    for (const profile of staffProfiles) {
      const accountId = String(profile.accountId || profile._id);
      for (const roleId of profile.roleIds || []) {
        assignmentCounts.get(String(roleId))?.add(accountId);
      }
    }
    for (const account of staffAccounts) {
      const accountId = account._id.toString();
      for (const roleId of account.roleIds || []) {
        assignmentCounts.get(String(roleId))?.add(accountId);
      }
    }
    const data = rows.map((row) => ({
      ...row,
      assignedStaffCount: assignmentCounts.get(row._id.toString())?.size || 0,
    }));
    adminAccessCatalogCache.set('roles', data);
    sendSuccess(res, data);
  };

  roleDetail = async (req: Request, res: Response) => {
    await access(req, 'roles.view');
    sendSuccess(res, await byIdentifier(Role, routeParam(req.params.id)));
  };

  createRole = async (req: Request, res: Response) => {
    await access(req, 'roles.manage');
    const permissionKeys = await validatePermissionKeys(req.body.permissionKeys || []);
    const role = await Role.create({
      key: req.body.key.toUpperCase(),
      name: req.body.name,
      description: req.body.description || '',
      permissionKeys,
      defaultScopeType: req.body.defaultScopeType,
      isSystem: false,
      isActive: req.body.isActive !== false,
    });
    await recordAudit(req, { action: 'role.created', entityType: 'role', entityId: role.id, after: role.toObject() });
    adminAccessCatalogCache.clear();
    sendCreated(res, role);
  };

  updateRole = async (req: Request, res: Response) => {
    await access(req, 'roles.manage');
    const role = await byIdentifier(Role, routeParam(req.params.id));
    if (role.isSystem) {
      throw new HttpError(409, 'System roles are protected and cannot be edited', undefined, 'CONFLICT');
    }
    const assignedStaff = await countStaffAssignedToRole(role._id.toString());
    if (assignedStaff > 0) {
      throw new HttpError(409, `This role is assigned to ${assignedStaff} staff member${assignedStaff === 1 ? '' : 's'}. Reassign them before editing the role.`, { assignedStaffCount: assignedStaff }, 'CONFLICT');
    }
    const patch: Record<string, unknown> = {};
    if (req.body.key !== undefined) patch.key = String(req.body.key).trim().toUpperCase();
    if (req.body.name !== undefined) patch.name = req.body.name;
    if (req.body.description !== undefined) patch.description = req.body.description;
    if (req.body.permissionKeys !== undefined) patch.permissionKeys = await validatePermissionKeys(req.body.permissionKeys);
    if (req.body.defaultScopeType !== undefined) patch.defaultScopeType = req.body.defaultScopeType;
    if (req.body.isActive !== undefined) patch.isActive = req.body.isActive;
    if (patch.key && patch.key !== role.key) {
      const duplicate = await Role.exists({ key: patch.key, _id: { $ne: role._id } });
      if (duplicate) throw new HttpError(409, 'A role with this key already exists', undefined, 'CONFLICT');
    }
    const updated = await Role.findByIdAndUpdate(role._id, { $set: patch }, { returnDocument: 'after' }).lean({ virtuals: true });
    await recordAudit(req, { action: 'role.updated', entityType: 'role', entityId: role._id.toString(), before: role, after: updated, reason: req.body.reason });
    adminAccessCatalogCache.clear();
    sendSuccess(res, updated);
  };

  archiveRole = async (req: Request, res: Response) => {
    await access(req, 'roles.manage');
    const role = await byIdentifier(Role, routeParam(req.params.id));
    if (role.isSystem) {
      throw new HttpError(409, 'System roles are protected and cannot be deleted', undefined, 'CONFLICT');
    }
    const assignedStaff = await countStaffAssignedToRole(role._id.toString());
    if (assignedStaff > 0) {
      throw new HttpError(409, `This role is assigned to ${assignedStaff} staff member${assignedStaff === 1 ? '' : 's'}. Reassign them before deleting the role.`, { assignedStaffCount: assignedStaff }, 'CONFLICT');
    }
    const updated = await Role.findByIdAndUpdate(
      role._id,
      { $set: { isActive: false } },
      { returnDocument: 'after' },
    ).lean({ virtuals: true });
    await recordAudit(req, {
      action: 'role.archived',
      entityType: 'role',
      entityId: role._id.toString(),
      before: role,
      after: updated,
      reason: req.body.reason,
    });
    adminAccessCatalogCache.clear();
    sendSuccess(res, { id: role.id, key: role.key, isActive: false });
  };

  listStaff = async (req: Request, res: Response) => {
    const context = await access(req, 'staff.view');
    const { stateId, hubId } = await stateAndHub(req);
    const { page, limit, skip } = getPagination(req.query);
    const cacheKey = `staff:${req.user!.sub}:${page}:${limit}:${stateId || ''}:${hubId || ''}:${String(req.query.status || '')}:${String(req.query.scopeType || '')}:${String(req.query.role || '')}:${String(req.query.q || '')}`;
    const cached = adminStaffCache.get(cacheKey);
    if (cached) {
      sendSuccess(res, cached);
      return;
    }
    const filter: Record<string, unknown> = context.scopeType === ScopeType.GLOBAL
      ? { ...(stateId && { stateIds: stateId }), ...(hubId && { hubIds: hubId }) }
      : context.scopeType === ScopeType.HUB
        ? { hubIds: hubId || { $in: context.hubIds } }
        : { stateIds: stateId || { $in: context.stateIds } };
    const requestedStatus = String(req.query.status || '').trim().toLowerCase();
    const requestedScope = String(req.query.scopeType || '').trim();
    const requestedRole = String(req.query.role || '').trim().toUpperCase();
    const search = String(req.query.q || '').trim();

    if (requestedStatus && Object.values(AccountStatus).includes(requestedStatus as AccountStatus)) {
      filter.status = requestedStatus;
    }
    if (requestedScope && Object.values(ScopeType).includes(requestedScope as ScopeType)) {
      filter.scopeType = requestedScope;
    }
    if (requestedRole) {
      const role = await Role.findOne({ key: requestedRole }).select('_id').lean();
      filter.roleIds = role?._id.toString() || '__no_matching_role__';
    }
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const accounts = await User.find({
        $or: [
          { email: { $regex: escaped, $options: 'i' } },
          { firstName: { $regex: escaped, $options: 'i' } },
          { lastName: { $regex: escaped, $options: 'i' } },
          { phone: { $regex: escaped, $options: 'i' } },
          { publicId: { $regex: escaped, $options: 'i' } },
        ],
      }).select('_id').lean();
      filter.accountId = { $in: accounts.map((account) => account._id.toString()) };
    }

    const [data, total] = await Promise.all([
      StaffProfile.find(filter)
        .select('publicId accountId roleIds scopeType stateIds hubIds status createdAt updatedAt')
        .sort({ createdAt: -1 }).skip(skip).limit(limit).lean({ virtuals: true }),
      StaffProfile.countDocuments(filter),
    ]);
    const accountIds = data.map((profile) => profile.accountId).filter(Boolean).map((id) => id.toString());
    const roleIds = data.flatMap((profile) => profile.roleIds || []).map((id) => id.toString());
    const [accounts, roles] = await Promise.all([
      User.find({ _id: { $in: accountIds } }).select('publicId email firstName lastName phone role accountType accountStatus isActive isEmailVerified lastLoginAt').lean(),
      Role.find({ _id: { $in: roleIds } }).select('_id key name description permissionKeys isSystem isActive').lean(),
    ]);
    const accountMap = new Map(accounts.map((account) => [account._id.toString(), account]));
    const roleMap = new Map(roles.map((role) => [role._id.toString(), role]));
    const stateReferenceIds = [...new Set(data.flatMap((profile) => profile.stateIds || []).map((id) => id.toString()))];
    const hubReferenceIds = [...new Set(data.flatMap((profile) => profile.hubIds || []).map((id) => id.toString()))];
    const [states, hubs] = await Promise.all([
      stateReferenceIds.length
        ? OperationState.find({
            $or: [
              { publicId: { $in: stateReferenceIds } },
              { _id: { $in: stateReferenceIds.filter((id) => isValidObjectId(id)) } },
            ],
          }).select('_id publicId').lean()
        : [],
      hubReferenceIds.length
        ? DispatchHub.find({
            $or: [
              { publicId: { $in: hubReferenceIds } },
              { _id: { $in: hubReferenceIds.filter((id) => isValidObjectId(id)) } },
            ],
          }).select('_id publicId').lean()
        : [],
    ]);
    const stateMap = new Map((states as any[]).flatMap((state) => [[state._id.toString(), state.publicId], [state.publicId, state.publicId]]));
    const hubMap = new Map((hubs as any[]).flatMap((hub) => [[hub._id.toString(), hub.publicId], [hub.publicId, hub.publicId]]));
    const presented = data.map((source: any) => {
      const { _id, accountId, stateIds, hubIds, ...profile } = source;
      return {
        ...profile,
        id: source.publicId || _id?.toString(),
        accountId: accountMap.get(String(accountId))?.publicId || accountId,
        stateIds: (stateIds || []).map((id: unknown) => stateMap.get(String(id)) || String(id)),
        hubIds: (hubIds || []).map((id: unknown) => hubMap.get(String(id)) || String(id)),
      };
    });
    const rows = presented.map((profile: Record<string, unknown>, index: number) => {
      const source = data[index];
      const account = accountMap.get(source.accountId?.toString());
      const assignedRoles = (source.roleIds || [])
        .map((id) => roleMap.get(id.toString()))
        .filter(Boolean)
        .map((role) => ({
          id: role!._id.toString(),
          key: role!.key,
          name: role!.name,
          description: role!.description,
          permissionKeys: role!.permissionKeys,
          isSystem: role!.isSystem,
          isActive: role!.isActive,
        }));
      const permissions = [...new Set(assignedRoles.flatMap((role) => role.permissionKeys))];
      return {
        ...profile,
        firstName: account?.firstName || '',
        lastName: account?.lastName || '',
        email: account?.email || '',
        phone: account?.phone || '',
        role: account?.role,
        account: account ? {
          id: account.publicId || account._id.toString(),
          publicId: account.publicId,
          email: account.email,
          firstName: account.firstName,
          lastName: account.lastName,
          phone: account.phone,
          role: account.role,
          accountType: account.accountType,
          accountStatus: account.accountStatus,
          isActive: account.isActive,
          isEmailVerified: account.isEmailVerified,
          lastLoginAt: account.lastLoginAt,
        } : null,
        roles: assignedRoles,
        roleKeys: assignedRoles.map((role) => role.key),
        permissions,
        lastLoginAt: account?.lastLoginAt,
      };
    });
    const response = paginated(rows, total, page, limit);
    adminStaffCache.set(cacheKey, response);
    sendSuccess(res, response);
  };

  staffDetail = async (req: Request, res: Response) => {
    const context = await access(req, 'staff.view');
    const profile = await byIdentifier(StaffProfile, routeParam(req.params.id));
    for (const stateId of profile.stateIds) assertScope(context, stateId);
    const [account, roles, states, hubs] = await Promise.all([
      User.findById(profile.accountId).select('-password -refreshToken').lean({ virtuals: true }),
      Role.find({ _id: { $in: profile.roleIds } }).select('_id key name description permissionKeys isSystem isActive').lean(),
      OperationState.find({ $or: profile.stateIds.flatMap((id) => [
        { publicId: id },
        ...(isValidObjectId(id) ? [{ _id: id }] : []),
      ]) }).select('_id publicId name code status').lean(),
      DispatchHub.find({ $or: profile.hubIds.flatMap((id) => [
        { publicId: id },
        ...(isValidObjectId(id) ? [{ _id: id }] : []),
      ]) }).select('_id publicId name status').lean(),
    ]);
    for (const hubId of profile.hubIds) assertScope(context, undefined, hubId);
    const roleSummaries = roles.map((role) => ({
      id: role._id.toString(),
      key: role.key,
      name: role.name,
      description: role.description,
      permissionKeys: role.permissionKeys,
      isSystem: role.isSystem,
      isActive: role.isActive,
    }));
    const permissions = [...new Set(roleSummaries.flatMap((role) => role.permissionKeys || []))];
    const presentedProfile = await presentPlatformRecords(profile);
    sendSuccess(res, {
      ...presentedProfile,
      account: account ? {
        id: account.publicId || account._id.toString(),
        publicId: account.publicId,
        email: account.email,
        firstName: account.firstName,
        lastName: account.lastName,
        phone: account.phone,
        accountType: account.accountType,
        accountStatus: account.accountStatus,
        isActive: account.isActive,
        isEmailVerified: account.isEmailVerified,
        lastLoginAt: account.lastLoginAt,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      } : null,
      roles: roleSummaries,
      permissions,
      states: states.map((state) => ({
        id: state.publicId || state._id.toString(),
        publicId: state.publicId,
        name: state.name,
        code: state.code,
        status: state.status,
      })),
      hubs: hubs.map((hub) => ({
        id: hub.publicId || hub._id.toString(),
        publicId: hub.publicId,
        name: hub.name,
        status: hub.status,
      })),
    });
  };

  createStaff = async (req: Request, res: Response) => {
    const context = await access(req, 'staff.create');
    const scope = await resolveStaffScope(req.body);
    const roles = await Role.find({ _id: { $in: scope.roleIds } }).select('key').lean();
    if (!context.roleKeys.includes('SUPER_ADMIN') && roles.some((role) => role.key === 'SUPER_ADMIN')) {
      throw new HttpError(403, 'Only a Super Admin can create a Super Admin account', undefined, 'ACCESS_DENIED');
    }
    for (const stateId of scope.stateIds) assertScope(context, stateId);
    for (const hubId of scope.hubIds) assertScope(context, undefined, hubId);
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
      roleIds: scope.roleIds,
      scopeType: req.body.scopeType,
      assignedStateIds: scope.stateIds,
      assignedHubIds: scope.hubIds,
      isEmailVerified: false,
      isPhoneVerified: false,
      isActive: true,
    });
    const profile = await StaffProfile.create({
      publicId,
      accountId: account.id,
      roleIds: scope.roleIds,
      scopeType: req.body.scopeType,
      stateIds: scope.stateIds,
      hubIds: scope.hubIds,
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
    adminStaffCache.clear();
    sendCreated(res, {
      ...await presentPlatformRecords(profile.toObject()),
      account: { ...account.toJSON(), id: account.publicId },
      invitation,
    });
  };

  updateStaff = async (req: Request, res: Response) => {
    const context = await access(req, 'staff.edit');
    const profile = await byIdentifier(StaffProfile, routeParam(req.params.id));
    const scope = await resolveStaffScope({
      roleIds: req.body.roleIds || profile.roleIds,
      scopeType: req.body.scopeType || profile.scopeType,
      stateIds: req.body.stateIds || profile.stateIds,
      hubIds: req.body.hubIds || profile.hubIds,
    });
    const roles = await Role.find({ _id: { $in: scope.roleIds } }).select('key').lean();
    if (!context.roleKeys.includes('SUPER_ADMIN') && roles.some((role) => role.key === 'SUPER_ADMIN')) {
      throw new HttpError(403, 'Only a Super Admin can assign the Super Admin role', undefined, 'ACCESS_DENIED');
    }
    for (const stateId of scope.stateIds) assertScope(context, stateId);
    for (const hubId of scope.hubIds) assertScope(context, undefined, hubId);
    const patch = {
      roleIds: scope.roleIds,
      ...(req.body.scopeType && { scopeType: req.body.scopeType }),
      stateIds: scope.stateIds,
      hubIds: scope.hubIds,
    };
    const updated = await StaffProfile.findByIdAndUpdate(profile._id, { $set: patch }, { returnDocument: 'after' }).lean({ virtuals: true });
    await User.updateOne({ _id: profile.accountId }, {
      $set: {
        ...(req.body.firstName !== undefined && { firstName: req.body.firstName }),
        ...(req.body.lastName !== undefined && { lastName: req.body.lastName }),
        ...(req.body.phone !== undefined && { phone: req.body.phone }),
        roleIds: scope.roleIds,
        ...(req.body.scopeType && { scopeType: req.body.scopeType }),
        assignedStateIds: scope.stateIds,
        assignedHubIds: scope.hubIds,
      },
    });
    await recordAudit(req, { action: 'staff.updated', entityType: 'staff', entityId: profile._id.toString(), entityPublicId: profile.publicId, before: profile, after: updated, reason: req.body.reason });
    adminStaffCache.clear();
    await sendPlatformSuccess(res, updated);
  };

  staffStatus = async (req: Request, res: Response) => {
    const context = await access(req, 'staff.suspend');
    const profile = await byIdentifier(StaffProfile, routeParam(req.params.id));
    for (const stateId of profile.stateIds) assertScope(context, stateId);
    for (const hubId of profile.hubIds) assertScope(context, undefined, hubId);
    if (profile.accountId.toString() === req.user!.sub) {
      throw new HttpError(409, 'You cannot change the lifecycle of your own account', undefined, 'CONFLICT');
    }
    const target = await User.findById(profile.accountId).select('roleIds').lean();
    const targetRoles = await Role.find({ _id: { $in: target?.roleIds || [] } }).select('key').lean();
    if (targetRoles.some((role) => role.key === 'SUPER_ADMIN')) {
      throw new HttpError(409, 'Super Admin accounts are protected', undefined, 'CONFLICT');
    }
    const restoring = req.path.endsWith('/restore');
    const status = req.path.endsWith('/reactivate') || restoring ? AccountStatus.ACTIVE : AccountStatus.SUSPENDED;
    const active = status === AccountStatus.ACTIVE;
    const profileUpdate = active
      ? { $set: { status }, $unset: { deletedAt: 1 } }
      : { $set: { status } };
    const accountUpdate = active
      ? { $set: { accountStatus: status, isActive: true }, $unset: { deletedAt: 1 } }
      : { $set: { accountStatus: status, isActive: false } };
    await Promise.all([
      StaffProfile.updateOne({ _id: profile._id }, profileUpdate),
      User.updateOne({ _id: profile.accountId }, accountUpdate),
      active ? Promise.resolve() : revokeAccountSessions(profile.accountId, 'staff_suspended', req.user!.sub),
    ]);
    await recordAudit(req, { action: restoring ? 'staff.restored' : `staff.${status}`, entityType: 'staff', entityId: profile._id.toString(), entityPublicId: profile.publicId, before: { status: profile.status }, after: { status }, reason: req.body.reason });
    adminStaffCache.clear();
    sendSuccess(res, { status, restored: restoring });
  };

  archiveStaff = async (req: Request, res: Response) => {
    const context = await access(req, 'staff.suspend');
    const profile = await byIdentifier(StaffProfile, routeParam(req.params.id));
    for (const stateId of profile.stateIds) assertScope(context, stateId);
    for (const hubId of profile.hubIds) assertScope(context, undefined, hubId);
    if (profile.accountId.toString() === req.user!.sub) {
      throw new HttpError(409, 'You cannot archive your own account', undefined, 'CONFLICT');
    }
    const target = await User.findById(profile.accountId).select('roleIds').lean();
    const targetRoles = await Role.find({ _id: { $in: target?.roleIds || [] } }).select('key').lean();
    if (targetRoles.some((role) => role.key === 'SUPER_ADMIN')) {
      throw new HttpError(409, 'Super Admin accounts are protected', undefined, 'CONFLICT');
    }
    await Promise.all([
      StaffProfile.updateOne({ _id: profile._id }, { $set: { status: AccountStatus.DISABLED, deletedAt: new Date() } }),
      User.updateOne({ _id: profile.accountId }, { $set: { accountStatus: AccountStatus.DISABLED, isActive: false, deletedAt: new Date() } }),
      revokeAccountSessions(profile.accountId, 'staff_archived', req.user!.sub),
      revokeAccountInvitations(profile.accountId),
    ]);
    await recordAudit(req, {
      action: 'staff.archived',
      entityType: 'staff',
      entityId: profile._id.toString(),
      entityPublicId: profile.publicId,
      before: { status: profile.status },
      after: { status: AccountStatus.DISABLED },
      reason: req.body.reason,
    });
    adminStaffCache.clear();
    sendSuccess(res, { status: AccountStatus.DISABLED, archived: true });
  };

  revokeStaffSessions = async (req: Request, res: Response) => {
    const context = await access(req, 'staff.revoke_sessions');
    const profile = await byIdentifier(StaffProfile, routeParam(req.params.id));
    for (const stateId of profile.stateIds) assertScope(context, stateId);
    for (const hubId of profile.hubIds) assertScope(context, undefined, hubId);
    await revokeAccountSessions(profile.accountId, req.body.reason || 'administrative_revocation', req.user!.sub);
    await recordAudit(req, { action: 'staff.sessions_revoked', entityType: 'staff', entityId: profile._id.toString(), entityPublicId: profile.publicId, reason: req.body.reason });
    sendSuccess(res, { revoked: true });
  };

  resendStaffInvitation = async (req: Request, res: Response) => {
    const context = await access(req, 'staff.create');
    const profile = await byIdentifier(StaffProfile, routeParam(req.params.id));
    for (const stateId of profile.stateIds) assertScope(context, stateId);
    for (const hubId of profile.hubIds) assertScope(context, undefined, hubId);
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

  cancelStaffInvitation = async (req: Request, res: Response) => {
    const context = await access(req, 'staff.suspend');
    const profile = await byIdentifier(StaffProfile, routeParam(req.params.id));
    for (const stateId of profile.stateIds) assertScope(context, stateId);
    for (const hubId of profile.hubIds) assertScope(context, undefined, hubId);
    if (profile.status !== AccountStatus.INVITED) {
      throw new HttpError(409, 'Only pending staff invitations can be cancelled', undefined, 'INVALID_STATE_TRANSITION');
    }
    const revokedInvitations = await revokeAccountInvitations(profile.accountId);
    await Promise.all([
      StaffProfile.updateOne({ _id: profile._id }, { $set: { status: AccountStatus.DISABLED } }),
      User.updateOne({ _id: profile.accountId }, { $set: { accountStatus: AccountStatus.DISABLED, isActive: false } }),
    ]);
    await recordAudit(req, {
      action: 'staff.invitation_cancelled',
      entityType: 'staff',
      entityId: profile._id.toString(),
      entityPublicId: profile.publicId,
      before: { status: profile.status },
      after: { status: AccountStatus.DISABLED, revokedInvitations },
      reason: req.body.reason,
    });
    adminStaffCache.clear();
    sendSuccess(res, { status: AccountStatus.DISABLED, revokedInvitations });
  };

  listStates = async (req: Request, res: Response) => {
    const context = await access(req, 'states.view');
    const { page, limit, skip } = getPagination(req.query);
    const filter: Record<string, unknown> = context.scopeType === ScopeType.GLOBAL ? {} : { _id: { $in: context.stateIds } };
    if (String(req.query.operationsEnabled || '') === 'true') filter.operationsEnabled = true;
    const [data, total] = await Promise.all([OperationState.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean({ virtuals: true }), OperationState.countDocuments(filter)]);
    const stateIds = data.map((state: any) => String(state._id));
    const marketCounts = await Market.aggregate([
      { $match: { stateId: { $in: stateIds }, status: 'active' } },
      { $group: { _id: '$stateId', count: { $sum: 1 } } },
    ]);
    const counts = new Map(marketCounts.map((row: any) => [String(row._id), Number(row.count)]));
    const presented = await presentPlatformRecords(data);
    sendSuccess(res, paginated(
      presented.map((state: any, index: number) => ({
        ...state,
        marketCount: counts.get(String(data[index]._id)) || 0,
      })),
      total,
      page,
      limit,
    ));
  };
  stateDetail = async (req: Request, res: Response) => {
    const context = await access(req, 'states.view');
    const state = await byIdentifier(OperationState, routeParam(req.params.id));
    assertScope(context, state._id.toString());
    await sendPlatformSuccess(res, state);
  };
  createState = async (req: Request, res: Response) => {
    await access(req, 'states.manage');
    const state = await OperationState.create({
      ...req.body,
      capitalName: req.body.capitalName || req.body.name,
      publicId: await nextPublicId('state'),
    });
    await recordAudit(req, { action: 'state.created', entityType: 'state', entityId: state.id, entityPublicId: state.publicId, stateId: state.id, after: state.toObject() });
    await sendPlatformCreated(res, state.toObject());
  };
  updateState = async (req: Request, res: Response) => {
    const context = await access(req, 'states.manage');
    const state = await byIdentifier(OperationState, routeParam(req.params.id));
    assertScope(context, state._id.toString());
    const updated = await OperationState.findByIdAndUpdate(state._id, { $set: req.body }, { returnDocument: 'after' }).lean({ virtuals: true });
    await recordAudit(req, { action: 'state.updated', entityType: 'state', entityId: state._id.toString(), entityPublicId: state.publicId, stateId: state._id.toString(), before: state, after: updated, reason: req.body.reason });
    await sendPlatformSuccess(res, updated);
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
    await sendPlatformCreated(res, city.toObject());
  };
  updateCity = async (req: Request, res: Response) => {
    await access(req, 'cities.manage');
    const city = await byIdentifier(OperationCity, routeParam(req.params.id));
    const context = await resolveAccessContext(req.user!.sub); assertScope(context, city.stateId);
    const state = req.body.stateId ? await ensureState(req.body.stateId, true) : await ensureState(city.stateId, true);
    assertScope(context, state._id.toString());
    let defaultHubId = city.defaultHubId;
    if (req.body.defaultHubId) {
      const hub = await ensureHub(req.body.defaultHubId, state._id.toString());
      defaultHubId = hub._id.toString();
    }
    const patch = {
      ...req.body,
      stateId: state._id.toString(),
      ...(defaultHubId && { defaultHubId }),
    };
    const updated = await OperationCity.findByIdAndUpdate(city._id, { $set: patch }, { returnDocument: 'after' }).lean({ virtuals: true });
    await recordAudit(req, { action: 'city.updated', entityType: 'city', entityId: city._id.toString(), entityPublicId: city.publicId, stateId: city.stateId, before: city, after: updated, reason: req.body.reason });
    await sendPlatformSuccess(res, updated);
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
    await sendPlatformCreated(res, zone.toObject());
  };
  updateZone = async (req: Request, res: Response) => {
    await access(req, 'zones.manage');
    const zone = await byIdentifier(ServiceZone, routeParam(req.params.id));
    const context = await resolveAccessContext(req.user!.sub); assertScope(context, zone.stateId);
    const location = await resolveLocation({
      stateId: req.body.stateId || zone.stateId,
      cityId: req.body.cityId || zone.cityId,
    });
    assertScope(context, location.ids.stateId);
    const updated = await ServiceZone.findByIdAndUpdate(
      zone._id,
      { $set: { ...req.body, ...location.ids } },
      { returnDocument: 'after' },
    ).lean({ virtuals: true });
    await recordAudit(req, { action: 'zone.updated', entityType: 'zone', entityId: zone._id.toString(), entityPublicId: zone.publicId, stateId: zone.stateId, before: zone, after: updated, reason: req.body.reason });
    await sendPlatformSuccess(res, updated);
  };
  zoneStatus = (req: Request, res: Response) => lifecycle(req, res, ServiceZone, 'zones.manage', 'zone', req.path.endsWith('/activate') ? 'active' : 'inactive');

  listMarkets = async (req: Request, res: Response) => {
    const context = await access(req, 'markets.view');
    const { stateId, hubId } = await stateAndHub(req);
    const { page, limit, skip } = getPagination(req.query);
    const filter = scopedFilter<Market>(context, {}, stateId, hubId);
    const [data, total] = await Promise.all([
      Market.find(filter).sort({ isFeatured: -1, displayPriority: 1, name: 1 }).skip(skip).limit(limit).lean({ virtuals: true }),
      Market.countDocuments(filter),
    ]);
    sendSuccess(res, paginated(await presentMarketRecords(data), total, page, limit));
  };
  marketDetail = async (req: Request, res: Response) => {
    const context = await access(req, 'markets.view');
    const market = await byIdentifier(Market, routeParam(req.params.id));
    assertScope(context, market.stateId, market.hubId);
    const detail = await new MarketVendorService().adminMarket(market.publicId || market.id);
    sendSuccess(res, {
      ...(await presentMarketRecords(market)),
      vendors: detail.vendors,
      assignments: detail.assignments,
      runners: detail.runners,
      submissions: detail.submissions,
      products: detail.products,
      collections: detail.collections,
      summary: detail.summary,
    });
  };
  createMarket = async (req: Request, res: Response) => {
    const context = await access(req, 'markets.manage');
    const location = await resolveLocation(req.body);
    const operatingState = await OperationState.findById(location.ids.stateId).select('operationsEnabled').lean();
    if (!operatingState?.operationsEnabled) throw new HttpError(409, 'Hook operations are not enabled in this State', undefined, 'INVALID_STATE_TRANSITION');
    assertScope(context, location.ids.stateId);
    const hub = req.body.hubId ? await ensureHub(req.body.hubId, location.ids.stateId) : undefined;
    const market = await Market.create({
      ...req.body,
      publicId: await nextPublicId('market'),
      ...location.ids,
      ...(hub && { hubId: hub._id.toString() }),
      normalizedName: req.body.name.trim().toLowerCase(),
    });
    await recordAudit(req, { action: 'market.created', entityType: 'market', entityId: market.id, entityPublicId: market.publicId, stateId: market.stateId, hubId: market.hubId, after: market.toObject() });
    publishMarketUpdate(market);
    await sendPlatformCreated(res, market.toObject());
  };
  updateMarket = async (req: Request, res: Response) => {
    await access(req, 'markets.manage');
    const market = await byIdentifier(Market, routeParam(req.params.id));
    const context = await resolveAccessContext(req.user!.sub); assertScope(context, market.stateId, market.hubId);
    const location = await resolveLocation({
      stateId: req.body.stateId || market.stateId,
      cityId: req.body.cityId || market.cityId,
      zoneId: req.body.zoneId || market.zoneId,
    });
    const operatingState = await OperationState.findById(location.ids.stateId).select('operationsEnabled').lean();
    if (!operatingState?.operationsEnabled) throw new HttpError(409, 'Hook operations are not enabled in this State', undefined, 'INVALID_STATE_TRANSITION');
    assertScope(context, location.ids.stateId);
    const hub = req.body.hubId
      ? await ensureHub(req.body.hubId, location.ids.stateId)
      : market.hubId
        ? await ensureHub(market.hubId, location.ids.stateId)
        : undefined;
    const updated = await Market.findByIdAndUpdate(market._id, { $set: {
      ...req.body,
      ...location.ids,
      ...(hub && { hubId: hub._id.toString() }),
      ...(req.body.name && { normalizedName: req.body.name.trim().toLowerCase() }),
    } }, { returnDocument: 'after' }).lean({ virtuals: true });
    await recordAudit(req, { action: 'market.updated', entityType: 'market', entityId: market._id.toString(), entityPublicId: market.publicId, stateId: market.stateId, hubId: market.hubId, before: market, after: updated, reason: req.body.reason });
    publishMarketUpdate(updated);
    await sendPlatformSuccess(res, updated);
  };
  marketStatus = (req: Request, res: Response) => lifecycle(req, res, Market, 'markets.manage', 'market', req.path.endsWith('/activate') ? 'active' : 'inactive');
  assignMarketHub = async (req: Request, res: Response) => {
    await access(req, 'markets.assign_hub');
    const market = await byIdentifier(Market, routeParam(req.params.id));
    const hub = await ensureHub(req.body.hubId, market.stateId);
    const updated = await Market.findByIdAndUpdate(market._id, { $set: { hubId: hub._id.toString() } }, { returnDocument: 'after' }).lean({ virtuals: true });
    await recordAudit(req, { action: 'market.hub_assigned', entityType: 'market', entityId: market._id.toString(), entityPublicId: market.publicId, stateId: market.stateId, hubId: hub._id.toString(), before: { hubId: market.hubId }, after: { hubId: hub._id.toString() }, reason: req.body.reason });
    publishMarketUpdate(updated);
    await sendPlatformSuccess(res, updated);
  };

  listHubs = async (req: Request, res: Response) => sendSuccess(res, await listScoped(req, DispatchHub, 'hubs.view'));
  hubDetail = async (req: Request, res: Response) => sendSuccess(res, await detailScoped(req, DispatchHub, 'hubs.view'));
  createHub = async (req: Request, res: Response) => {
    const context = await access(req, 'hubs.manage');
    const location = await resolveLocation(req.body);
    assertScope(context, location.ids.stateId);
    const zoneIds = await resolveIdentifiers(ServiceZone, req.body.zoneIds || []);
    const zones = await ServiceZone.find({ _id: { $in: zoneIds } }).lean();
    if (zones.some((zone) => zone.stateId !== location.ids.stateId || zone.cityId !== location.ids.cityId)) {
      throw new HttpError(409, 'Every Service Zone must belong to the Dispatch Hub City and State', undefined, 'CONFLICT');
    }
    const staffIds = await resolveIdentifiers(StaffProfile, req.body.staffIds || []);
    const hub = await DispatchHub.create({
      ...req.body,
      publicId: await nextPublicId('hub'),
      ...location.ids,
      zoneIds,
      marketIds: [],
      staffIds,
    });
    await recordAudit(req, { action: 'hub.created', entityType: 'hub', entityId: hub.id, entityPublicId: hub.publicId, stateId: hub.stateId, hubId: hub.id, after: hub.toObject() });
    await sendPlatformCreated(res, hub.toObject());
  };
  updateHub = async (req: Request, res: Response) => {
    await access(req, 'hubs.manage');
    const hub = await byIdentifier(DispatchHub, routeParam(req.params.id));
    const context = await resolveAccessContext(req.user!.sub); assertScope(context, hub.stateId, hub._id.toString());
    const location = await resolveLocation({
      stateId: req.body.stateId || hub.stateId,
      cityId: req.body.cityId || hub.cityId,
    });
    assertScope(context, location.ids.stateId, hub._id.toString());
    const zoneIds = req.body.zoneIds
      ? await resolveIdentifiers(ServiceZone, req.body.zoneIds)
      : hub.zoneIds;
    const zones = await ServiceZone.find({ _id: { $in: zoneIds } }).lean();
    if (zones.some((zone) => zone.stateId !== location.ids.stateId || zone.cityId !== location.ids.cityId)) {
      throw new HttpError(409, 'Every Service Zone must belong to the Dispatch Hub City and State', undefined, 'CONFLICT');
    }
    const marketIds = req.body.marketIds
      ? await resolveIdentifiers(Market, req.body.marketIds)
      : hub.marketIds;
    const markets = await Market.find({ _id: { $in: marketIds } }).lean();
    if (markets.some((market) => market.stateId !== location.ids.stateId)) {
      throw new HttpError(409, 'Every Market must belong to the Dispatch Hub state', undefined, 'CONFLICT');
    }
    const staffIds = req.body.staffIds
      ? await resolveIdentifiers(StaffProfile, req.body.staffIds)
      : hub.staffIds;
    const updated = await DispatchHub.findByIdAndUpdate(
      hub._id,
      { $set: { ...req.body, ...location.ids, zoneIds, marketIds, staffIds } },
      { returnDocument: 'after' },
    ).lean({ virtuals: true });
    await recordAudit(req, { action: 'hub.updated', entityType: 'hub', entityId: hub._id.toString(), entityPublicId: hub.publicId, stateId: hub.stateId, hubId: hub._id.toString(), before: hub, after: updated, reason: req.body.reason });
    await sendPlatformSuccess(res, updated);
  };
  hubStatus = (req: Request, res: Response) => lifecycle(req, res, DispatchHub, 'hubs.manage', 'hub', req.path.endsWith('/activate') ? 'active' : 'inactive');
  assignHubMarkets = async (req: Request, res: Response) => {
    await access(req, 'hubs.assign_markets');
    const hub = await byIdentifier(DispatchHub, routeParam(req.params.id));
    const marketIds = await resolveIdentifiers(Market, req.body.marketIds);
    const markets = await Market.find({ _id: { $in: marketIds } }).lean();
    if (markets.length !== marketIds.length || markets.some((market) => market.stateId !== hub.stateId)) {
      throw new HttpError(409, 'Every Market must belong to the Dispatch Hub state', undefined, 'CONFLICT');
    }
    await Promise.all([
      DispatchHub.updateOne({ _id: hub._id }, { $set: { marketIds } }),
      Market.updateMany({ _id: { $in: marketIds } }, { $set: { hubId: hub._id.toString() } }),
    ]);
    await recordAudit(req, { action: 'hub.markets_assigned', entityType: 'hub', entityId: hub._id.toString(), entityPublicId: hub.publicId, stateId: hub.stateId, hubId: hub._id.toString(), before: { marketIds: hub.marketIds }, after: { marketIds: req.body.marketIds }, reason: req.body.reason });
    await sendPlatformSuccess(res, { marketIds });
  };

  listPartners = async (req: Request, res: Response) => sendSuccess(res, await listScoped(req, HookPartner, 'partners.view'));
  partnerDetail = async (req: Request, res: Response) => sendSuccess(res, await detailScoped(req, HookPartner, 'partners.view'));
  createPartner = async (req: Request, res: Response) => {
    const context = await access(req, 'partners.manage');
    const location = await resolveLocation(req.body);
    assertScope(context, location.ids.stateId);
    const publicId = await nextPublicId('partner');
    const account = await User.create({
      publicId, accountType: AccountType.PARTNER, accountStatus: AccountStatus.INVITED,
      email: req.body.email, phone: req.body.phone, password: req.body.password ? await hashPassword(req.body.password) : undefined,
      firstName: req.body.firstName, lastName: req.body.lastName, role: UserRole.PARTNER,
      isActive: true, isEmailVerified: false, isPhoneVerified: false, scopeType: ScopeType.SELF,
    });
    const partner = await HookPartner.create({
      ...req.body,
      ...location.ids,
      publicId,
      accountId: account.id,
      status: 'invited',
    });
    const invitation = await issueAccountInvitation({
      accountId: account.id,
      accountType: AccountType.PARTNER,
      email: account.email,
      name: `${account.firstName} ${account.lastName}`.trim(),
      invitedBy: req.user!.sub,
    });
    await recordAudit(req, { action: 'partner.created', entityType: 'partner', entityId: partner.id, entityPublicId: publicId, stateId: partner.stateId, after: partner.toObject() });
    sendCreated(res, { ...await presentPlatformRecords(partner.toObject()), invitation });
  };
  updatePartner = async (req: Request, res: Response) => {
    await access(req, 'partners.manage');
    const partner = await byIdentifier(HookPartner, routeParam(req.params.id));
    const context = await resolveAccessContext(req.user!.sub); assertScope(context, partner.stateId);
    const location = await resolveLocation({
      stateId: req.body.stateId || partner.stateId,
      cityId: req.body.cityId || partner.cityId,
      zoneId: req.body.zoneId || partner.zoneId,
    });
    assertScope(context, location.ids.stateId);
    const updated = await HookPartner.findByIdAndUpdate(
      partner._id,
      { $set: { ...req.body, ...location.ids } },
      { returnDocument: 'after' },
    ).lean({ virtuals: true });
    await recordAudit(req, { action: 'partner.updated', entityType: 'partner', entityId: partner._id.toString(), entityPublicId: partner.publicId, stateId: partner.stateId, before: partner, after: updated, reason: req.body.reason });
    await sendPlatformSuccess(res, updated);
  };
  partnerStatus = async (req: Request, res: Response) => {
    const context = await access(req, 'partners.manage');
    const partner = await byIdentifier(HookPartner, routeParam(req.params.id));
    assertScope(context, partner.stateId);
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
    const context = await access(req, 'partners.manage');
    const partner = await byIdentifier(HookPartner, routeParam(req.params.id));
    assertScope(context, partner.stateId);
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

  cancelPartnerInvitation = async (req: Request, res: Response) => {
    const context = await access(req, 'partners.manage');
    const partner = await byIdentifier(HookPartner, routeParam(req.params.id));
    assertScope(context, partner.stateId);
    if (partner.status !== AccountStatus.INVITED) {
      throw new HttpError(409, 'Only pending Partner invitations can be cancelled', undefined, 'INVALID_STATE_TRANSITION');
    }
    const revokedInvitations = await revokeAccountInvitations(partner.accountId);
    await Promise.all([
      HookPartner.updateOne({ _id: partner._id }, { $set: { status: AccountStatus.DISABLED } }),
      User.updateOne({ _id: partner.accountId }, { $set: { accountStatus: AccountStatus.DISABLED, isActive: false } }),
    ]);
    await recordAudit(req, {
      action: 'partner.invitation_cancelled',
      entityType: 'partner',
      entityId: partner._id.toString(),
      entityPublicId: partner.publicId,
      stateId: partner.stateId,
      before: { status: partner.status },
      after: { status: AccountStatus.DISABLED, revokedInvitations },
      reason: req.body.reason,
    });
    sendSuccess(res, { status: AccountStatus.DISABLED, revokedInvitations });
  };

  listRunners = async (req: Request, res: Response) => {
    const context = await access(req, 'runners.view');
    const { stateId, hubId } = await stateAndHub(req);
    const { page, limit, skip } = getPagination(req.query);
    const filter = context.scopeType === ScopeType.GLOBAL
      ? { ...(stateId && { stateIds: stateId }), ...(hubId && { hubIds: hubId }) }
      : context.scopeType === ScopeType.HUB
        ? { hubIds: hubId || { $in: context.hubIds } }
        : { stateIds: stateId || { $in: context.stateIds } };
    const [data, total] = await Promise.all([RunnerProfile.find(filter).skip(skip).limit(limit).lean({ virtuals: true }), RunnerProfile.countDocuments(filter)]);
    sendSuccess(res, paginated(await presentPlatformRecords(data), total, page, limit));
  };
  runnerDetail = async (req: Request, res: Response) => {
    const context = await access(req, 'runners.view');
    const runner = await byIdentifier(RunnerProfile, routeParam(req.params.id));
    if (context.scopeType !== ScopeType.GLOBAL && !runner.stateIds.some((stateId) => context.stateIds.includes(stateId))) {
      throw new HttpError(403, 'Runner is outside your assigned operational scope', undefined, 'SCOPE_DENIED');
    }
    for (const hubId of runner.hubIds) assertScope(context, undefined, hubId);
    await sendPlatformSuccess(res, runner);
  };
  createRunner = async (req: Request, res: Response) => {
    const context = await access(req, 'runners.manage');
    const scope = await resolveRunnerScope(req.body.stateIds, req.body.hubIds);
    for (const stateId of scope.stateIds) assertScope(context, stateId);
    for (const hubId of scope.hubIds) assertScope(context, undefined, hubId);
    const publicId = await nextPublicId('runner');
    const account = await User.create({
      publicId, accountType: AccountType.RUNNER, accountStatus: AccountStatus.INVITED,
      email: req.body.email, phone: req.body.phone, password: req.body.password ? await hashPassword(req.body.password) : undefined,
      firstName: req.body.firstName, lastName: req.body.lastName, role: UserRole.RUNNER,
      isActive: true, isEmailVerified: false, isPhoneVerified: false, scopeType: ScopeType.SELF,
    });
    const runner = await RunnerProfile.create({ publicId, accountId: account.id, stateIds: scope.stateIds, hubIds: scope.hubIds, availability: 'unavailable', status: 'invited' });
    const invitation = await issueAccountInvitation({
      accountId: account.id,
      accountType: AccountType.RUNNER,
      email: account.email,
      name: `${account.firstName} ${account.lastName}`.trim(),
      invitedBy: req.user!.sub,
    });
    await recordAudit(req, { action: 'runner.created', entityType: 'runner', entityId: runner.id, entityPublicId: publicId, after: runner.toObject() });
    sendCreated(res, { ...await presentPlatformRecords(runner.toObject()), invitation });
  };
  updateRunner = async (req: Request, res: Response) => {
    const context = await access(req, 'runners.manage');
    const runner = await byIdentifier(RunnerProfile, routeParam(req.params.id));
    const scope = await resolveRunnerScope(req.body.stateIds || runner.stateIds, req.body.hubIds || runner.hubIds);
    for (const stateId of scope.stateIds) assertScope(context, stateId);
    for (const hubId of scope.hubIds) assertScope(context, undefined, hubId);
    const updated = await RunnerProfile.findByIdAndUpdate(runner._id, {
      $set: { ...req.body, stateIds: scope.stateIds, hubIds: scope.hubIds },
    }, { returnDocument: 'after' }).lean({ virtuals: true });
    await recordAudit(req, { action: 'runner.updated', entityType: 'runner', entityId: runner._id.toString(), entityPublicId: runner.publicId, before: runner, after: updated, reason: req.body.reason });
    await sendPlatformSuccess(res, updated);
  };
  runnerStatus = async (req: Request, res: Response) => {
    const context = await access(req, 'runners.manage');
    const runner = await byIdentifier(RunnerProfile, routeParam(req.params.id));
    for (const stateId of runner.stateIds) assertScope(context, stateId);
    for (const hubId of runner.hubIds) assertScope(context, undefined, hubId);
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
    const context = await access(req, 'runners.manage');
    const runner = await byIdentifier(RunnerProfile, routeParam(req.params.id));
    for (const stateId of runner.stateIds) assertScope(context, stateId);
    for (const hubId of runner.hubIds) assertScope(context, undefined, hubId);
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

  cancelRunnerInvitation = async (req: Request, res: Response) => {
    const context = await access(req, 'runners.manage');
    const runner = await byIdentifier(RunnerProfile, routeParam(req.params.id));
    for (const stateId of runner.stateIds) assertScope(context, stateId);
    for (const hubId of runner.hubIds) assertScope(context, undefined, hubId);
    if (runner.status !== AccountStatus.INVITED) {
      throw new HttpError(409, 'Only pending Runner invitations can be cancelled', undefined, 'INVALID_STATE_TRANSITION');
    }
    const revokedInvitations = await revokeAccountInvitations(runner.accountId);
    await Promise.all([
      RunnerProfile.updateOne({ _id: runner._id }, { $set: { status: AccountStatus.DISABLED } }),
      User.updateOne({ _id: runner.accountId }, { $set: { accountStatus: AccountStatus.DISABLED, isActive: false } }),
    ]);
    await recordAudit(req, {
      action: 'runner.invitation_cancelled',
      entityType: 'runner',
      entityId: runner._id.toString(),
      entityPublicId: runner.publicId,
      before: { status: runner.status },
      after: { status: AccountStatus.DISABLED, revokedInvitations },
      reason: req.body.reason,
    });
    sendSuccess(res, { status: AccountStatus.DISABLED, revokedInvitations });
  };

  listAssignments = async (req: Request, res: Response) => sendSuccess(res, await listScoped(req, RunnerMarketAssignment, 'runners.assign'));
  assignmentDetail = async (req: Request, res: Response) => sendSuccess(res, await detailScoped(req, RunnerMarketAssignment, 'runners.assign'));
  createAssignment = async (req: Request, res: Response) => {
    const context = await access(req, 'runners.assign');
    const runner = await byIdentifier(RunnerProfile, req.body.runnerId);
    const market = await byIdentifier(Market, req.body.marketId);
    const preferredHub = req.body.preferredHubId
      ? await ensureHub(req.body.preferredHubId, market.stateId)
      : undefined;
    assertScope(context, market.stateId, preferredHub?._id.toString());
    if (!runner.stateIds.includes(market.stateId)) throw new HttpError(409, 'Runner is not assigned to the Market state', undefined, 'CONFLICT');
    const assignment = await RunnerMarketAssignment.create({
      ...req.body,
      stateId: market.stateId,
      runnerId: runner._id.toString(),
      marketId: market._id.toString(),
      ...(preferredHub && { preferredHubId: preferredHub._id.toString() }),
      createdBy: req.user!.sub,
      history: [{ action: 'created', at: new Date(), actorId: req.user!.sub }],
    });
    await recordAudit(req, { action: 'runner_assignment.created', entityType: 'runner_assignment', entityId: assignment.id, stateId: assignment.stateId, hubId: assignment.preferredHubId, after: assignment.toObject() });
    await sendPlatformCreated(res, assignment.toObject());
  };
  updateAssignment = async (req: Request, res: Response) => {
    await access(req, 'runners.assign');
    const assignment = await byIdentifier(RunnerMarketAssignment, routeParam(req.params.id));
    const context = await resolveAccessContext(req.user!.sub); assertScope(context, assignment.stateId, assignment.preferredHubId);
    const runner = await byIdentifier(RunnerProfile, req.body.runnerId || assignment.runnerId);
    const market = await byIdentifier(Market, req.body.marketId || assignment.marketId);
    const preferredHub = req.body.preferredHubId
      ? await ensureHub(req.body.preferredHubId, market.stateId)
      : assignment.preferredHubId
        ? await ensureHub(assignment.preferredHubId, market.stateId)
        : undefined;
    if (!runner.stateIds.includes(market.stateId)) {
      throw new HttpError(409, 'Runner is not assigned to the Market state', undefined, 'CONFLICT');
    }
    assertScope(context, market.stateId, preferredHub?._id.toString());
    const updated = await RunnerMarketAssignment.findByIdAndUpdate(assignment._id, {
      $set: {
        ...req.body,
        runnerId: runner._id.toString(),
        marketId: market._id.toString(),
        stateId: market.stateId,
        ...(preferredHub && { preferredHubId: preferredHub._id.toString() }),
        updatedBy: req.user!.sub,
      },
      $push: { history: { action: 'updated', at: new Date(), actorId: req.user!.sub, reason: req.body.reason } },
    }, { returnDocument: 'after' }).lean({ virtuals: true });
    await recordAudit(req, { action: 'runner_assignment.updated', entityType: 'runner_assignment', entityId: assignment._id.toString(), stateId: assignment.stateId, hubId: assignment.preferredHubId, before: assignment, after: updated, reason: req.body.reason });
    await sendPlatformSuccess(res, updated);
  };
  assignmentStatus = async (req: Request, res: Response) => {
    await access(req, 'runners.assign');
    const assignment = await byIdentifier(RunnerMarketAssignment, routeParam(req.params.id));
    const context = await resolveAccessContext(req.user!.sub);
    assertScope(context, assignment.stateId, assignment.preferredHubId);
    const status = req.path.endsWith('/activate') ? 'active' : req.path.endsWith('/pause') ? 'paused' : 'ended';
    const updated = await RunnerMarketAssignment.findByIdAndUpdate(assignment._id, {
      $set: { status, updatedBy: req.user!.sub, ...(status === 'ended' && { activeTo: new Date() }) },
      $push: { history: { action: status, at: new Date(), actorId: req.user!.sub, reason: req.body.reason } },
    }, { returnDocument: 'after' }).lean({ virtuals: true });
    await recordAudit(req, { action: `runner_assignment.${status}`, entityType: 'runner_assignment', entityId: assignment._id.toString(), stateId: assignment.stateId, hubId: assignment.preferredHubId, before: { status: assignment.status }, after: { status }, reason: req.body.reason });
    await sendPlatformSuccess(res, updated);
  };

  auditLogs = async (req: Request, res: Response) => {
    await access(req, 'audit.view');
    const { page, limit, skip } = getPagination(req.query);
    const filter: Record<string, unknown> = {};
    for (const key of ['action', 'entityType', 'entityId', 'entityPublicId', 'actorId', 'stateId']) {
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
