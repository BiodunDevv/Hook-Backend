import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import {
  LogisticsStatus,
  NegotiationStatus,
  OrderStatus,
  ProductStatus,
} from '@lib/constants';
import { mongoBetween, mongoIn } from '@lib/mongo-repository';
import { sendSuccess } from '@utils/http';
import { adminRepos } from './admin.helpers';
import { adminDashboardCache } from '@lib/ttl-cache';
import { User } from '@models/users/user.model';

const activeOrderStatuses = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.CONFIRMED,
  OrderStatus.SHIPPED,
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
    const cacheKey = JSON.stringify({
      stateId: _req.platformContext?.stateId || null,
      hubId: _req.platformContext?.hubId || null,
    });
    const cached = adminDashboardCache.get(cacheKey);
    if (cached) {
      sendSuccess(res, cached);
      return;
    }
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const currentMonthStart = new Date();
    currentMonthStart.setDate(1);
    currentMonthStart.setHours(0, 0, 0, 0);
    const previousMonthStart = new Date(currentMonthStart);
    previousMonthStart.setMonth(previousMonthStart.getMonth() - 1);

    const products = adminRepos.products();
    const orders = adminRepos.orders();
    const logistics = adminRepos.logistics();
    const runners = adminRepos.fieldAgents();
    const negotiations = adminRepos.negotiations();

    const [
      activeOrders,
      yesterdayActiveOrders,
      totalNegotiations,
      acceptedNegotiations,
      activeRunners,
      publishedProducts,
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
      negotiations.count(),
      negotiations.count({ where: { status: NegotiationStatus.ACCEPTED } }),
      runners.count({ where: { isActive: true } }),
      products.count({ where: { status: ProductStatus.APPROVED } }),
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
    const response = {
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
      activeRunners: { value: activeRunners, change: 0, caption: 'market-side operations' },
      publishedProducts: { value: publishedProducts, change: 0, caption: 'commercially approved' },
    };
    adminDashboardCache.set(cacheKey, response);
    sendSuccess(res, response);
  };

  analytics = async (_req: Request, res: Response) => {
    const requestedPeriod = typeof _req.query.period === 'string' ? _req.query.period : 'monthly';
    const period = ['weekly', 'monthly', 'yearly'].includes(requestedPeriod) ? requestedPeriod : 'monthly';
    const now = new Date();
    const start = new Date(now);
    if (period === 'weekly') {
      start.setDate(now.getDate() - 6);
      start.setHours(0, 0, 0, 0);
    } else if (period === 'monthly') {
      start.setMonth(now.getMonth() - 11, 1);
      start.setHours(0, 0, 0, 0);
    } else {
      start.setFullYear(now.getFullYear() - 4, 0, 1);
      start.setHours(0, 0, 0, 0);
    }

    const [orders, negotiations] = await Promise.all([
      adminRepos.orders().find({
        where: { createdAt: mongoBetween(start, now) },
        select: 'createdAt total userId',
        order: { createdAt: 'ASC' },
      }),
      adminRepos.negotiations().find({
        where: { createdAt: mongoBetween(start, now) },
        select: 'status sellingPrice acceptedPrice counterPrice createdAt',
        order: { createdAt: 'ASC' },
      }),
    ]);
    const userIds = [...new Set((orders as any[]).map((order) => String(order.userId || '')).filter(Boolean))];
    const userFilters = userIds.flatMap((id) => [
      ...(isValidObjectId(id) ? [{ _id: id }] : []),
      { publicId: id },
    ]);
    const users = userFilters.length
      ? await User.find({ $or: userFilters }).select('publicId createdAt').lean({ virtuals: true })
      : [];
    const userMap = new Map((users as any[]).flatMap((user) => [[String(user._id), user], [String(user.publicId), user]]));

    const buckets = new Map<string, {
      key: string;
      label: string;
      day: string;
      rangeLabel: string;
      newUser: number;
      existingUser: number;
      orders: number;
      revenue: number;
    }>();
    const bucketTotal = period === 'weekly' ? 7 : period === 'monthly' ? 12 : 5;
    for (let index = bucketTotal - 1; index >= 0; index -= 1) {
      const date = new Date(now);
      if (period === 'weekly') date.setDate(now.getDate() - index);
      if (period === 'monthly') date.setMonth(now.getMonth() - index, 1);
      if (period === 'yearly') date.setFullYear(now.getFullYear() - index, 0, 1);

      const key = period === 'weekly'
        ? date.toISOString().slice(0, 10)
        : period === 'monthly'
          ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
          : `${date.getFullYear()}`;
      const label = period === 'weekly'
        ? date.toLocaleString('en', { weekday: 'short' })
        : period === 'monthly'
          ? date.toLocaleString('en', { month: 'short' })
          : String(date.getFullYear());
      const rangeLabel = period === 'weekly'
        ? date.toLocaleDateString('en', { month: 'short', day: 'numeric' })
        : period === 'monthly'
          ? date.toLocaleDateString('en', { month: 'long', year: 'numeric' })
          : String(date.getFullYear());
      buckets.set(key, { key, label, day: label, rangeLabel, newUser: 0, existingUser: 0, orders: 0, revenue: 0 });
    }

    for (const order of orders as any[]) {
      const createdAt = new Date(order.createdAt);
      const key = period === 'weekly'
        ? createdAt.toISOString().slice(0, 10)
        : period === 'monthly'
          ? `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`
          : `${createdAt.getFullYear()}`;
      const bucket = buckets.get(key);
      if (!bucket) continue;
      const userCreatedAt = userMap.get(String(order.userId))?.createdAt
        ? new Date(userMap.get(String(order.userId)).createdAt)
        : undefined;
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
    const negotiationCounts = {
      active: 0,
      accepted: 0,
      declined: 0,
      expired: 0,
      withdrawn: 0,
    };
    let savingsTotal = 0;
    let savingsCount = 0;
    for (const negotiation of negotiations as any[]) {
      const status = String(negotiation.status || 'active') as keyof typeof negotiationCounts;
      if (status in negotiationCounts) negotiationCounts[status] += 1;
      if (negotiation.status === NegotiationStatus.ACCEPTED) {
        const acceptedPrice = Number(negotiation.acceptedPrice || negotiation.counterPrice || 0);
        const saved = Math.max(0, Number(negotiation.sellingPrice || 0) - acceptedPrice);
        savingsTotal += saved;
        savingsCount += 1;
      }
    }
    const totalNegotiations = negotiations.length;
    const negotiationPipeline = [
      { label: 'Active', status: NegotiationStatus.ACTIVE, volume: negotiationCounts.active },
      { label: 'Accepted', status: NegotiationStatus.ACCEPTED, volume: negotiationCounts.accepted },
      { label: 'Declined', status: NegotiationStatus.DECLINED, volume: negotiationCounts.declined },
      { label: 'Expired', status: NegotiationStatus.EXPIRED, volume: negotiationCounts.expired },
      { label: 'Withdrawn', status: NegotiationStatus.WITHDRAWN, volume: negotiationCounts.withdrawn },
    ];
    sendSuccess(res, {
      period,
      salesTrend,
      salesSummary: { totalRevenue, totalOrders, period },
      negotiationPipeline,
      negotiationSummary: {
        total: totalNegotiations,
        accepted: negotiationCounts.accepted,
        conversionRate: totalNegotiations ? Number(((negotiationCounts.accepted / totalNegotiations) * 100).toFixed(1)) : 0,
        averageSavings: savingsCount ? Number((savingsTotal / savingsCount).toFixed(0)) : 0,
      },
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
