import { Request, Response } from 'express';
import { UserRole } from '@lib/constants';
import { sendSuccess } from '@utils/http';
import { Order } from '@models/orders/order.model';
import { Product } from '@models/products/product.model';
import { User } from '@models/users/user.model';

const STAFF_ROLES = [UserRole.SUPPORT, UserRole.ADMIN, UserRole.SUPER_ADMIN];

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
    const expression = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const userMatches = (canCustomers || isSuperAdmin)
      ? await User.find({
          $or: [
            { email: expression },
            { firstName: expression },
            { lastName: expression },
            { role: expression },
          ],
          role: { $in: [UserRole.SHOPPER, ...STAFF_ROLES] },
        })
          .select('firstName lastName email role isActive isEmailVerified permissions')
          .sort({ createdAt: -1 })
          .limit(limit * 4)
          .lean({ virtuals: true })
      : [];
    const customerIds = (userMatches as any[])
      .filter((user) => user.role === UserRole.SHOPPER)
      .map((user) => String(user._id || user.id));
    const orderFilter = {
      $or: [
        { orderCode: expression },
        { guestEmail: expression },
        { guestName: expression },
        ...(customerIds.length ? [{ userId: { $in: customerIds } }] : []),
      ],
    };

    const [ordersRows, productsRows] = await Promise.all([
      canOrders
        ? Order.find(orderFilter)
          .select('publicId orderCode userId guestEmail guestName status paymentStatus total createdAt')
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean({ virtuals: true })
        : [],
      canProducts
        ? Product.find({
            $or: [
              { title: expression },
              { hookId: expression },
              { publicId: expression },
            ],
          })
          .select('publicId hookId title status sellingPrice sellingPriceMinor images')
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean({ virtuals: true })
        : [],
    ]);

    const userMap = new Map((userMatches as any[]).map((user) => [String(user._id || user.id), user]));
    const orders = (ordersRows as any[]).map((o) => {
      const user = userMap.get(String(o.userId));
      return {
        id: o.publicId || o.orderCode || String(o._id),
        orderCode: o.orderCode,
        status: o.status,
        paymentStatus: o.paymentStatus,
        total: o.total,
        customer: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.email || o.guestEmail || o.guestName || 'Unknown',
        createdAt: o.createdAt,
      };
    });

    const products = (productsRows as any[]).map((p) => ({
        id: p.publicId || p.hookId || String(p._id),
        title: p.title,
        hookId: p.hookId,
        status: p.status,
        sellingPrice: p.sellingPrice,
        image: Array.isArray(p.images) ? p.images[0] : null,
      }));

    const customers = (userMatches as any[])
      .filter((u) => u.role === UserRole.SHOPPER)
      .slice(0, limit)
      .map((u) => ({
        id: u.publicId || String(u._id || u.id),
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        isActive: u.isActive,
        isEmailVerified: u.isEmailVerified,
      }));

    const staff = (userMatches as any[])
      .filter((u) => STAFF_ROLES.includes(u.role))
      .slice(0, limit)
      .map((u) => ({
        id: u.publicId || String(u._id || u.id),
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
