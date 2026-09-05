import { createHash } from "crypto";
import { isValidObjectId } from "mongoose";
import {
  CommerceOrderStatus,
  CommercePaymentStatus,
  OrderStatus,
  PaymentStatus,
  ShipmentStatus,
} from "@lib/constants";
import type { MongoRepository as Repository } from "@lib/mongo-repository";
import {
  CommerceOutboxEvent,
  IntegrationException,
  PaymentWebhookEvent,
} from "@models/commerce/commerce.model";
import { Order } from "@models/orders/order.model";
import { OrderFulfilmentGroup } from "@models/orders/order-fulfilment-group.model";
import { Payment } from "@models/payments/payment.model";
import { Shipment } from "@models/fulfilment/fulfilment.model";
import { EscrowLedger } from "@models/payments/escrow-ledger.model";
import { User } from "@models/users/user.model";
import { nextPublicId } from "@services/public-id.service";
import { createCommerceNotification } from "@services/commerce-notification.service";
import { EmailService } from "@emails/email.service";
import { HttpError } from "@utils/http";
import { paymentProvider, type ProviderName } from "./payments/provider-registry";
import { PaymentAttempt, PaymentLink } from "@models/payments/payment-link.model";
import { publishRealtime } from "@services/realtime.service";

function identity(value: string) {
  return isValidObjectId(value)
    ? { $or: [{ _id: value }, { publicId: value }] }
    : { publicId: value };
}

export class PaymentService {
  private provider = paymentProvider("paystack");
  private email = new EmailService();
  constructor(
    _payments?: Repository<Payment>,
    _orders?: Repository<Order>,
    _ledger?: Repository<EscrowLedger>,
  ) {}

  async initialize(customerId: string, orderIdentifier: string, fulfilmentGroupIdentifier?: string) {
    const order = await Order.findOne({
      ...identity(orderIdentifier),
      userId: customerId,
    });
    if (!order || !["PREPAID", "PAY_AT_HANDOVER"].includes(String(order.commercePaymentMethod))) throw new HttpError(404, "Order not found");
    if (order.commercePaymentMethod === "PAY_AT_HANDOVER") {
      const shipment = await Shipment.findOne({ orderId: order.id, status: ShipmentStatus.AWAITING_HANDOVER_PAYMENT, releaseStatus: "AWAITING_HANDOVER_PAYMENT" }).lean();
      if (!shipment) throw new HttpError(409, "Pay-at-Handover payment is not due for this Order yet", undefined, "PAYMENT_INITIALIZATION_NOT_ALLOWED");
    }
    return this.initializeOrder(order, customerId, fulfilmentGroupIdentifier);
  }

  async initializeForPartner(partnerId: string, orderIdentifier: string) {
    const order = await Order.findOne({
      ...identity(orderIdentifier),
      initiatingPartnerId: partnerId,
      channel: "PARTNER_ASSISTED",
      commercePaymentMethod: "PREPAID",
    });
    if (!order) throw new HttpError(404, "Order not found");
    if (!order.userId)
      throw new HttpError(
        409,
        "Order customer is missing",
        undefined,
        "PAYMENT_INITIALIZATION_NOT_ALLOWED",
      );
    return this.initializeOrder(order, order.userId);
  }

