import { Request, Response } from 'express';
import { PaymentStatus, SettlementStatus } from '@lib/constants';
import { sendSuccess } from '@utils/http';
import { actor, adminRepos, getPagination, paginated, routeParam } from './admin.helpers';

export class AdminFinancialsController {
  dashboard = async (_req: Request, res: Response) => {
    const [paymentRows, settlementRows] = await Promise.all([
      adminRepos.payments().find({ order: { createdAt: 'DESC' }, take: 20 }),
      adminRepos.settlements().find({ order: { createdAt: 'DESC' }, take: 20, relations: { vendor: true } }),
    ]);
    const successful = paymentRows.filter((payment) => payment.status === PaymentStatus.SUCCESSFUL);
    const pendingSettlements = settlementRows.filter((settlement) => settlement.status === SettlementStatus.PENDING_ESCROW);
    sendSuccess(res, {
      grossVolume: successful.reduce((sum, payment) => sum + payment.amount, 0),
      platformRevenue: successful.reduce((sum, payment) => sum + payment.gatewayFee, 0),
      escrowBalance: pendingSettlements.reduce((sum, settlement) => sum + settlement.netAmount, 0),
      pendingPayouts: pendingSettlements.reduce((sum, settlement) => sum + settlement.netAmount, 0),
      recentPayments: paymentRows,
      recentSettlements: settlementRows,
    });
  };

  settlements = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const where = typeof req.query.status === 'string' ? { status: req.query.status as SettlementStatus } : {};
    const [data, total] = await adminRepos.settlements().findAndCount({
      where,
      relations: { vendor: true },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
    sendSuccess(res, paginated(data, total, page, limit));
  };

  trigger = async (req: Request, res: Response) => {
    const vendorId = routeParam(req.params.vendorId);
    await adminRepos.auditLogs().save(adminRepos.auditLogs().create({
      action: 'manual_settlement_trigger',
      resourceType: 'vendor',
      resourceId: vendorId,
      ...actor(req),
      metadata: JSON.stringify({ reason: req.body.reason, idempotencyKey: req.body.idempotencyKey }),
      details: JSON.stringify({ vendorId }),
      status: 'success',
    }));
    sendSuccess(res, { vendorId, status: 'queued' });
  };

  audit = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const [data, total] = await adminRepos.auditLogs().findAndCount({ order: { createdAt: 'DESC' }, skip, take: limit });
    sendSuccess(res, paginated(data, total, page, limit));
  };
}
