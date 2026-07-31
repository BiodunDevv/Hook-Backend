import { Request, Response } from 'express';
import { EscrowEventType, PaymentStatus, SettlementStatus } from '@lib/constants';
import { HttpError, sendSuccess } from '@utils/http';
import { actor, adminRepos, getPagination, paginated, routeParam } from './admin.helpers';
import { PaymentService } from '@services/payment.service';

export class AdminFinancialsController {
  private paymentsService = new PaymentService(adminRepos.payments(), adminRepos.orders(), adminRepos.escrowLedger());
  dashboard = async (req: Request, res: Response) => {
    const orders = await adminRepos.orders().find({});
    const [paymentRows, settlementRows] = await Promise.all([
      adminRepos.payments().find({ order: { createdAt: 'DESC' } }),
      adminRepos.settlements().find({ order: { createdAt: 'DESC' } }),
    ]);
    const ledger = await adminRepos.escrowLedger().find({ order: { createdAt: 'DESC' } });
    const successful = paymentRows.filter((payment) => payment.status === PaymentStatus.SUCCESSFUL);
    const pendingSettlements = settlementRows.filter((settlement) => settlement.status === SettlementStatus.PENDING_ESCROW);
    const period = ['24h', '7d', '30d', 'ytd'].includes(String(req.query.period).toLowerCase()) ? String(req.query.period).toLowerCase() : '7d';
    const now = new Date();
    const start = period === '24h' ? new Date(now.getTime() - 24 * 60 * 60 * 1000)
      : period === '30d' ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        : period === 'ytd' ? new Date(now.getFullYear(), 0, 1)
          : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const bucketKey = (date: Date) => period === '24h'
      ? `${String(date.getHours()).padStart(2, '0')}:00`
      : period === 'ytd' ? date.toLocaleString('en', { month: 'short' })
        : date.toLocaleString('en', { month: 'short', day: 'numeric' });
    const trendMap = new Map<string, { label: string; volume: number; revenue: number }>();
    for (const payment of successful.filter((row) => row.createdAt >= start)) {
      const key = bucketKey(payment.createdAt);
      const row = trendMap.get(key) || { label: key, volume: 0, revenue: 0 };
      row.volume += payment.amount;
      row.revenue += Number(payment.splitData?.commission || 0);
      trendMap.set(key, row);
    }
    sendSuccess(res, {
      grossVolume: successful.reduce((sum, payment) => sum + payment.amount, 0),
      platformRevenue: settlementRows.reduce((sum, settlement) => sum + settlement.commissionAmount, 0),
      escrowBalance: pendingSettlements.reduce((sum, settlement) => sum + settlement.netAmount, 0),
      pendingPayouts: pendingSettlements.reduce((sum, settlement) => sum + settlement.netAmount, 0),
      heldFunds: ledger.filter((row) => row.type === EscrowEventType.HELD).reduce((sum, row) => sum + row.amount, 0),
      refundQueue: ledger.filter((row) => row.type === EscrowEventType.REFUND_PENDING).reduce((sum, row) => sum + row.amount, 0),
      availablePayouts: ledger.filter((row) => row.type === EscrowEventType.ELIGIBLE_FOR_PAYOUT).reduce((sum, row) => sum + row.amount, 0),
      gatewayFees: successful.reduce((sum, payment) => sum + payment.gatewayFee, 0),
      deliverySubsidy: orders.reduce((sum, order) => sum + Number(order.deliverySubsidy || 0), 0),
      period,
      trend: Array.from(trendMap.values()),
      recentPayments: paymentRows.slice(0, 20),
      recentSettlements: settlementRows.slice(0, 20),
    });
  };

  settlements = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const where = typeof req.query.status === 'string' ? { status: req.query.status as SettlementStatus } : {};
    const [data, total] = await adminRepos.settlements().findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
    sendSuccess(res, paginated(data, total, page, limit));
  };

  settlementDetail = async (req: Request, res: Response) => {
    const settlement = await adminRepos.settlements().findOne({
      where: { id: routeParam(req.params.id) },
    });
    if (!settlement) throw new HttpError(404, 'Settlement not found');
    sendSuccess(res, settlement);
  };

  audit = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const [data, total] = await adminRepos.auditLogs().findAndCount({ order: { createdAt: 'DESC' }, skip, take: limit });
    sendSuccess(res, paginated(data, total, page, limit));
  };

  payments = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const where: Record<string, unknown> = {};
    if (typeof req.query.status === 'string') where.status = req.query.status;
    const [data, total] = await adminRepos.payments().findAndCount({ where, order: { createdAt: 'DESC' }, skip, take: limit, relations: { order: true } });
    sendSuccess(res, paginated(data, total, page, limit));
  };

  escrow = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const [data, total] = await adminRepos.escrowLedger().findAndCount({ order: { createdAt: 'DESC' }, skip, take: limit });
    sendSuccess(res, paginated(data, total, page, limit));
  };

  refund = async (req: Request, res: Response) => {
    const result = await this.paymentsService.refund(routeParam(req.params.paymentId), req.body.amount, req.body.idempotencyKey);
    await adminRepos.auditLogs().save(adminRepos.auditLogs().create({
      action: 'payment.refund', resourceType: 'payment', resourceId: routeParam(req.params.paymentId),
      ...actor(req), metadata: JSON.stringify({ amount: req.body.amount, reason: req.body.reason }), status: 'success',
    }));
    sendSuccess(res, result);
  };

  reconciliation = async (_req: Request, res: Response) => {
    const [payments, ledger] = await Promise.all([adminRepos.payments().find({}), adminRepos.escrowLedger().find({})]);
    const successful = payments.filter((payment) => payment.status === PaymentStatus.SUCCESSFUL);
    const receivedIds = new Set(ledger.filter((row) => row.type === EscrowEventType.PAYMENT_RECEIVED).map((row) => row.paymentId));
    sendSuccess(res, {
      checked: successful.length,
      unmatched: successful.filter((payment) => !receivedIds.has(payment.id)),
      generatedAt: new Date(),
    });
  };
}
