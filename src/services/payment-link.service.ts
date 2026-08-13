import { createHash, randomBytes } from "crypto";
import { isValidObjectId } from "mongoose";
import { CommercePaymentStatus } from "@lib/constants";
import { CommerceSettings } from "@models/commerce/commerce.model";
import { OrderItem } from "@models/orders/order-item.model";
import { Order } from "@models/orders/order.model";
import { PaymentAttempt, PaymentLink } from "@models/payments/payment-link.model";
import { Payment } from "@models/payments/payment.model";
import { nextPublicId } from "@services/public-id.service";
import { paymentProvider, paymentProviderReadiness, type ProviderName } from "@services/payments/provider-registry";
import { HttpError } from "@utils/http";
import { PaymentService } from "@services/payment.service";

const ACTIVE_ATTEMPT_STATUSES: Array<"initializing" | "processing"> = ["initializing", "processing"];

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function paymentOrigin() {
  const configured = String(process.env.PAYMENT_WEB_ORIGIN || "https://hook-africa.vercel.app").replace(/\/$/, "");
  if (process.env.NODE_ENV === "production" && !configured.startsWith("https://")) {
    throw new HttpError(503, "Hosted payments are not configured", undefined, "PAYMENT_CONFIGURATION_ERROR");
  }
  return configured;
}

export class PaymentLinkService {
  async create(customerId: string, orderIdentifier: string, fulfilmentGroupId?: string) {
    const order = await Order.findOne({
      ...(isValidObjectId(orderIdentifier) ? { $or: [{ _id: orderIdentifier }, { publicId: orderIdentifier }] } : { publicId: orderIdentifier }),
      userId: customerId,
    }).lean({ virtuals: true });
    if (!order) throw new HttpError(404, "Order not found");
    if (order.commerceStatus === "CANCELLED" || order.commercePaymentStatus === CommercePaymentStatus.CONFIRMED) {
      throw new HttpError(409, "This Order no longer requires payment", undefined, "PAYMENT_INITIALIZATION_NOT_ALLOWED");
    }
    if (order.commercePaymentMethod === "PAY_AT_HANDOVER" && !fulfilmentGroupId) {
      throw new HttpError(400, "A delivery payment must be selected", undefined, "FULFILMENT_GROUP_REQUIRED");
    }
    const payment = await Payment.findOne({
      orderId: String(order._id),
      ...(fulfilmentGroupId ? { fulfilmentGroupId } : { fulfilmentGroupId: { $exists: false } }),
    });
    if (!payment) throw new HttpError(409, "Order payment record is missing", undefined, "PAYMENT_RECORD_MISSING");
    if (payment.commerceStatus === CommercePaymentStatus.CONFIRMED) {
      throw new HttpError(409, "This payment is already complete", undefined, "PAYMENT_ALREADY_CONFIRMED");
    }

    await PaymentLink.updateMany(
      { paymentId: String(payment._id), status: { $in: ["active", "processing"] } },
      { $set: { status: "revoked", revokedAt: new Date() } },
    );
    const token = randomBytes(32).toString("base64url");
    const link = await PaymentLink.create({
      publicId: await nextPublicId("paymentLink"),
      tokenHash: hash(token),
      paymentId: String(payment._id),
      orderId: String(order._id),
      fulfilmentGroupId: payment.fulfilmentGroupId,
      customerId,
      amountMinor: Number(payment.amountMinor || 0),
      currency: payment.currency || order.currency || "NGN",
      status: "active",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdBy: customerId,
    });
    return {
      id: link.publicId,
      url: `${paymentOrigin()}/payment/${token}`,
      token,
      expiresAt: link.expiresAt,
      status: link.status,
    };
  }