  private async initializeOrder(order: any, customerId: string, fulfilmentGroupIdentifier?: string) {
    if (order.commercePaymentStatus === CommercePaymentStatus.CONFIRMED)
      return this.status(customerId, order.publicId || order.id);
    if (order.commerceStatus === CommerceOrderStatus.CANCELLED)
      throw new HttpError(
        409,
        "Cancelled Order cannot be paid",
        undefined,
        "PAYMENT_INITIALIZATION_NOT_ALLOWED",
      );
    const customer = await User.findById(customerId).lean();
    if (!customer?.email)
      throw new HttpError(409, "Customer email is required for payment");
    const payment = await Payment.findOne({
      orderId: order.id,
      ...(fulfilmentGroupIdentifier ? { fulfilmentGroupId: fulfilmentGroupIdentifier } : { fulfilmentGroupId: { $exists: false } }),
    });
    if (!payment)
      throw new HttpError(
        409,
        "Order payment record is missing",
        undefined,
        "PAYMENT_RECORD_MISSING",
      );
    if (
      payment.authorizationUrl &&
      payment.commerceStatus === CommercePaymentStatus.PROCESSING
    )
      return this.publicPayment(payment);
    const initialized = await this.provider.initialize({
      reference: payment.transactionRef,
      amountMinor: Number(payment.amountMinor),
      currency: order.currency || "NGN",
      email: customer.email,
      callbackUrl:
        process.env.PAYSTACK_CALLBACK_URL ||
        `${String(process.env.APP_URL || "http://localhost:4000").replace(/\/$/, "")}/api/v1/payments/paystack/callback`,
      metadata: {
        orderId: order.publicId,
        paymentId: payment.publicId,
        fulfilmentGroupId: payment.fulfilmentGroupId,
        customerId: customer.publicId,
        channel: order.channel,
      },
    });
    payment.authorizationUrl = initialized.authorizationUrl;
    payment.accessCode = initialized.accessCode;
    payment.commerceStatus = CommercePaymentStatus.PROCESSING;
    payment.status = PaymentStatus.PENDING;
    payment.gatewayResponse = {
      initializedAt: new Date(),
      reference: initialized.reference,
    };
    await payment.save();
    order.commercePaymentStatus = CommercePaymentStatus.PROCESSING;
    await order.save();
    this.publishOrderUpdate(order);
    return this.publicPayment(payment);
  }

  async status(customerId: string, paymentOrOrderIdentifier: string) {
    let payment = await Payment.findOne({
      ...identity(paymentOrOrderIdentifier),
    });
    if (!payment) {
      const order = await Order.findOne({
        ...identity(paymentOrOrderIdentifier),
        userId: customerId,
      }).lean({ virtuals: true });
      if (!order) throw new HttpError(404, "Payment not found");
      payment = await Payment.findOne({ orderId: order._id.toString() });
    }
    if (!payment?.orderId) throw new HttpError(404, "Payment not found");
    if (payment.commerceStatus === CommercePaymentStatus.PROCESSING) {
      await this.verifyByReference(payment).catch(() => undefined);
      payment = (await Payment.findById(payment._id)) || payment;
    }
    const order = await Order.findOne({
      _id: payment.orderId,
      userId: customerId,
    }).lean({ virtuals: true });
    if (!order) throw new HttpError(404, "Payment not found");
    return {
      payment: this.publicPayment(payment),
      order: {
        id: order.publicId,
        status: order.commerceStatus,
        paymentStatus: order.commercePaymentStatus,
      },
    };
  }

  /**
   * Self-heal fallback for the primary checkout path, which has no PaymentAttempt
   * record. Re-verifies a still-PROCESSING payment against the provider so
   * confirmation does not depend solely on the webhook arriving. Never throws —
   * this backs a status poll, not the audited webhook path.
   */
  private async verifyByReference(payment: any): Promise<{ confirmed: boolean }> {
    if (payment.commerceStatus === CommercePaymentStatus.CONFIRMED) return { confirmed: true };
    if (!payment.transactionRef) return { confirmed: false };
    const attempt = await PaymentAttempt.findOne({ reference: payment.transactionRef });
    const providerName = (attempt?.provider || payment.gateway || "paystack") as ProviderName;
    const verified = await paymentProvider(providerName)
      .verify(payment.transactionRef)
      .catch(() => undefined);
    if (!verified || verified.status !== "success") return { confirmed: false };
    if (
      verified.reference !== payment.transactionRef ||
      verified.amountMinor !== payment.amountMinor ||
      verified.currency !== payment.currency
    )
      return { confirmed: false };
    await this.confirmPayment(payment, verified.providerId, verified.paidAt);
    if (attempt) {
      attempt.status = "confirmed";
      attempt.providerReference = verified.providerId;
      attempt.completedAt = new Date();
      await attempt.save();
    }
    return { confirmed: true };
  }

