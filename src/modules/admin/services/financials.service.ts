import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Payment } from '@modules/payments/entities/payment.entity';
import { Settlement } from '@modules/settlements/entities/settlement.entity';
import { PaymentStatus, SettlementStatus } from '@common/constants';
import { AuditLogService } from './audit-log.service';

const MAX_DATE_RANGE_DAYS = 365;
const SETTLEMENT_PAGE_MAX_LIMIT = 100;

@Injectable()
export class FinancialsService {
  private readonly logger = new Logger(FinancialsService.name);

  // In-memory idempotency store — replace with Redis in production
  private readonly processedKeys = new Set<string>();
  private readonly idempotencyTtlMs = 24 * 60 * 60 * 1000; // 24 hours

  constructor(
    @InjectRepository(Payment) private paymentRepo: Repository<Payment>,
    @InjectRepository(Settlement) private settlementRepo: Repository<Settlement>,
    private readonly auditLog: AuditLogService,
  ) {
    // Periodic cleanup of expired idempotency keys
    setInterval(() => this.processedKeys.clear(), this.idempotencyTtlMs);
  }

  // ============================================================
  // FINANCIAL DASHBOARD — SUPER_ADMIN ONLY
  // ============================================================
  async getFinancials(
    adminUser: { id: string; email: string; role: string; ip?: string },
    from?: string,
    to?: string,
    maxDays?: number,
  ) {
    // Enforce SUPER_ADMIN role
    this.assertSuperAdmin(adminUser.role);

    const { dateFrom, dateTo } = this.validateDateRange(from, to, maxDays);

    this.logger.log(
      `Financials accessed by admin ${this.maskEmail(adminUser.email)} [${adminUser.id}]`,
    );

    const [payments, settlements] = await Promise.all([
      this.paymentRepo.find({
        where: {
          createdAt: Between(dateFrom, dateTo),
          status: PaymentStatus.SUCCESSFUL,
        },
      }),
      this.settlementRepo.find({
        where: { createdAt: Between(dateFrom, dateTo) },
      }),
    ]);

    const totalGmv = payments.reduce((s, p) => s + p.amount, 0);
    const totalGatewayFees = payments.reduce((s, p) => s + p.gatewayFee, 0);
    const totalCommission = settlements.reduce((s, st) => s + st.commissionAmount, 0);
    const pendingPayouts = settlements
      .filter((s) => s.status === SettlementStatus.CLEARED)
      .reduce((s, st) => s + st.netAmount, 0);

    const result = {
      grossMerchandiseValue: totalGmv,
      gatewayFees: totalGatewayFees,
      commissionsEarned: totalCommission,
      pendingPayouts,
      netRevenue: totalCommission - totalGatewayFees,
      transactionCount: payments.length,
      averageTransactionValue:
        payments.length > 0 ? Math.round(totalGmv / payments.length) : 0,
      period: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
    };

    // Audit: log financial view
    await this.auditLog.log({
      action: 'financials.view',
      resourceType: 'financials',
      performedBy: adminUser.id,
      performedByEmail: adminUser.email,
      ipAddress: adminUser.ip,
      details: {
        dateFrom: dateFrom.toISOString(),
        dateTo: dateTo.toISOString(),
        gmv: this.maskAmount(totalGmv),
        transactionCount: payments.length,
      },
      status: 'success',
    });

    return result;
  }

