import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import * as crypto from 'crypto';
import { Order } from '@modules/orders/entities/order.entity';
import { OrderStatus } from '@common/constants';

interface ReportRecord {
  id: string;
  title: string;
  type: string;
  date: Date;
  filters: any;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  // In-memory store for generated reports — replace with DB table in production
  private reportsStore: ReportRecord[] = [];

  constructor(
    @InjectRepository(Order) private orderRepo: Repository<Order>,
  ) {}

  async getReports(page = 1, limit = 20) {
    const start = (page - 1) * limit;
    const data = this.reportsStore.slice(start, start + limit);
    return { data, total: this.reportsStore.length, page, limit, totalPages: Math.ceil(this.reportsStore.length / limit) };
  }

  async generateReport(dto: { type: string; period?: { from?: string; to?: string } }) {
    const id = crypto.randomUUID();
    const report: ReportRecord = {
      id,
      title: `${dto.type} Report`,
      type: dto.type,
      date: new Date(),
      filters: dto.period || {},
    };

    let data: any = {};

    if (dto.type === 'sales') {
      data = await this.generateSalesReport(dto.period?.from, dto.period?.to);
    } else if (dto.type === 'vendor_performance') {
      data = await this.generateVendorReport(dto.period?.from, dto.period?.to);
    }

    this.reportsStore.unshift(report);
    this.logger.log(`Report generated: ${report.title} (${id})`);

    return { ...report, data };
  }

  private async generateSalesReport(from?: string, to?: string) {
    const dateFrom = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateTo = to ? new Date(to) : new Date();

    const orders = await this.orderRepo.find({
      where: { createdAt: Between(dateFrom, dateTo) },
    });

    return {
      totalOrders: orders.length,
      totalRevenue: orders.filter(o => o.status === OrderStatus.DELIVERED).reduce((s, o) => s + o.total, 0),
      period: { from: dateFrom, to: dateTo },
    };
  }

  private async generateVendorReport(from?: string, to?: string) {
    return { message: 'Vendor performance report — coming soon' };
  }
}