  async webhook(providerName: ProviderName, rawBody: Buffer, signature: string, requestId?: string) {
    const provider = paymentProvider(providerName);
    const parsed = provider.parseWebhook(rawBody, signature);
    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    let event;
    try {
      event = await PaymentWebhookEvent.create({
        provider: providerName,
        providerEventId: parsed.providerEventId,
        payloadHash,
        eventType: parsed.eventType,
        reference: parsed.reference,
        signatureVerified: true,
        processingStatus: "received",
      });
    } catch (error: any) {
      if (error?.code === 11000) return { received: true, duplicate: true };
      throw error;
    }
    if (parsed.eventType !== "charge.success" || !parsed.reference) {
      event.processingStatus = "ignored";
      event.processedAt = new Date();
      await event.save();
      return { received: true, ignored: true };
    }
    const attempt = await PaymentAttempt.findOne({ reference: parsed.reference });
    const payment = attempt ? await Payment.findById(attempt.paymentId) : await Payment.findOne({ transactionRef: parsed.reference });
    if (!payment?.orderId) {
      event.processingStatus = "ignored";
      event.failureCode = "PAYMENT_NOT_FOUND";
      await event.save();
      return { received: true, matched: false };
    }
    try {
      const verified = await provider.verify(parsed.reference);
      if (verified.reference !== parsed.reference)
        throw new HttpError(
          409,
          "Provider reference mismatch",
          undefined,
          "PAYMENT_EVIDENCE_MISMATCH",
        );
      if (verified.amountMinor !== payment.amountMinor)
        throw new HttpError(
          409,
          "Provider amount mismatch",
          undefined,
          "PAYMENT_EVIDENCE_MISMATCH",
        );
      if (verified.currency !== payment.currency)
        throw new HttpError(
          409,
          "Provider currency mismatch",
          undefined,
          "PAYMENT_EVIDENCE_MISMATCH",
        );
      if (verified.status !== "success")
        throw new HttpError(
          409,
          "Provider status is not successful",
          undefined,
          "PAYMENT_EVIDENCE_MISMATCH",
        );
      await this.confirmPayment(
        payment,
        verified.providerId,
        verified.paidAt,
        parsed.providerEventId,
      );
      if (attempt) {
        attempt.status = "confirmed";
        attempt.providerReference = verified.providerId;
        attempt.completedAt = new Date();
        await attempt.save();
      }
      event.processingStatus = "processed";
      event.processedAt = new Date();
      await event.save();
      return { received: true, processed: true };
    } catch (error: any) {
      event.processingStatus = "failed";
      event.failureCode = error?.code || "PAYMENT_EVIDENCE_MISMATCH";
      await event.save();
      await IntegrationException.create({
        provider: providerName,
        type: error?.message?.toLowerCase().includes("amount")
          ? "amount"
          : "status",
        reference: parsed.reference,
        paymentId: payment.id,
        orderId: payment.orderId,
        requestId,
        details: { code: error?.code, message: error?.message },
        status: "open",
      });
      throw error;
    }
  }

  async approvePodPayment(orderId: string) {
    const payment = await Payment.findOne({ orderId });
    if (!payment) throw new HttpError(409, "Payment record is missing");
    payment.commerceStatus = CommercePaymentStatus.DUE_AT_HANDOVER;
    await payment.save();
  }

  async verifyAttempt(attemptIdentifier: string) {
    const attempt = await PaymentAttempt.findOne(
      isValidObjectId(attemptIdentifier)
        ? { $or: [{ publicId: attemptIdentifier }, { _id: attemptIdentifier }] }
        : { publicId: attemptIdentifier },
    );
    if (!attempt) throw new HttpError(404, "Payment attempt not found");
    const payment = await Payment.findById(attempt.paymentId);
    if (!payment) throw new HttpError(404, "Payment record not found");
    if (payment.commerceStatus === CommercePaymentStatus.CONFIRMED) return { confirmed: true };
    const verified = await paymentProvider(attempt.provider).verify(attempt.reference);
    if (verified.status !== "success") return { confirmed: false, status: verified.status };
    if (verified.reference !== attempt.reference || verified.amountMinor !== payment.amountMinor || verified.currency !== payment.currency) {
      throw new HttpError(409, "Payment evidence does not match this Order", undefined, "PAYMENT_EVIDENCE_MISMATCH");
    }
    await this.confirmPayment(payment, verified.providerId, verified.paidAt);
    attempt.status = "confirmed";
    attempt.providerReference = verified.providerId;
    attempt.completedAt = new Date();
    await attempt.save();
    return { confirmed: true };
  }

