import { Request, Response } from 'express';
import { Between } from 'typeorm';
import { LogisticsStatus, OrderStatus, ProductStatus, SettlementStatus, UserRole } from '@lib/constants';
import { sendSuccess } from '@utils/http';
import { adminRepos } from './admin.helpers';

export class AdminDashboardController {
  dashboard = async (_req: Request, res: Response) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const users = adminRepos.users();
    const vendors = adminRepos.vendors();
    const products = adminRepos.products();
    const orders = adminRepos.orders();
    const logistics = adminRepos.logistics();
    const negotiations = adminRepos.negotiations();
    const settlements = adminRepos.settlements();

    const [
      totalUsers,
      newUsersToday,
      totalVendors,
      pendingVendors,
      totalProducts,
      pendingProducts,
      totalOrders,
      pendingOrders,
      deliveredOrders,
      ordersToday,
      activeDeliveries,
      totalDrivers,
      totalNegotiations,
      pendingSettlements,
      clearedSettlements,
    ] = await Promise.all([
      users.count(),
      users.count({ where: { createdAt: Between(todayStart, new Date()) } }),
      vendors.count(),
      vendors.count({ where: { isApproved: false } }),
      products.count(),
      products.count({ where: { status: ProductStatus.PENDING_APPROVAL } }),
      orders.count(),
      orders.count({ where: { status: OrderStatus.PENDING } }),
      orders.count({ where: { status: OrderStatus.DELIVERED } }),
      orders.count({ where: { createdAt: Between(todayStart, new Date()) } }),
      logistics.count({ where: { status: LogisticsStatus.IN_TRANSIT } }),
      users.count({ where: { role: UserRole.EV_DRIVER } }),
      negotiations.count(),
      settlements.count({ where: { status: SettlementStatus.PENDING_ESCROW } }),
      settlements.count({ where: { status: SettlementStatus.CLEARED } }),
    ]);

    const revenue = await orders
      .createQueryBuilder('o')
      .select('COALESCE(SUM(o.total), 0)', 'sum')
      .where('o.status = :status', { status: OrderStatus.DELIVERED })
      .getRawOne<{ sum: string }>();

    sendSuccess(res, {
      users: { total: totalUsers, newToday: newUsersToday },
      vendors: { total: totalVendors, pending: pendingVendors },
      products: { total: totalProducts, pendingApproval: pendingProducts },
      orders: { total: totalOrders, pending: pendingOrders, delivered: deliveredOrders, today: ordersToday },
      revenue: { total: Number(revenue?.sum || 0) },
      logistics: { activeDeliveries, totalDrivers },
      negotiations: { total: totalNegotiations },
      settlements: { pendingEscrow: pendingSettlements, cleared: clearedSettlements },
    });
  };

  analytics = async (_req: Request, res: Response) => {
    sendSuccess(res, {
      salesTrend: [],
      negotiationPipeline: [],
      message: 'Analytics series will populate as orders and negotiations are created.',
    });
  };

  health = async (_req: Request, res: Response) => {
    await adminRepos.users().count();
    sendSuccess(res, { status: 'healthy', database: 'connected', uptime: process.uptime() });
  };
}
