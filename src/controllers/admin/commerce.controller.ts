import { createHash } from 'crypto';
import { Request, Response } from 'express';
import { PaymentService } from '@services/payment.service';
import { HttpError, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';
import { auditAdminAction } from '@lib/audit';
import {
  CommerceOutboxEvent,
  CommerceSettings,
  IntegrationException,
} from '@models/commerce/commerce.model';
import { Order } from '@models/orders/order.model';
import { Payment } from '@models/payments/payment.model';
import { PodService } from '@services/pod.service';
import { recordAudit } from '@services/platform-audit.service';
import { paymentProviderReadiness } from '@services/payments/provider-registry';
import { clearInventorySettingsCache } from '@services/inventory-settings.service';
import { publicCatalogCache } from '@lib/ttl-cache';

export class AdminCommerceController {
  private paymentService = new PaymentService(adminRepos.payments(), adminRepos.orders(), adminRepos.escrowLedger());
  private pod = new PodService();

  deletionRequests = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const [data, total] = await adminRepos.deletionRequests().findAndCount({ order: { createdAt: 'DESC' }, skip, take: limit, relations: { user: true } });
    sendSuccess(res, paginated(data, total, page, limit));
  };

  updateDeletion = async (req: Request, res: Response) => {
    const request = await adminRepos.deletionRequests().findOne({ where: { id: routeParam(req.params.id) } });
    if (!request) throw new HttpError(404, 'Deletion request not found');
    if (req.body.status === 'anonymized') {
      if (!request.identityVerifiedAt) throw new HttpError(409, 'Identity must be verified before anonymization');
      if (request.coolingOffUntil > new Date()) throw new HttpError(409, 'The deletion cooling-off period has not ended');
      const user = await adminRepos.users().findOne({ where: { id: request.userId } });
      if (!user) throw new HttpError(404, 'User not found');
      const anonymousKey = createHash('sha256').update(user.id).digest('hex').slice(0, 16);
      Object.assign(user, {
        email: `deleted-${anonymousKey}@anonymized.hook`, phone: undefined, password: undefined,
        googleId: undefined, firstName: 'Deleted', lastName: 'User', avatarUrl: undefined,
        address: undefined, preferences: undefined, refreshToken: undefined,
        isActive: false, isEmailVerified: false, isPhoneVerified: false,
        accountStatus: 'anonymized', deletedAt: new Date(),
      });
      await adminRepos.users().save(user);
      request.anonymizedAt = new Date();
    }
    Object.assign(request, req.body);
    if (req.body.status === 'identity_verified') request.identityVerifiedAt = new Date();
    await adminRepos.deletionRequests().save(request);
    await auditAdminAction(req, 'account_deletion.update', 'account_deletion', request.id, { status: request.status });
    sendSuccess(res, request);
  };

  refundRequests = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const where: Record<string, unknown> = {};
    if (typeof req.query.status === 'string') where.status = req.query.status;
    const [data, total] = await adminRepos.refundRequests().findAndCount({ where, order: { createdAt: 'DESC' }, skip, take: limit });
    sendSuccess(res, paginated(data, total, page, limit));
  };

  reviewRefund = async (req: Request, res: Response) => {
    const request = await adminRepos.refundRequests().findOne({ where: { id: routeParam(req.params.id) } });
    if (!request) throw new HttpError(404, 'Refund request not found');
    if (!['requested', 'under_review'].includes(request.status)) throw new HttpError(409, 'This refund request has already been decided');
    request.status = req.body.status;
    request.assignedSupportUserId = req.body.assignedSupportUserId || req.user!.sub;
    request.decisionNote = req.body.decisionNote;
    request.decidedBy = req.body.status === 'rejected' ? req.user!.sub : undefined;
    request.auditHistory.push({ action: req.body.status, actorId: req.user!.sub, note: req.body.decisionNote, at: new Date() });
    await adminRepos.refundRequests().save(request);
    await auditAdminAction(req, `refund.${req.body.status}`, 'refund_request', request.id, { orderId: request.orderId });
    sendSuccess(res, request);
  };

  approveRefund = async (req: Request, res: Response) => {
    const request = await adminRepos.refundRequests().findOne({ where: { id: routeParam(req.params.id) } });
    if (!request) throw new HttpError(404, 'Refund request not found');
    if (!['requested', 'under_review', 'approved'].includes(request.status)) throw new HttpError(409, 'This refund request cannot be approved');
    if (!request.paymentId) throw new HttpError(409, 'The captured payment could not be resolved');
    request.status = 'provider_pending';
    request.decidedBy = req.user!.sub;
    request.decisionNote = req.body.reason;
    request.auditHistory.push({ action: 'approved', actorId: req.user!.sub, at: new Date() });
    await adminRepos.refundRequests().save(request);
    const event = await this.paymentService.refund(request.paymentId, request.amount, request.idempotencyKey);
    request.status = 'refunded';
    request.providerReference = event.providerReference;
    request.auditHistory.push({ action: 'refunded', actorId: req.user!.sub, at: new Date(), providerReference: event.providerReference });
    await adminRepos.refundRequests().save(request);
    await auditAdminAction(req, 'refund.approve', 'refund_request', request.id, { amount: request.amount, orderId: request.orderId });
    sendSuccess(res, request);
  };

  podQueue = async (req: Request, res: Response) => {
    const filter: Record<string, unknown> = {
      commercePaymentMethod: 'PAY_AT_HANDOVER',
      commerceStatus: { $in: ['VERIFICATION_PENDING', 'OPERATIONS_REVIEW'] },
    };
    if (req.user?.scopeType !== 'global')
      filter.sourceStateId = { $in: req.user?.assignedStateIds || [] };
    sendSuccess(
      res,
      await Order.find(filter)
        .sort({ createdAt: 1 })
        .limit(100)
        .lean({ virtuals: true }),
    );
  };
  recordCall = async (req: Request, res: Response) => {
    const result = await this.pod.recordCall(
      routeParam(req.params.id),
      req.user!.sub,
      req.body.outcome,
      req.body.notes,
    );
    await recordAudit(req, {
      action: 'commerce.pod.call',
      entityType: 'order',
      entityId: routeParam(req.params.id),
      after: req.body,
    });
    sendSuccess(res, result);
  };
  decide = async (req: Request, res: Response) => {
    const result = await this.pod.decide(
      routeParam(req.params.id),
      req.user!.sub,
      req.body.decision,
      req.body.reason,
    );
    await recordAudit(req, {
      action: `commerce.pod.${req.body.decision.toLowerCase()}`,
      entityType: 'order',
      entityId: routeParam(req.params.id),
      reason: req.body.reason,
    });
    sendSuccess(res, result);
  };
  override = async (req: Request, res: Response) => {
    const result = await this.pod.override(
      routeParam(req.params.id),
      req.user!.sub,
      req.body.reason,
    );
    await recordAudit(req, {
      action: 'commerce.pod.override',
      entityType: 'order',
      entityId: routeParam(req.params.id),
      reason: req.body.reason,
    });
    sendSuccess(res, result);
  };
  restoreEligibility = async (req: Request, res: Response) => {
    const result = await this.pod.restoreCustomer(
      routeParam(req.params.id),
      req.user!.sub,
      req.body.reason,
    );
    await recordAudit(req, {
      action: 'commerce.pod.eligibility_restore',
      entityType: 'customer',
      entityId: routeParam(req.params.id),
      reason: req.body.reason,
    });
    sendSuccess(res, result);
  };
  payments = async (req: Request, res: Response) => {
    const query: any = {};
    if (req.query.status) query.commerceStatus = req.query.status;
    sendSuccess(
      res,
      await Payment.find(query)
        .sort({ createdAt: -1 })
        .limit(100)
        .lean({ virtuals: true }),
    );
  };
  exceptions = async (_req: Request, res: Response) =>
    sendSuccess(
      res,
      await IntegrationException.find({ status: 'open' })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean({ virtuals: true }),
    );
  outbox = async (_req: Request, res: Response) =>
    sendSuccess(
      res,
      await CommerceOutboxEvent.find()
        .sort({ createdAt: -1 })
        .limit(100)
        .lean({ virtuals: true }),
    );
  podSettings = async (_req: Request, res: Response) =>
    sendSuccess(res, await this.pod.getSettings());
  updatePodSettings = async (req: Request, res: Response) => {
    const result = await this.pod.updateSettings(req.user!.sub, req.body);
    await recordAudit(req, {
      action: 'commerce.settings.update',
      entityType: 'commerce_settings',
      after: req.body,
    });
    sendSuccess(res, result);
  };

  paymentProviders = async (_req: Request, res: Response) => {
    const settings = await CommerceSettings.findOne({ key: 'commerce' }).select('paymentProviders updatedAt').lean();
    const readiness = paymentProviderReadiness();
    const configured = settings?.paymentProviders || [
      { provider: 'paystack' as const, enabled: true, displayOrder: 1, isDefault: true },
      { provider: 'opay' as const, enabled: false, displayOrder: 2, isDefault: false },
    ];
    sendSuccess(res, {
      providers: configured.map((entry) => ({ ...entry, ...readiness.find((item) => item.provider === entry.provider) })),
      updatedAt: settings?.updatedAt,
    });
  };

  updatePaymentProviders = async (req: Request, res: Response) => {
    const defaults = req.body.providers.filter((entry: any) => entry.enabled && entry.isDefault);
    if (defaults.length !== 1) throw new HttpError(400, 'Select one enabled default payment provider');
    const readiness = paymentProviderReadiness();
    for (const entry of req.body.providers) {
      if (entry.enabled && !readiness.find((item) => item.provider === entry.provider)?.configured) {
        throw new HttpError(409, `${entry.provider === 'opay' ? 'OPay' : 'Paystack'} is missing required configuration`, undefined, 'PAYMENT_PROVIDER_UNAVAILABLE');
      }
    }
    const updated = await CommerceSettings.findOneAndUpdate(
      { key: 'commerce' },
      { $set: { paymentProviders: req.body.providers, updatedBy: req.user!.sub } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    ).lean();
    await recordAudit(req, {
      action: 'commerce.payment_providers.update',
      entityType: 'commerce_settings',
      after: { providers: req.body.providers },
      reason: req.body.reason,
    });
    sendSuccess(res, { providers: updated?.paymentProviders, readiness });
  };

  inventorySettings = async (_req: Request, res: Response) => {
    const settings = await CommerceSettings.findOne({ key: 'commerce' }).select('lowStockThreshold updatedAt').lean();
    sendSuccess(res, { lowStockThreshold: settings?.lowStockThreshold ?? 5, updatedAt: settings?.updatedAt });
  };

  updateInventorySettings = async (req: Request, res: Response) => {
    const updated = await CommerceSettings.findOneAndUpdate(
      { key: 'commerce' },
      { $set: { lowStockThreshold: req.body.lowStockThreshold, updatedBy: req.user!.sub } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    ).lean();
    clearInventorySettingsCache();
    publicCatalogCache.clear();
    await recordAudit(req, {
      action: 'commerce.inventory_settings.update',
      entityType: 'commerce_settings',
      after: { lowStockThreshold: req.body.lowStockThreshold },
      reason: req.body.reason,
    });
    sendSuccess(res, { lowStockThreshold: updated?.lowStockThreshold });
  };
}
