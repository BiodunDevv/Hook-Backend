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
import { PaymentAttempt } from '@models/payments/payment-link.model';
import { User } from '@models/users/user.model';
import { isValidObjectId } from 'mongoose';
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
  /**
   * Paginated payments with the order and customer resolved.
   *
   * The previous version returned a bare, unpaginated 100 rows carrying only
   * the payment's own fields, so the admin table could not show who a payment
   * was from or what it was for without an N+1 fetch per row.
   */
  payments = async (req: Request, res: Response) => {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const query: Record<string, any> = {};
    if (req.query.status && req.query.status !== 'all') query.commerceStatus = req.query.status;
    if (req.query.provider && req.query.provider !== 'all') query.gateway = req.query.provider;
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      // Anchored and escaped: an unanchored user-supplied pattern would scan
      // the whole collection, and a stray "(" would throw.
      const safe = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { publicId: new RegExp(`^${safe}`, 'i') },
        { reference: new RegExp(`^${safe}`, 'i') },
      ];
    }

    const [rows, total] = await Promise.all([
      Payment.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean({ virtuals: true }),
      Payment.countDocuments(query),
    ]);

    // Resolved in two batched queries rather than per row.
    const orderIds = [...new Set(rows.map((row: any) => String(row.orderId)).filter(Boolean))];
    const orders = await Order.find({ _id: { $in: orderIds } })
      .select('publicId orderCode userId commerceStatus')
      .lean() as any[];
    const orderById = new Map(orders.map((order) => [String(order._id), order]));
    const userIds = [...new Set(orders.map((order) => String(order.userId)).filter(Boolean))];
    const users = await User.find({ _id: { $in: userIds } })
      .select('firstName lastName email')
      .lean() as any[];
    const userById = new Map(users.map((user) => [String(user._id), user]));

    const data = rows.map((row: any) => {
      const order = orderById.get(String(row.orderId));
      const user = order ? userById.get(String(order.userId)) : undefined;
      return {
        ...row,
        order: order
          ? { id: order.publicId, reference: order.orderCode || order.publicId, status: order.commerceStatus }
          : undefined,
        customer: user
          ? { name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email, email: user.email }
          : undefined,
      };
    });

    sendSuccess(res, { data, total, page, limit, totalPages: Math.max(Math.ceil(total / limit), 1) });
  };

  /**
   * One payment with everything needed to answer "who is this from, by what
   * method, and what happened" — the order, the customer, and every provider
   * attempt in time order.
   */
  paymentDetail = async (req: Request, res: Response) => {
    const identifier = routeParam(req.params.id);
    const payment = await Payment.findOne(
      isValidObjectId(identifier)
        ? { $or: [{ _id: identifier }, { publicId: identifier }, { reference: identifier }] }
        : { $or: [{ publicId: identifier }, { reference: identifier }] },
    ).lean({ virtuals: true }) as any;
    if (!payment) throw new HttpError(404, 'Payment not found', undefined, 'NOT_FOUND');

    const order = payment.orderId
      ? await Order.findById(payment.orderId)
          .select('publicId orderCode userId commerceStatus totalMinor currency createdAt timeline')
          .lean() as any
      : null;
    const customer = order?.userId
      ? await User.findById(order.userId).select('firstName lastName email phone').lean() as any
      : null;
    const attempts = await PaymentAttempt.find({ paymentId: String(payment._id) })
      .select('publicId provider status amountMinor reference failureReason createdAt')
      .sort({ createdAt: 1 })
      .lean({ virtuals: true });

    sendSuccess(res, {
      payment,
      order: order
        ? {
            id: order.publicId,
            reference: order.orderCode || order.publicId,
            status: order.commerceStatus,
            totalMinor: order.totalMinor,
            currency: order.currency,
            createdAt: order.createdAt,
          }
        : undefined,
      customer: customer
        ? {
            name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.email,
            email: customer.email,
            phone: customer.phone,
          }
        : undefined,
      attempts,
      timeline: order?.timeline || [],
    });
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
        throw new HttpError(409, 'Paystack is missing required configuration', undefined, 'PAYMENT_PROVIDER_UNAVAILABLE');
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

  hookCoinSettings = async (_req: Request, res: Response) => {
    const settings = await CommerceSettings.findOne({ key: 'commerce' })
      .select('orderEarnEnabled orderEarnPercent orderEarnMaxMinor creditSpendCapPercent welcomeBonusMinor updatedAt')
      .lean();
    sendSuccess(res, {
      orderEarnEnabled: settings?.orderEarnEnabled ?? true,
      orderEarnPercent: settings?.orderEarnPercent ?? 1,
      orderEarnMaxMinor: settings?.orderEarnMaxMinor ?? 0,
      creditSpendCapPercent: settings?.creditSpendCapPercent ?? 20,
      welcomeBonusMinor: settings?.welcomeBonusMinor ?? 30000,
      updatedAt: settings?.updatedAt,
    });
  };

  updateHookCoinSettings = async (req: Request, res: Response) => {
    // Only the keys actually sent are written, so a PATCH of one field cannot
    // reset the others to their defaults.
    const { reason, ...fields } = req.body as Record<string, unknown>;
    const changes = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
    const updated = await CommerceSettings.findOneAndUpdate(
      { key: 'commerce' },
      { $set: { ...changes, updatedBy: req.user!.sub } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    ).lean();
    await recordAudit(req, {
      action: 'commerce.hook_coin_settings.update',
      entityType: 'commerce_settings',
      after: changes,
      reason: reason as string,
    });
    sendSuccess(res, {
      orderEarnEnabled: updated?.orderEarnEnabled,
      orderEarnPercent: updated?.orderEarnPercent,
      orderEarnMaxMinor: updated?.orderEarnMaxMinor,
      creditSpendCapPercent: updated?.creditSpendCapPercent,
      welcomeBonusMinor: updated?.welcomeBonusMinor,
    });
  };
}
