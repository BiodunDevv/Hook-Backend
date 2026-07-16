import { NextFunction, Request, Response } from 'express';
import { UserRole } from '@lib/constants';
import { HttpError } from '@utils/http';

/**
 * All granular permission keys — mirrors hook-admin/lib/permissions.ts exactly.
 */
export type Permission =
  | 'orders.view'   | 'orders.edit'   | 'orders.create'
  | 'products.view' | 'products.review' | 'products.edit'
  | 'vendors.view'  | 'vendors.approve' | 'vendors.edit'
  | 'customers.view' | 'customers.edit'
  | 'drivers.view'  | 'drivers.edit'
  | 'field_agents.view'
  | 'booths.view'   | 'booths.edit'
  | 'financials.view'
  | 'financials.refund' | 'financials.reconcile'
  | 'refunds.view' | 'refunds.manage'
  | 'booths.inventory'
  | 'deletions.view' | 'deletions.manage'
  | 'analytics.checkout'
  | 'reports.view'
  | 'ai_negotiation.view'
  | 'settings.view';

/**
 * requirePermission(perm)
 *
 * - super_admin  → always passes
 * - admin        → always passes
 * - support      → passes only when user.permissions includes `perm`
 * - any other    → 403
 *
 * Must be used AFTER requireAuth + requireAdmin.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(new HttpError(401, 'Authentication required'));

    if (user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN) {
      return next();
    }

    if (user.role === UserRole.SUPPORT) {
      if (user.permissions.includes(permission)) return next();
      return next(new HttpError(403, `Permission denied: ${permission}`));
    }

    return next(new HttpError(403, 'You do not have permission to access this resource'));
  };
}