  // ============================================================
  // SETTLEMENTS — SUPER_ADMIN ONLY
  // ============================================================
  async getSettlements(
    adminUser: { id: string; email: string; role: string; ip?: string },
    page = 1,
    limit = 20,
    status?: SettlementStatus,
  ) {
    this.assertSuperAdmin(adminUser.role);

    // Enforce strict pagination limits
    const safeLimit = Math.min(Math.max(1, limit), SETTLEMENT_PAGE_MAX_LIMIT);
    const safePage = Math.max(1, page);

    const where: any = {};
    if (status && Object.values(SettlementStatus).includes(status)) {
      where.status = status;
    }

    const [data, total] = await this.settlementRepo.findAndCount({
      where,
      relations: {
  vendor: true,
  order: true
},
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    await this.auditLog.log({
      action: 'settlements.view',
      resourceType: 'settlement',
      performedBy: adminUser.id,
      performedByEmail: adminUser.email,
      ipAddress: adminUser.ip,
      details: {
        page: safePage,
        limit: safeLimit,
        statusFilter: status || 'all',
        resultCount: data.length,
      },
      status: 'success',
    });

    return {
      data,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  // ============================================================
  // TRIGGER SETTLEMENT — SUPER_ADMIN ONLY, IDEMPOTENT
  // ============================================================
  async triggerSettlement(
    adminUser: { id: string; email: string; role: string; ip?: string },
    vendorId: string,
    idempotencyKey?: string,
    reason?: string,
  ) {
    this.assertSuperAdmin(adminUser.role);

    // Validate vendor ID
    if (!this.isValidUuid(vendorId)) {
      throw new BadRequestException('Invalid vendor ID format');
    }

    // Idempotency check — prevents double-payouts
    if (idempotencyKey) {
      if (this.processedKeys.has(idempotencyKey)) {
        this.logger.warn(
          `Duplicate settlement trigger blocked for vendor ${vendorId} (key: ${this.maskIdempotencyKey(idempotencyKey)}) by admin ${this.maskEmail(adminUser.email)}`,
        );
        await this.auditLog.log({
          action: 'settlement.trigger.duplicate',
          resourceType: 'settlement',
          resourceId: vendorId,
          performedBy: adminUser.id,
          performedByEmail: adminUser.email,
          ipAddress: adminUser.ip,
          details: { vendorId, reason, idempotencyKey: this.maskIdempotencyKey(idempotencyKey) },
          status: 'denied',
        });
        return {
          status: 'already_processed',
          message: 'This settlement request has already been processed',
          vendorId,
        };
      }
      this.processedKeys.add(idempotencyKey);
    }

    const settlements = await this.settlementRepo.find({
      where: { vendorId, status: SettlementStatus.CLEARED },
    });

    if (settlements.length === 0) {
      await this.auditLog.log({
        action: 'settlement.trigger.notfound',
        resourceType: 'settlement',
        resourceId: vendorId,
        performedBy: adminUser.id,
        performedByEmail: adminUser.email,
        ipAddress: adminUser.ip,
        details: { vendorId, reason },
        status: 'failure',
      });
      throw new NotFoundException('No cleared settlements found for this vendor');
    }

    // Use a transaction to prevent partial updates
    const totalAmount = settlements.reduce((s, st) => s + st.netAmount, 0);

    await this.settlementRepo.manager.transaction(async (transactionalEntityManager) => {
      await transactionalEntityManager.update(
        Settlement,
        { vendorId, status: SettlementStatus.CLEARED },
        {
          status: SettlementStatus.PAID,
          paidAt: new Date(),
          notes: reason
            ? `Manual payout triggered by admin ${adminUser.id}. Reason: ${reason}`
            : `Manual payout triggered by admin ${adminUser.id}`,
        },
      );
    });

    this.logger.log(
      `Settlement triggered for vendor ${vendorId}: ${settlements.length} items, ${this.maskAmount(totalAmount)} by admin ${this.maskEmail(adminUser.email)}`,
    );

    await this.auditLog.log({
      action: 'settlement.trigger',
      resourceType: 'settlement',
      resourceId: vendorId,
      performedBy: adminUser.id,
      performedByEmail: adminUser.email,
      ipAddress: adminUser.ip,
      details: {
        vendorId,
        itemsProcessed: settlements.length,
        totalAmount: this.maskAmount(totalAmount),
        reason: reason || 'manual',
      },
      status: 'success',
    });

    return {
      status: 'success',
      paid: settlements.length,
      totalAmount,
      vendorId,
      processedAt: new Date().toISOString(),
    };
  }

  // ============================================================
  // SECURITY HELPERS
  // ============================================================

  private assertSuperAdmin(role: string): void {
    if (role !== 'super_admin') {
      throw new ForbiddenException(
        'Financial operations require super_admin privileges',
      );
    }
  }

  private validateDateRange(
    from?: string,
    to?: string,
    maxDays?: number,
  ): { dateFrom: Date; dateTo: Date } {
    const effectiveMaxDays = maxDays && maxDays > 0
      ? Math.min(maxDays, MAX_DATE_RANGE_DAYS)
      : MAX_DATE_RANGE_DAYS;

    const dateTo = to ? new Date(to) : new Date();
    const dateFrom = from
      ? new Date(from)
      : new Date(dateTo.getTime() - effectiveMaxDays * 24 * 60 * 60 * 1000);

    // Prevent future dates
    if (dateTo > new Date()) {
      throw new BadRequestException('End date cannot be in the future');
    }

    // Enforce max range
    const rangeMs = dateTo.getTime() - dateFrom.getTime();
    const maxRangeMs = effectiveMaxDays * 24 * 60 * 60 * 1000;
    if (rangeMs > maxRangeMs) {
      throw new BadRequestException(
        `Date range cannot exceed ${effectiveMaxDays} days`,
      );
    }

    // Prevent negative ranges
    if (rangeMs <= 0) {
      throw new BadRequestException('End date must be after start date');
    }

    return { dateFrom, dateTo };
  }

  private isValidUuid(str: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }

  // Mask sensitive financial amounts in logs
  private maskAmount(amount: number): string {
    if (amount === 0) return '₦0';
    const str = Math.round(amount).toString();
    if (str.length <= 4) return `₦${'*'.repeat(str.length)}`;
    return `₦${'*'.repeat(str.length - 2)}${str.slice(-2)}`;
  }

  // Mask email for privacy in logs
  private maskEmail(email: string): string {
    const [name, domain] = email.split('@');
    if (!domain) return email;
    return `${name[0]}***${name.slice(-1)}@${domain}`;
  }

  // Mask idempotency key in logs
  private maskIdempotencyKey(key: string): string {
    if (key.length <= 8) return '****';
    return `${key.slice(0, 4)}****${key.slice(-4)}`;
  }
}
