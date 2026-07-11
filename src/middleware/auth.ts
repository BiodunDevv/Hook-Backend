import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { jwtSecret } from '@config/env';
import { UserRole } from '@lib/constants';
import { MongoRepository } from '@lib/mongo-repository';
import { User } from '@models/users/user.model';
import { HttpError } from '@utils/http';

interface TokenPayload {
  sub: string;
  email: string;
  role: UserRole;
}

async function resolvePermissions(role: UserRole, userId: string): Promise<string[]> {
  // super_admin and admin have all permissions implicitly — no DB hit needed
  if (role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN) return [];
  // support staff have explicit permissions stored on the user document
  if (role === UserRole.SUPPORT) {
    try {
      const repo = new MongoRepository(User);
      const user = await repo.findOne({ id: userId } as any);
      return Array.isArray((user as any)?.permissions) ? (user as any).permissions : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization') || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new HttpError(401, 'Authentication token required'));
  }

  try {
    const payload = jwt.verify(token, jwtSecret()) as TokenPayload;

    // Attach synchronously first so the request proceeds if permissions aren't needed
    req.user = { sub: payload.sub, email: payload.email, role: payload.role, permissions: [] };

    // For support staff, load permissions before continuing
    if (payload.role === UserRole.SUPPORT) {
      resolvePermissions(payload.role, payload.sub)
        .then((perms) => { req.user!.permissions = perms; next(); })
        .catch(() => next());
      return;
    }

    return next();
  } catch {
    return next(new HttpError(401, 'Invalid or expired token'));
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next();

  try {
    const payload = jwt.verify(token, jwtSecret()) as TokenPayload;
    req.user = { sub: payload.sub, email: payload.email, role: payload.role, permissions: [] };
  } catch {
    req.user = undefined;
  }

  next();
}

export function optionalCustomerIdentity(req: Request, _res: Response, next: NextFunction) {
  const guestId = req.header('x-guest-id')?.trim();
  if (guestId && /^[a-zA-Z0-9_-]{12,80}$/.test(guestId)) {
    req.guestId = guestId;
  }
  return optionalAuth(req, _res, next);
}

export function requireCustomerIdentity(req: Request, _res: Response, next: NextFunction) {
  optionalCustomerIdentity(req, _res, () => {
    if (req.user?.sub || req.guestId) return next();
    return next(new HttpError(401, 'Authentication or guest session required'));
  });
}
