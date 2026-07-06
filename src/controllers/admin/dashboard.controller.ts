import { Request, Response } from 'express';
import {
  LogisticsStatus,
  NegotiationStatus,
  OrderStatus,
  ProductStatus,
  UserRole,
} from '@lib/constants';
import { mongoBetween, mongoIn } from '@lib/mongo-repository';
import { sendSuccess } from '@utils/http';
import { adminRepos } from './admin.helpers';

const activeOrderStatuses = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.PACKED,
  OrderStatus.PICKED_UP,
  OrderStatus.IN_TRANSIT,
];

async function sum(repo: ReturnType<typeof adminRepos.orders>, match: Record<string, unknown>, field: string) {
  const [row] = await repo.aggregate<{ total: number }>([
    { $match: match },
    { $group: { _id: null, total: { $sum: `$${field}` } } },
  ]);
  return Number(row?.total || 0);
}

export class AdminDashboardController {
  dashboard = async (_req: Request, res: Response) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const currentMonthStart = new Date();
    currentMonthStart.setDate(1);
    currentMonthStart.setHours(0, 0, 0, 0);
    const previousMonthStart = new Date(currentMonthStart);
    previousMonthStart.setMonth(previousMonthStart.getMonth() - 1);

    const users = adminRepos.users();
    const vendors = adminRepos.vendors();
    const products = adminRepos.products();
    const orders = adminRepos.orders();
    const logistics = adminRepos.logistics();
    const negotiations = adminRepos.negotiations();

