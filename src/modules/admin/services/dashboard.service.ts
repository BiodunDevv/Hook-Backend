import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { User } from '@modules/users/entities/user.entity';
import { Order } from '@modules/orders/entities/order.entity';
import { Product } from '@modules/products/entities/product.entity';
import { Vendor } from '@modules/vendors/entities/vendor.entity';
import { Payment } from '@modules/payments/entities/payment.entity';
import { Settlement } from '@modules/settlements/entities/settlement.entity';
import { Logistics } from '@modules/logistics/entities/logistics.entity';
import { Negotiation } from '@modules/negotiation/entities/negotiation.entity';
import { OrderStatus, ProductStatus, PaymentStatus, UserRole, SettlementStatus } from '@common/constants';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Order) private orderRepo: Repository<Order>,
    @InjectRepository(Product) private productRepo: Repository<Product>,
    @InjectRepository(Vendor) private vendorRepo: Repository<Vendor>,
    @InjectRepository(Payment) private paymentRepo: Repository<Payment>,
    @InjectRepository(Settlement) private settlementRepo: Repository<Settlement>,
    @InjectRepository(Logistics) private logisticsRepo: Repository<Logistics>,
    @InjectRepository(Negotiation) private negRepo: Repository<Negotiation>,
  ) {}

  async getDashboard() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers, newUsersToday, totalVendors, pendingVendors,
      totalProducts, pendingProducts,
      totalOrders, pendingOrders, deliveredOrders, todayOrders,
      totalRevenue, todayRevenue, monthRevenue,
      activeDeliveries, totalDrivers, totalNegotiations,
      pendingSettlements, clearedSettlements,
    ] = await Promise.all([
      this.userRepo.count(),
      this.userRepo.count({ where: { createdAt: MoreThanOrEqual(todayStart) } }),
      this.vendorRepo.count(),
      this.vendorRepo.count({ where: { isApproved: false } }),
      this.productRepo.count(),
      this.productRepo.count({ where: { status: ProductStatus.PENDING_APPROVAL } }),
      this.orderRepo.count(),
      this.orderRepo.count({ where: { status: OrderStatus.PENDING } }),
      this.orderRepo.count({ where: { status: OrderStatus.DELIVERED } }),
      this.orderRepo.count({ where: { createdAt: MoreThanOrEqual(todayStart) } }),
      this.getTotalRevenue(OrderStatus.DELIVERED),
      this.getTotalRevenue(OrderStatus.DELIVERED, todayStart),
      this.getTotalRevenue(OrderStatus.DELIVERED, thisMonthStart),
      this.logisticsRepo.count({ where: { status: 'in_transit' as any } }),
      this.userRepo.count({ where: { role: UserRole.EV_DRIVER } }),
      this.negRepo.count(),
      this.settlementRepo.count({ where: { status: SettlementStatus.PENDING_ESCROW } }),
      this.settlementRepo.count({ where: { status: SettlementStatus.CLEARED } }),
    ]);

    return {
      users: { total: totalUsers, newToday: newUsersToday },
      vendors: { total: totalVendors, pendingApproval: pendingVendors },
      products: { total: totalProducts, pendingQA: pendingProducts },
      orders: { total: totalOrders, pending: pendingOrders, delivered: deliveredOrders, today: todayOrders },
      revenue: { total: totalRevenue, today: todayRevenue, thisMonth: monthRevenue },
      logistics: { activeDeliveries, totalDrivers },
      negotiations: { total: totalNegotiations },
      settlements: { pending: pendingSettlements, cleared: clearedSettlements },
      timestamp: now.toISOString(),
    };
  }

  private async getTotalRevenue(status: OrderStatus, from?: Date): Promise<number> {
    const qb = this.orderRepo.createQueryBuilder('o')
      .select('COALESCE(SUM(o.total), 0)', 'sum')
      .where('o.status = :status', { status });
    if (from) qb.andWhere('o.createdAt >= :from', { from });
    const result = await qb.getRawOne();
    return Number(result?.sum || 0);
  }

  async getAnalytics(from?: string, to?: string, period: string = 'daily') {
    const dateFrom = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateTo = to ? new Date(to) : new Date();

    const orders = await this.orderRepo.find({
      where: { createdAt: Between(dateFrom, dateTo) },
      order: { createdAt: 'ASC' },
    });

    const revenue = orders
      .filter(o => o.status === OrderStatus.DELIVERED)
      .reduce((sum, o) => sum + o.total, 0);

    const trend: Record<string, { orders: number; revenue: number }> = {};
    for (const order of orders) {
      let key: string;
      if (period === 'monthly') {
        key = `${order.createdAt.getFullYear()}-${String(order.createdAt.getMonth() + 1).padStart(2, '0')}`;
      } else if (period === 'weekly') {
        const week = Math.ceil(order.createdAt.getDate() / 7);
        key = `${order.createdAt.getFullYear()}-W${week}`;
      } else {
        key = order.createdAt.toISOString().split('T')[0];
      }
      if (!trend[key]) trend[key] = { orders: 0, revenue: 0 };
      trend[key].orders += 1;
      if (order.status === OrderStatus.DELIVERED) trend[key].revenue += order.total;
    }

    return {
      summary: {
        totalOrders: orders.length,
        totalRevenue: revenue,
        averageOrderValue: orders.length > 0 ? revenue / orders.length : 0,
        cancelledOrders: orders.filter(o => o.status === OrderStatus.CANCELLED).length,
      },
      trend: Object.entries(trend).map(([date, data]) => ({ date, ...data })),
      period,
      from: dateFrom,
      to: dateTo,
    };
  }

  async getSystemHealth() {
    let dbStatus = 'healthy';
    try {
      await this.userRepo.count();
    } catch {
      dbStatus = 'unhealthy';
    }

    return {
      status: dbStatus === 'healthy' ? 'operational' : 'degraded',
      database: dbStatus,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
    };
  }
}
