import { NextFunction, Request, Response } from 'express';
import { UserRole } from '@lib/constants';
import { HttpError } from '@utils/http';

export function requireRoles(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Authentication token required'));
    if (!roles.includes(req.user.role)) {
      return next(new HttpError(403, 'You do not have permission to access this resource'));
    }
    return next();
  };
}

export const requireAdmin = requireRoles(UserRole.ADMIN, UserRole.SUPER_ADMIN);
export const requireSuperAdmin = requireRoles(UserRole.SUPER_ADMIN);