    const [
      activeOrders,
      yesterdayActiveOrders,
      activeDeliveries,
      totalDrivers,
      activeDrivers,
      totalNegotiations,
      acceptedNegotiations,
      activeVendors,
      revenue,
      grossMerchandise,
      previousMonthGmv,
      currentMonthGmv,
      previousMonthRevenue,
      currentMonthRevenue,
      deliverySlaRows,
      avgDeliveryRows,
      negotiationSavingsRows,
      productRatingRows,
    ] = await Promise.all([
      orders.count({ where: { status: mongoIn(activeOrderStatuses) } }),
      orders.count({ where: { createdAt: mongoBetween(yesterdayStart, todayStart), status: mongoIn(activeOrderStatuses) } }),
      logistics.count({ where: { status: LogisticsStatus.IN_TRANSIT } }),
      users.count({ where: { role: UserRole.EV_DRIVER } }),
      users.count({ where: { role: UserRole.EV_DRIVER, isActive: true } }),
      negotiations.count(),
      negotiations.count({ where: { status: NegotiationStatus.ACCEPTED } }),
      vendors.count({ where: { isApproved: true, isActive: true } }),
      sum(orders, { status: OrderStatus.DELIVERED }, 'total'),
      sum(orders, {}, 'total'),
      sum(orders, { createdAt: { $gte: previousMonthStart, $lt: currentMonthStart } }, 'total'),
      sum(orders, { createdAt: { $gte: currentMonthStart } }, 'total'),
      sum(orders, { status: OrderStatus.DELIVERED, createdAt: { $gte: previousMonthStart, $lt: currentMonthStart } }, 'total'),
      sum(orders, { status: OrderStatus.DELIVERED, createdAt: { $gte: currentMonthStart } }, 'total'),
      logistics.aggregate<{ total: number; onTime: number }>([
        { $match: { status: LogisticsStatus.DELIVERED } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            onTime: {
              $sum: {
                $cond: [
                  { $and: ['$deliveredAt', '$estimatedDeliveryAt', { $lte: ['$deliveredAt', '$estimatedDeliveryAt'] }] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
      logistics.aggregate<{ hours: number }>([
        { $match: { deliveredAt: { $ne: null } } },
        { $project: { hours: { $divide: [{ $subtract: ['$deliveredAt', '$createdAt'] }, 1000 * 60 * 60] } } },
        { $group: { _id: null, hours: { $avg: '$hours' } } },
      ]),
      negotiations.aggregate<{ average: number }>([
        { $match: { status: NegotiationStatus.ACCEPTED } },
        {
          $project: {
            savings: {
              $subtract: [
                '$sellingPrice',
                { $ifNull: ['$acceptedPrice', '$counterPrice'] },
              ],
            },
          },
        },
        { $group: { _id: null, average: { $avg: '$savings' } } },
      ]),
      products.aggregate<{ rating: number; reviews: number }>([
        { $match: { status: ProductStatus.APPROVED, averageRating: { $gt: 0 } } },
        { $group: { _id: null, rating: { $avg: '$averageRating' }, reviews: { $sum: '$orderCount' } } },
      ]),
    ]);

    const deliverySla = deliverySlaRows[0];
    const avgDelivery = avgDeliveryRows[0];
    const negotiationSavings = negotiationSavingsRows[0];
    const productRatings = productRatingRows[0];
    const deliverySlaPercent = deliverySla?.total ? Number(((deliverySla.onTime / deliverySla.total) * 100).toFixed(1)) : 0;
    const negotiationConversionRate = totalNegotiations ? Number(((acceptedNegotiations / totalNegotiations) * 100).toFixed(1)) : 0;
    const growth = (current: number, previous: number) => (
      previous ? Number((((current - previous) / previous) * 100).toFixed(1)) : current ? 100 : 0
    );
    const utilization = totalDrivers ? Number(((activeDeliveries / totalDrivers) * 100).toFixed(0)) : 0;

    sendSuccess(res, {
      grossMerchandise: { value: grossMerchandise, change: growth(currentMonthGmv, previousMonthGmv), caption: 'vs last month' },
      totalRevenue: { value: revenue, change: growth(currentMonthRevenue, previousMonthRevenue), caption: 'vs last month' },
      activeOrders: { value: activeOrders, change: growth(activeOrders, yesterdayActiveOrders), caption: 'vs last day' },
      deliverySla: {
        value: deliverySlaPercent,
        change: 0,
        caption: `avg ${Number(Number(avgDelivery?.hours || 0).toFixed(1))}h delivery`,
      },
      aiNegotiation: {
        value: negotiationConversionRate,
        change: 0,
        caption: `avg ₦${Number(negotiationSavings?.average || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 })} saved`,
      },
      customerSatisfaction: {
        value: Number(Number(productRatings?.rating || 0).toFixed(1)),
        change: 0,
        caption: `from ${Number(productRatings?.reviews || 0).toLocaleString('en')} reviews`,
      },
      activeVendors: { value: activeVendors, change: 0, caption: 'across 8 cities' },
      activeDrivers: { value: activeDrivers, change: -1.2, caption: `${utilization}% utilization` },
    });
  };

  analytics = async (_req: Request, res: Response) => {
    const period = typeof _req.query.period === 'string' ? _req.query.period : 'monthly';
    const bucketCount = period === 'weekly' ? 7 : period === 'yearly' ? 12 : 30;
    const now = new Date();
    const start = new Date(now);
    if (period === 'yearly') start.setMonth(now.getMonth() - 11, 1);
    else start.setDate(now.getDate() - (bucketCount - 1));
    start.setHours(0, 0, 0, 0);

    const orders = await adminRepos.orders().find({
      where: { createdAt: mongoBetween(start, now) },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });

    const buckets = new Map<string, { day: string; newUser: number; existingUser: number; orders: number; revenue: number }>();
    for (let index = bucketCount - 1; index >= 0; index -= 1) {
      const date = new Date(now);
      if (period === 'yearly') date.setMonth(now.getMonth() - index, 1);
      else date.setDate(now.getDate() - index);
      const key = period === 'yearly'
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        : date.toISOString().slice(0, 10);
      const label = period === 'yearly'
        ? date.toLocaleString('en', { month: 'short' })
        : date.toLocaleString('en', { month: 'short', day: 'numeric' });
      buckets.set(key, { day: label, newUser: 0, existingUser: 0, orders: 0, revenue: 0 });
    }

    for (const order of orders as any[]) {
      const createdAt = new Date(order.createdAt);
      const key = period === 'yearly'
        ? `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`
        : createdAt.toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      const userCreatedAt = order.user?.createdAt ? new Date(order.user.createdAt) : undefined;
      const isNewUser = userCreatedAt ? userCreatedAt.toISOString().slice(0, 10) === createdAt.toISOString().slice(0, 10) : false;
      const total = Number(order.total || 0);
      bucket.orders += 1;
      bucket.revenue += total;
      if (isNewUser) bucket.newUser += total;
      else bucket.existingUser += total;
    }

    const salesTrend = Array.from(buckets.values());
    const totalRevenue = salesTrend.reduce((acc, item) => acc + item.revenue, 0);
    const totalOrders = salesTrend.reduce((acc, item) => acc + item.orders, 0);
    sendSuccess(res, {
      salesTrend,
      salesSummary: { totalRevenue, totalOrders, period },
      negotiationPipeline: [],
      message: salesTrend.some((item) => item.revenue > 0)
        ? 'Analytics ready.'
        : 'Analytics series will populate as orders and negotiations are created.',
    });
  };

  health = async (_req: Request, res: Response) => {
    await adminRepos.users().count();
    sendSuccess(res, { status: 'healthy', database: 'connected', uptime: process.uptime() });
  };
}