  private async confirmPayment(
    payment: any,
    providerId?: string,
    paidAt?: Date,
    providerEventId?: string,
  ) {
    const order = await Order.findById(payment.orderId);
    if (!order || !["PREPAID", "PAY_AT_HANDOVER"].includes(String(order.commercePaymentMethod)))
      throw new HttpError(409, "Payment cannot activate this Order");
    if (payment.commerceStatus === CommercePaymentStatus.CONFIRMED) {
      if (order.userId)
        await createCommerceNotification({
          eventKey: `order:${order.publicId}:payment-confirmed`,
          userId: order.userId,
          title: "Payment confirmed",
          body: "Your payment was verified and your Order is approved for fulfilment.",
          type: "payment_confirmed",
          data: { orderId: order.publicId, paymentId: payment.publicId },
        }).catch(() => undefined);
      return;
    }
    payment.commerceStatus = CommercePaymentStatus.CONFIRMED;
    payment.status = PaymentStatus.SUCCESSFUL;
    payment.gatewayRef = providerId;
    payment.providerEventId = providerEventId;
    payment.paidAt = paidAt || new Date();
    payment.amountSettled = payment.amount;
    await payment.save();
    await PaymentLink.updateMany(
      { paymentId: String(payment._id), status: { $in: ["active", "processing"] } },
      { $set: { status: "paid", usedAt: new Date() } },
    );
    if (order.commercePaymentMethod === "PAY_AT_HANDOVER") {
      const group = payment.fulfilmentGroupId
        ? await OrderFulfilmentGroup.findOne({ publicId: payment.fulfilmentGroupId }).lean()
        : undefined;
      const outstanding = await Payment.countDocuments({
        orderId: String(order._id),
        _id: { $ne: payment._id },
        commerceStatus: { $ne: CommercePaymentStatus.CONFIRMED },
      });
      order.commercePaymentStatus = outstanding ? CommercePaymentStatus.DUE_AT_HANDOVER : CommercePaymentStatus.CONFIRMED;
      order.paymentStatus = outstanding ? PaymentStatus.PENDING : PaymentStatus.SUCCESSFUL;
      order.timeline = [
        ...(order.timeline || []),
        {
          status: "HANDOVER_PAYMENT_CONFIRMED",
          at: new Date(),
          actorType: "PAYSTACK_WEBHOOK",
        },
      ];
      await order.save();
      this.publishOrderUpdate(order);
      await Shipment.findOneAndUpdate(
        {
          orderId: order.id,
          ...(group?.sourceStateId ? { sourceStateId: group.sourceStateId } : {}),
          status: ShipmentStatus.AWAITING_HANDOVER_PAYMENT,
          releaseStatus: "AWAITING_HANDOVER_PAYMENT",
        },
        {
          $set: { status: ShipmentStatus.RELEASE_APPROVED, releaseStatus: "RELEASE_APPROVED" },
          $push: { trackingEvents: { status: ShipmentStatus.RELEASE_APPROVED, at: new Date(), actorId: "PAYSTACK_WEBHOOK", note: "Verified handover payment" } },
          $inc: { version: 1 },
        },
        { returnDocument: "after" },
      );
      if (order.userId) {
        await createCommerceNotification({
          eventKey: `order:${order.publicId}:handover-payment-confirmed`,
          userId: order.userId,
          title: "Handover payment confirmed",
          body: "Your payment was verified. Your delivery can now be released.",
          type: "payment_confirmed",
          data: { orderId: order.publicId, paymentId: payment.publicId },
        }).catch(() => undefined);
      }
      return;
    }
    order.commercePaymentStatus = CommercePaymentStatus.CONFIRMED;
    order.commerceStatus = CommerceOrderStatus.APPROVED_FOR_FULFILMENT;
    order.paymentStatus = PaymentStatus.SUCCESSFUL;
    order.status = OrderStatus.APPROVED_FOR_FULFILMENT;
    order.timeline = [
      ...(order.timeline || []),
      {
        status: CommerceOrderStatus.APPROVED_FOR_FULFILMENT,
        at: new Date(),
        actorType: "PAYSTACK_WEBHOOK",
      },
    ];
    await order.save();
    this.publishOrderUpdate(order);
    await this.emitOrderApproved(order);
    if (order.userId) {
      await createCommerceNotification({
        eventKey: `order:${order.publicId}:payment-confirmed`,
        userId: order.userId,
        title: "Payment confirmed",
        body: "Your payment was verified and your Order is approved for fulfilment.",
        type: "payment_confirmed",
        data: { orderId: order.publicId, paymentId: payment.publicId },
      }).catch(() => undefined);
      const customer = await User.findById(order.userId).select('email firstName').lean() as any;
      if (customer?.email) {
        await this.email.sendPaymentConfirmed({
          to: customer.email,
          name: customer.firstName,
          orderCode: order.publicId || String(order.id),
          amount: Number(order.totalMinor || 0) / 100,
        }).catch(() => undefined);
      }
    }
  }

