import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { jwtSecret } from '@config/env';
import { AccountType, ScopeType, UserRole } from '@lib/constants';
import { isActiveAccount } from '@lib/account-state';
import { AccountSession } from '@models/platform/session.model';
import { User } from '@models/users/user.model';
import { resolveAccessContext } from '@services/access-control.service';
import { HttpError } from '@utils/http';

interface TokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  accountType?: AccountType;
  sid?: string;
}

async function authenticateToken(token: string, req: Request) {
  let payload: TokenPayload;
  try {
    payload = jwt.verify(token, jwtSecret()) as TokenPayload;
  } catch {
    throw new HttpError(401, 'Invalid or expired token', undefined, 'TOKEN_INVALID');
  }
  if (!payload.sid) {
    throw new HttpError(401, 'Legacy session expired. Please sign in again.', undefined, 'TOKEN_INVALID');
  }
  const [session, user] = await Promise.all([
    AccountSession.findById(payload.sid).select('revokedAt expiresAt').lean(),
    User.findById(payload.sub)
      .select('email role publicId accountType accountStatus scopeType assignedStateIds assignedHubIds permissions isActive')
      .lean(),
  ]);
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    throw new HttpError(401, 'Session is no longer active', undefined, 'TOKEN_INVALID');
  }
  if (!user || !isActiveAccount(user)) {
    throw new HttpError(401, 'Account is not active', undefined, 'TOKEN_INVALID');
  }

  // Older shopper records may predate the accountType field.
  const accountType = user.accountType
    || (user.role === UserRole.SHOPPER ? AccountType.CUSTOMER : undefined);

  req.user = {
    sub: payload.sub,
    email: user.email,
    role: user.role,
    accountType,
    publicId: user.publicId,
    permissions: [],
    roleKeys: [],
    scopeType: user.scopeType || ScopeType.SELF,
    assignedStateIds: user.assignedStateIds || [],
    assignedHubIds: user.assignedHubIds || [],
    sid: payload.sid,
  };

  if (accountType === AccountType.STAFF) {
    const access = await resolveAccessContext(user._id.toString(), user);
    Object.assign(req.user, {
      permissions: access.permissions,
      roleKeys: access.roleKeys,
      scopeType: access.scopeType,
      assignedStateIds: access.stateIds,
      assignedHubIds: access.hubIds,
    });
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const [scheme, token] = (req.header('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new HttpError(401, 'Authentication token required', undefined, 'AUTHENTICATION_REQUIRED'));
  }
  try {
    await authenticateToken(token, req);
    next();
  } catch (error) {
    next(error);
  }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const [scheme, token] = (req.header('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) return next();
  try {
    await authenticateToken(token, req);
  } catch {
    req.user = undefined;
  }
  next();
}

export function requireCustomerIdentity(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (req.user?.accountType === AccountType.CUSTOMER) return next();
    return next(new HttpError(403, 'Customer account required', undefined, 'ACCESS_DENIED'));
  });
}

export function requireAccountType(...types: AccountType[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user?.accountType || !types.includes(req.user.accountType)) {
      return next(new HttpError(403, 'This account cannot access the requested resource', undefined, 'ACCESS_DENIED'));
    }
    next();
  };
}