  async detail(token: string) {
    const link = await this.resolve(token);
    const [order, payment, items, settings] = await Promise.all([
      Order.findById(link.orderId).select("publicId orderCode commerceStatus commercePaymentStatus subtotalMinor deliveryFeeMinor totalMinor currency").lean(),
      Payment.findById(link.paymentId).select("publicId commerceStatus paidAt gateway amountMinor currency").lean(),
      OrderItem.find({ orderId: link.orderId, ...(link.fulfilmentGroupId ? { fulfilmentGroupId: link.fulfilmentGroupId } : {}) })
        .select("publicId productTitle productImage quantity selectedVariants unitPriceMinor totalPriceMinor currency")
        .lean({ virtuals: true }),
      CommerceSettings.findOne({ key: "commerce" }).select("paymentProviders").lean(),
    ]);
    if (!order || !payment) throw new HttpError(404, "Payment link not found");
    await PaymentLink.updateOne({ _id: link._id }, { $set: { lastAccessedAt: new Date() } });
    const readiness = Object.fromEntries(paymentProviderReadiness().map((entry) => [entry.provider, entry]));
    const configured = settings?.paymentProviders?.length ? settings.paymentProviders : [
      { provider: "paystack" as const, enabled: true, displayOrder: 1, isDefault: true },
      { provider: "opay" as const, enabled: false, displayOrder: 2, isDefault: false },
    ];
    const providers = configured
      .filter((entry) => entry.enabled && readiness[entry.provider]?.configured)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((entry) => ({ provider: entry.provider, isDefault: entry.isDefault, mode: readiness[entry.provider].mode }));
    return {
      id: link.publicId,
      status: payment.commerceStatus === CommercePaymentStatus.CONFIRMED ? "paid" : link.status,
      expiresAt: link.expiresAt,
      purpose: link.fulfilmentGroupId ? "Delivery payment" : "Order payment",
      order: {
        id: order.publicId,
        reference: order.orderCode || order.publicId,
        subtotalMinor: link.fulfilmentGroupId ? items.reduce((sum, item) => sum + Number(item.totalPriceMinor || 0), 0) : order.subtotalMinor,
        deliveryFeeMinor: link.fulfilmentGroupId
          ? Math.max(0, link.amountMinor - items.reduce((sum, item) => sum + Number(item.totalPriceMinor || 0), 0))
          : order.deliveryFeeMinor,
        totalMinor: link.amountMinor,
        currency: link.currency,
        items: items.map((item) => ({
          id: item.publicId,
          title: item.productTitle,
          imageUrl: item.productImage,
          quantity: item.quantity,
          selectedVariants: item.selectedVariants,
          unitPriceMinor: item.unitPriceMinor,
          totalPriceMinor: item.totalPriceMinor,
        })),
      },
      providers,
      paidAt: payment.paidAt,
    };
  }

