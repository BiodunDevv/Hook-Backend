import { Request, Response } from "express";
import {
  CommerceOutboxEvent,
  CommerceSettings,
  IntegrationException,
} from "@models/commerce/commerce.model";
import { Order } from "@models/orders/order.model";
import { Payment } from "@models/payments/payment.model";
import { PodService } from "@services/pod.service";
import { recordAudit } from "@services/platform-audit.service";
import { routeParam } from "@lib/api-utils";
import { HttpError, sendSuccess } from "@utils/http";
import { paymentProviderReadiness } from "@services/payments/provider-registry";

export class PhaseFourCommerceController {
  private pod = new PodService();
  podQueue = async (req: Request, res: Response) => {
    const filter: Record<string, unknown> = {
      commercePaymentMethod: "PAY_AT_HANDOVER",
      commerceStatus: { $in: ["VERIFICATION_PENDING", "OPERATIONS_REVIEW"] },
    };
    if (req.user?.scopeType !== "global")
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
      action: "commerce.pod.call",
      entityType: "order",
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
      entityType: "order",
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
      action: "commerce.pod.override",
      entityType: "order",
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
      action: "commerce.pod.eligibility_restore",
      entityType: "customer",
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
      await IntegrationException.find({ status: "open" })
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
  settings = async (_req: Request, res: Response) =>
    sendSuccess(res, await this.pod.getSettings());
  updateSettings = async (req: Request, res: Response) => {
    const result = await this.pod.updateSettings(req.user!.sub, req.body);
    await recordAudit(req, {
      action: "commerce.settings.update",
      entityType: "commerce_settings",
      after: req.body,
    });
    sendSuccess(res, result);
  };

  paymentProviders = async (_req: Request, res: Response) => {
    const settings = await CommerceSettings.findOne({ key: "commerce" }).select("paymentProviders updatedAt").lean();
    const readiness = paymentProviderReadiness();
    const configured = settings?.paymentProviders || [
      { provider: "paystack" as const, enabled: true, displayOrder: 1, isDefault: true },
      { provider: "opay" as const, enabled: false, displayOrder: 2, isDefault: false },
    ];
    sendSuccess(res, {
      providers: configured.map((entry) => ({ ...entry, ...readiness.find((item) => item.provider === entry.provider) })),
      updatedAt: settings?.updatedAt,
    });
  };

  updatePaymentProviders = async (req: Request, res: Response) => {
    const defaults = req.body.providers.filter((entry: any) => entry.enabled && entry.isDefault);
    if (defaults.length !== 1) throw new HttpError(400, "Select one enabled default payment provider");
    const readiness = paymentProviderReadiness();
    for (const entry of req.body.providers) {
      if (entry.enabled && !readiness.find((item) => item.provider === entry.provider)?.configured) {
        throw new HttpError(409, `${entry.provider === "opay" ? "OPay" : "Paystack"} is missing required configuration`, undefined, "PAYMENT_PROVIDER_UNAVAILABLE");
      }
    }
    const updated = await CommerceSettings.findOneAndUpdate(
      { key: "commerce" },
      { $set: { paymentProviders: req.body.providers, updatedBy: req.user!.sub } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    ).lean();
    await recordAudit(req, {
      action: "commerce.payment_providers.update",
      entityType: "commerce_settings",
      after: { providers: req.body.providers },
      reason: req.body.reason,
    });
    sendSuccess(res, { providers: updated?.paymentProviders, readiness });
  };
}
