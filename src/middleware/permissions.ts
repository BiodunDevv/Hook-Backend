import { NextFunction, Request, Response } from 'express';
import { HttpError } from '@utils/http';

/**
 * All granular permission keys — mirrors hook-admin/lib/permissions.ts exactly.
 */
export type Permission =
  | 'orders.view'   | 'orders.edit'   | 'orders.create'
  | 'products.view' | 'products.review' | 'products.edit'
  | 'customers.view' | 'customers.edit'
  | 'runners.view' | 'runners.manage'
  | 'financials.view'
  | 'financials.refund' | 'financials.reconcile'
  | 'refunds.view' | 'refunds.manage'
  | 'deletions.view' | 'deletions.manage'
  | 'reports.view'
  | 'ai_negotiation.view'
  | 'settings.view'
  | string;

/**
 * requirePermission(perm)
 *
 * Permissions are resolved from active Role records on every authenticated
 * request. Legacy User role enums are not authorization grants.
 *
 * Must be used AFTER requireAuth + requireAdmin.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(new HttpError(401, 'Authentication required'));

    if (user.roleKeys?.includes('SUPER_ADMIN')) {
      return next();
    }
    if (user.accountType === 'staff' && user.permissions.includes(permission)) {
      return next();
    }
    return next(new HttpError(403, `Permission denied: ${permission}`, undefined, 'ACCESS_DENIED'));
  };
}