  async initialize(token: string, providerName: ProviderName, idempotencyKey: string, appReturn = false) {
    if (!idempotencyKey || idempotencyKey.length > 160) throw new HttpError(400, "Idempotency-Key is required");
    const link = await this.resolve(token);
    const existing = await PaymentAttempt.findOne({ paymentLinkId: String(link._id), idempotencyKey });
    if (existing) return this.publicAttempt(existing);

    const [settings, payment, order] = await Promise.all([
      CommerceSettings.findOne({ key: "commerce" }).select("paymentProviders").lean(),
      Payment.findById(link.paymentId),
      Order.findById(link.orderId).lean(),
    ]);
    if (!payment || !order) throw new HttpError(404, "Payment link not found");
    const configuration = settings?.paymentProviders?.find((entry) => entry.provider === providerName);
    const provider = paymentProvider(providerName);
    if (!configuration?.enabled || !provider.readiness().configured) {
      throw new HttpError(503, "Selected payment provider is unavailable", undefined, "PAYMENT_PROVIDER_UNAVAILABLE");
    }
    if (payment.commerceStatus === CommercePaymentStatus.CONFIRMED) {
      throw new HttpError(409, "This payment is already complete", undefined, "PAYMENT_ALREADY_CONFIRMED");
    }
    const active = await PaymentAttempt.findOne({ paymentId: String(payment._id), status: { $in: ACTIVE_ATTEMPT_STATUSES }, expiresAt: { $gt: new Date() } });
    if (active) {
      throw new HttpError(409, "A payment attempt is already in progress", undefined, "PAYMENT_ATTEMPT_IN_PROGRESS");
    }
    await PaymentAttempt.updateMany(
      { paymentId: String(payment._id), status: { $in: ACTIVE_ATTEMPT_STATUSES }, expiresAt: { $lte: new Date() } },
      { $set: { status: "expired", completedAt: new Date() } },
    );

    const publicId = await nextPublicId("paymentAttempt");
    const reference = `HK-${publicId.replaceAll("-", "")}`;
    const requestHash = hash(`${link.publicId}:${providerName}:${link.amountMinor}:${idempotencyKey}`);
    const attempt = await PaymentAttempt.create({
      publicId,
      paymentLinkId: String(link._id),
      paymentId: String(payment._id),
      orderId: String(order._id),
      provider: providerName,
      reference,
      idempotencyKey,
      requestHash,
      status: "initializing",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    const returnUrl = new URL(`${paymentOrigin()}/payment/${token}/processing`);
    returnUrl.searchParams.set("provider", providerName);
    if (appReturn) returnUrl.searchParams.set("appReturn", "1");
    try {
      const initialized = await provider.initialize({
        reference,
        amountMinor: link.amountMinor,
        currency: link.currency,
        email: String((order.customerSnapshot as any)?.email || "payments@hook.africa"),
        callbackUrl: returnUrl.toString(),
        metadata: { orderId: order.publicId, paymentId: payment.publicId, paymentLinkId: link.publicId },
      });
      attempt.authorizationUrl = initialized.authorizationUrl;
      attempt.status = "processing";
      await attempt.save();
      payment.gateway = providerName;
      payment.transactionRef = reference;
      payment.authorizationUrl = initialized.authorizationUrl;
      payment.accessCode = initialized.accessCode;
      payment.activeAttemptId = attempt.publicId;
      payment.commerceStatus = CommercePaymentStatus.PROCESSING;
      await payment.save();
      link.status = "processing";
      await link.save();
      return this.publicAttempt(attempt);
    } catch (error: any) {
      attempt.status = "failed";
      attempt.errorCode = error?.code || "PAYMENT_PROVIDER_ERROR";
      attempt.completedAt = new Date();
      await attempt.save();
      link.status = "active";
      await link.save();
      throw error;
    }
  }

  async status(token: string) {
    const link = await this.resolve(token);
    const currentAttempt = await PaymentAttempt.findOne({ paymentLinkId: String(link._id) }).sort({ createdAt: -1 });
    if (currentAttempt?.status === "processing") {
      await new PaymentService().verifyAttempt(currentAttempt.publicId).catch(() => undefined);
    }
    const detail = await this.detail(token);
    const attempt = await PaymentAttempt.findOne({ paymentLinkId: String(link._id) }).sort({ createdAt: -1 }).lean();
    return { status: detail.status, paidAt: detail.paidAt, attempt: attempt ? { provider: attempt.provider, status: attempt.status } : undefined };
  }

  async revoke(customerId: string, identifier: string) {
    const link = await PaymentLink.findOne({
      ...(isValidObjectId(identifier) ? { $or: [{ publicId: identifier }, { _id: identifier }] } : { publicId: identifier }),
      customerId,
    });
    if (!link) throw new HttpError(404, "Payment link not found");
    if (["paid", "revoked", "expired", "cancelled"].includes(link.status)) return { id: link.publicId, status: link.status };
    link.status = "revoked";
    link.revokedAt = new Date();
    await link.save();
    await PaymentAttempt.updateMany({ paymentLinkId: String(link._id), status: { $in: ACTIVE_ATTEMPT_STATUSES } }, { $set: { status: "cancelled", completedAt: new Date() } });
    return { id: link.publicId, status: link.status };
  }

  private async resolve(token: string) {
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) throw new HttpError(404, "Payment link not found");
    const link = await PaymentLink.findOne({ tokenHash: hash(token) }).select("+tokenHash");
    if (!link) throw new HttpError(404, "Payment link not found");
    if (link.expiresAt <= new Date() && ["active", "processing"].includes(link.status)) {
      link.status = "expired";
      await link.save();
    }
    if (["expired", "revoked", "cancelled"].includes(link.status)) {
      throw new HttpError(410, "This payment link is no longer available", { status: link.status }, "PAYMENT_LINK_EXPIRED");
    }
    return link;
  }

  private publicAttempt(attempt: any) {
    return {
      id: attempt.publicId,
      provider: attempt.provider,
      status: attempt.status,
      authorizationUrl: attempt.authorizationUrl,
      expiresAt: attempt.expiresAt,
    };
  }
}
