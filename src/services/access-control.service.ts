import { ScopeType } from '@lib/constants';
import { Role } from '@models/platform/access.model';
import { StaffProfile } from '@models/platform/operations-accounts.model';
import { User } from '@models/users/user.model';
import { HttpError } from '@utils/http';

export interface AccessContext {
  permissions: string[];
  roleKeys: string[];
  scopeType: ScopeType;
  stateIds: string[];
  hubIds: string[];
}

export async function resolveAccessContext(accountId: string): Promise<AccessContext> {
  const [user, staff] = await Promise.all([
    User.findById(accountId).lean(),
    StaffProfile.findOne({ accountId }).lean(),
  ]);
  if (!user || !staff || user.accountStatus !== 'active' || staff.status !== 'active') {
    throw new HttpError(401, 'Account is not active', undefined, 'TOKEN_INVALID');
  }
  const roles = await Role.find({ _id: { $in: staff.roleIds }, isActive: true }).lean();
  const roleKeys = roles.map((role) => role.key);
  const permissions = [...new Set(roles.flatMap((role) => role.permissionKeys))];
  return {
    permissions,
    roleKeys,
    scopeType: staff.scopeType as ScopeType,
    stateIds: staff.stateIds || [],
    hubIds: staff.hubIds || [],
  };
}

export function assertPermission(context: AccessContext, permission: string) {
  if (context.roleKeys.includes('SUPER_ADMIN')) return;
  if (!context.permissions.includes(permission)) {
    throw new HttpError(403, 'You do not have permission to perform this action', undefined, 'ACCESS_DENIED');
  }
}

export function assertScope(context: AccessContext, stateId?: string, hubId?: string) {
  if (context.scopeType === ScopeType.GLOBAL) return;
  if (stateId && !context.stateIds.includes(stateId)) {
    throw new HttpError(403, 'The requested state is outside your assigned scope', undefined, 'SCOPE_DENIED');
  }
  if (hubId && !context.hubIds.includes(hubId)) {
    throw new HttpError(403, 'The requested Hub is outside your assigned scope', undefined, 'SCOPE_DENIED');
  }
}

export function scopedFilter<T>(
  context: AccessContext,
  filter: Record<string, unknown> = {},
  selectedStateId?: string,
  selectedHubId?: string,
) {
  assertScope(context, selectedStateId, selectedHubId);
  const scoped = { ...filter } as Record<string, unknown>;
  if (context.scopeType !== ScopeType.GLOBAL) {
    scoped.stateId = selectedStateId || { $in: context.stateIds };
    if (context.scopeType === ScopeType.HUB) {
      scoped.hubId = selectedHubId || { $in: context.hubIds };
    }
  } else {
    if (selectedStateId) scoped.stateId = selectedStateId;
    if (selectedHubId) scoped.hubId = selectedHubId;
  }
  return scoped;
}