  async emitOrderApproved(order: Order) {
    try {
      await CommerceOutboxEvent.create({
        publicId: await nextPublicId("event"),
        aggregateType: "order",
        aggregateId: order.id,
        eventType: "ORDER_APPROVED_FOR_FULFILMENT",
        eventVersion: 1,
        payload: {
          orderId: order.publicId,
          stateId: order.sourceStateId,
          channel: order.channel,
          deliveryMethod: order.deliveryMethod,
          paymentMethod: order.commercePaymentMethod,
          approvedAt: new Date().toISOString(),
        },
        status: "pending",
        attempts: 0,
        availableAt: new Date(),
      });
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
    }
  }

  private publishOrderUpdate(order: any) {
    publishRealtime({
      type: "order.updated",
      entityId: order.publicId || order._id?.toString() || order.id,
      version: Number(order.version || 1),
      scope: order.sourceStateId ? { stateId: String(order.sourceStateId) } : undefined,
    }, order.userId ? { accountId: String(order.userId), admin: true } : { admin: true });
  }

  capability() {
    return {
      provider: "paystack",
      prepaid: Boolean(process.env.PAYSTACK_SECRET_KEY),
      payAtHandover: true,
      tokenization: false,
    };
  }

  async refund(
    paymentIdentifier: string,
    amountMinor: number,
    _idempotencyKey: string,
  ): Promise<{ providerReference?: string }> {
    const payment = await Payment.findOne({
      ...identity(paymentIdentifier),
    });
    if (!payment) throw new HttpError(404, 'Payment record not found', undefined, 'PAYMENT_RECORD_MISSING');
    const captured = Number(payment.amountMinor || Math.round(Number(payment.amount || 0) * 100));
    const refunded = Number(payment.refundedAmount || 0);
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > captured - refunded) {
      throw new HttpError(409, 'Refund exceeds the captured payment balance', undefined, 'REFUND_LIMIT_EXCEEDED');
    }
    if (!payment.transactionRef || !['paystack', 'opay'].includes(String(payment.gateway))) {
      throw new HttpError(409, 'This captured payment cannot be refunded through its provider', undefined, 'PAYMENT_METHOD_NOT_ALLOWED');
    }
    const result = await paymentProvider(payment.gateway as ProviderName).refund({ reference: payment.transactionRef, amountMinor, reason: _idempotencyKey });
    payment.refundedAmount = refunded + amountMinor;
    payment.commerceStatus = payment.refundedAmount >= captured ? CommercePaymentStatus.REFUNDED : CommercePaymentStatus.REFUND_PENDING;
    payment.status = payment.refundedAmount >= captured ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
    payment.refundedAt = new Date();
    payment.gatewayResponse = { ...(payment.gatewayResponse || {}), lastRefundReference: result.providerReference, lastRefundAt: new Date() };
    await payment.save();
    return result;
  }

  private publicPayment(payment: any) {
    return {
      id: payment.publicId || payment.id,
      orderId: payment.orderId,
      provider: payment.gateway || "paystack",
      reference: payment.transactionRef,
      status: payment.commerceStatus,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      authorizationUrl: payment.authorizationUrl,
      accessCode: payment.accessCode,
      paidAt: payment.paidAt,
    };
  }
}
