import { Request, Response } from 'express';
import { AccountType, ScopeType, UserRole } from '@lib/constants';
import { sendSuccess } from '@utils/http';
import { Order } from '@models/orders/order.model';
import { Product } from '@models/products/product.model';
import { User } from '@models/users/user.model';
import { Category } from '@models/categories/category.model';
import { DispatchHub, Market } from '@models/platform/network.model';
import { HookPartner, MarketAssociateProfile } from '@models/platform/operations-accounts.model';

const STAFF_ROLES = [UserRole.SUPPORT, UserRole.ADMIN, UserRole.SUPER_ADMIN];

/**
 * Search results must respect exactly the same permission model as every
 * other admin endpoint — a permission the caller actually has (or Super
 * Admin), not "any ADMIN-role account gets everything." The old check here
 * auto-granted orders/products search to every ADMIN role regardless of
 * their real permission array, which is inconsistent with how every other
 * controller in this codebase enforces access via assertPermission().
 */
function can(req: Request, permission: string): boolean {
  const user = req.user;
  if (!user) return false;
  if (user.roleKeys?.includes('SUPER_ADMIN') || user.role === UserRole.SUPER_ADMIN) return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

function inScope(req: Request) {
  const user = req.user;
  const scopeType = user?.scopeType || ScopeType.SELF;
  const stateIds = user?.assignedStateIds || [];
  const hubIds = user?.assignedHubIds || [];
  const isGlobal = user?.roleKeys?.includes('SUPER_ADMIN') || user?.role === UserRole.SUPER_ADMIN || scopeType === ScopeType.GLOBAL;
  return {
    /** Adds a state/hub scope clause to a filter, or returns it unchanged for global scope. */
    state(filter: Record<string, unknown>, field = 'stateId') {
      if (isGlobal) return filter;
      return { ...filter, [field]: { $in: stateIds } };
    },
    hub(filter: Record<string, unknown>, field = 'hubId') {
      if (isGlobal || scopeType !== ScopeType.HUB) return filter;
      return { ...filter, [field]: { $in: hubIds } };
    },
  };
}

export class AdminSearchController {
  global = async (req: Request, res: Response) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const limit = Math.min(parseInt(String(req.query.limit || '5'), 10), 10);
    const empty = { query: q, orders: [], products: [], customers: [], staff: [], marketAssociates: [], partners: [], markets: [], hubs: [], categories: [], total: 0 };

    if (q.length < 2) return sendSuccess(res, empty);

    const canOrders = can(req, 'orders.view');
    const canProducts = can(req, 'products.view');
    const canCustomers = can(req, 'customers.view');
    const canStaff = can(req, 'staff.view');
    const canMarketAssociates = can(req, 'runners.view');
    const canPartners = can(req, 'partners.view');
    const canMarkets = can(req, 'markets.view');
    const canHubs = can(req, 'hubs.view');
    const canCategories = can(req, 'categories.view');
    const scope = inScope(req);
    const expression = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const userMatches = (canCustomers || canStaff)
      ? await User.find({
          $or: [
            { email: expression },
            { firstName: expression },
            { lastName: expression },
            { role: expression },
          ],
          role: { $in: [UserRole.SHOPPER, ...STAFF_ROLES] },
        })
          .select('firstName lastName email role isActive isEmailVerified permissions publicId')
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

    // Market Associates and Partners have their own account (name/email), so
    // matching requires the same two-step User lookup used by their list
    // endpoints — the profile document itself has no name field to search.
    const accountMatches = (canMarketAssociates || canPartners)
      ? await User.find({
          $or: [{ email: expression }, { firstName: expression }, { lastName: expression }],
          accountType: { $in: [AccountType.MARKETASSOCIATE, AccountType.PARTNER] },
        })
          .select('firstName lastName email accountType')
          .limit(limit * 4)
          .lean()
      : [];
    const marketAssociateAccountIds = (accountMatches as any[])
      .filter((account) => account.accountType === AccountType.MARKETASSOCIATE)
      .map((account) => String(account._id));
    const partnerAccountIds = (accountMatches as any[])
      .filter((account) => account.accountType === AccountType.PARTNER)
      .map((account) => String(account._id));

    const [
      ordersRows,
      productsRows,
      marketAssociateRows,
      partnerRows,
      marketRows,
      hubRows,
      categoryRows,
    ] = await Promise.all([
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
      canMarketAssociates
        ? MarketAssociateProfile.find(scope.state({
            $or: [
              { publicId: expression },
              ...(marketAssociateAccountIds.length ? [{ accountId: { $in: marketAssociateAccountIds } }] : []),
            ],
          }))
          .select('publicId accountId stateIds status')
          .limit(limit)
          .lean({ virtuals: true })
        : [],
      canPartners
        ? HookPartner.find(scope.state({
            $or: [
              { name: expression },
              { address: expression },
              { publicId: expression },
              ...(partnerAccountIds.length ? [{ accountId: { $in: partnerAccountIds } }] : []),
            ],
          }))
          .select('publicId name address stateId status')
          .limit(limit)
          .lean({ virtuals: true })
        : [],
      canMarkets
        ? Market.find(scope.state({
            $or: [{ name: expression }, { address: expression }, { publicId: expression }],
          }))
          .select('publicId name address stateId status')
          .limit(limit)
          .lean({ virtuals: true })
        : [],
      canHubs
        ? DispatchHub.find(scope.hub(scope.state({
            $or: [{ name: expression }, { address: expression }, { publicId: expression }],
          }), '_id'))
          .select('publicId name address stateId status')
          .limit(limit)
          .lean({ virtuals: true })
        : [],
      canCategories
        ? Category.find({ $or: [{ name: expression }, { publicId: expression }] })
          .select('publicId name isActive')
          .limit(limit)
          .lean({ virtuals: true })
        : [],
    ]);

    const userMap = new Map((userMatches as any[]).map((user) => [String(user._id || user.id), user]));
    const accountMap = new Map((accountMatches as any[]).map((account) => [String(account._id), account]));
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

    const marketAssociates = (marketAssociateRows as any[]).map((profile) => {
      const account = accountMap.get(String(profile.accountId));
      return {
        id: profile.publicId,
        firstName: account?.firstName,
        lastName: account?.lastName,
        email: account?.email,
        status: profile.status,
      };
    });

    const partners = (partnerRows as any[]).map((partner) => ({
      id: partner.publicId,
      name: partner.name,
      address: partner.address,
      status: partner.status,
    }));

    const markets = (marketRows as any[]).map((market) => ({
      id: market.publicId,
      name: market.name,
      address: market.address,
      status: market.status,
    }));

    const hubs = (hubRows as any[]).map((hub) => ({
      id: hub.publicId,
      name: hub.name,
      address: hub.address,
      status: hub.status,
    }));

    const categories = (categoryRows as any[]).map((category) => ({
      id: category.publicId || String(category._id),
      name: category.name,
      isActive: category.isActive,
    }));

    const total = orders.length + products.length + customers.length + staff.length
      + marketAssociates.length + partners.length + markets.length + hubs.length + categories.length;

    return sendSuccess(res, { query: q, orders, products, customers, staff, marketAssociates, partners, markets, hubs, categories, total });
  };
}
