import { Request, Response } from 'express';
import { UserRole } from '@lib/constants';
import { sendSuccess } from '@utils/http';
import { adminRepos } from './admin.helpers';

const STAFF_ROLES = [UserRole.SUPPORT, UserRole.ADMIN, UserRole.SUPER_ADMIN];

function matches(value: unknown, q: string): boolean {
  return String(value || '').toLowerCase().includes(q);
}

function userHasPermission(req: Request, permission: string): boolean {
  const user = req.user;
  if (!user) return false;
  if (user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN) return true;
  if (user.role === UserRole.SUPPORT) return user.permissions.includes(permission);
  return false;
}

export class AdminSearchController {
  global = async (req: Request, res: Response) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const limit = Math.min(parseInt(String(req.query.limit || '5'), 10), 10);

    if (q.length < 2) {
      return sendSuccess(res, { query: q, orders: [], products: [], customers: [], staff: [], total: 0 });
    }

    const isSuperAdmin = req.user?.role === UserRole.SUPER_ADMIN;
    const canOrders    = userHasPermission(req, 'orders.view');
    const canProducts  = userHasPermission(req, 'products.view');
    const canCustomers = userHasPermission(req, 'customers.view');

    // Fetch only what the caller can see in parallel
    const [allOrders, allProducts, allUsers, allStaff] = await Promise.all([
      canOrders    ? adminRepos.orders().find({ relations: { user: true }, order: { createdAt: 'DESC' } }) : Promise.resolve([]),
      canProducts  ? adminRepos.products().find({ order: { createdAt: 'DESC' } }) : Promise.resolve([]),
      canCustomers ? adminRepos.users().find({ where: { role: UserRole.SHOPPER }, order: { createdAt: 'DESC' } }) : Promise.resolve([]),
      // Staff bucket: super_admin only, searches across all staff roles
      isSuperAdmin ? adminRepos.users().find({ order: { createdAt: 'DESC' } }) : Promise.resolve([]),
    ]);

    const orders = (allOrders as any[])
      .filter((o) =>
        matches(o.orderCode, q) ||
        matches(o.user?.email, q) ||
        matches(o.user?.firstName, q) ||
        matches(o.user?.lastName, q) ||
        matches(`${o.user?.firstName || ''} ${o.user?.lastName || ''}`, q),
      )
      .slice(0, limit)
      .map((o) => ({
        id: o.id,
        orderCode: o.orderCode,
        status: o.status,
        paymentStatus: o.paymentStatus,
        total: o.total,
        customer: `${o.user?.firstName || ''} ${o.user?.lastName || ''}`.trim() || o.user?.email || 'Unknown',
        createdAt: o.createdAt,
      }));

    const products = (allProducts as any[])
      .filter((p) =>
        matches(p.title, q) ||
        matches(p.hookId, q),
      )
      .slice(0, limit)
      .map((p) => ({
        id: p.id,
        title: p.title,
        hookId: p.hookId,
        status: p.status,
        sellingPrice: p.sellingPrice,
        image: Array.isArray(p.images) ? p.images[0] : null,
      }));

    const customers = (allUsers as any[])
      .filter((u) =>
        matches(u.email, q) ||
        matches(u.firstName, q) ||
        matches(u.lastName, q) ||
        matches(`${u.firstName || ''} ${u.lastName || ''}`, q),
      )
      .slice(0, limit)
      .map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        isActive: u.isActive,
        isEmailVerified: u.isEmailVerified,
      }));

    // Staff results are limited to active administrative role families.
    const staff = (allStaff as any[])
      .filter((u) =>
        STAFF_ROLES.includes(u.role) && (
          matches(u.email, q) ||
          matches(u.firstName, q) ||
          matches(u.lastName, q) ||
          matches(`${u.firstName || ''} ${u.lastName || ''}`, q) ||
          matches(u.role, q)
        ),
      )
      .slice(0, limit)
      .map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        permissions: Array.isArray(u.permissions) ? u.permissions : [],
      }));

    const total = orders.length + products.length + customers.length + staff.length;

    return sendSuccess(res, { query: q, orders, products, customers, staff, total });
  };
}
