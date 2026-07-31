import { createHash } from "crypto";
import { isValidObjectId } from "mongoose";
import {
  CommerceOrderStatus,
  CommercePaymentStatus,
  OrderStatus,
  PaymentStatus,
} from "@lib/constants";
import type { MongoRepository as Repository } from "@lib/mongo-repository";
import {
  CommerceOutboxEvent,
  IntegrationException,
  PaymentWebhookEvent,
} from "@models/commerce/commerce.model";
import { Order } from "@models/orders/order.model";
import { Payment } from "@models/payments/payment.model";
import { EscrowLedger } from "@models/payments/escrow-ledger.model";
import { User } from "@models/users/user.model";
import { nextPublicId } from "@services/public-id.service";
import { createCommerceNotification } from "@services/commerce-notification.service";
import { HttpError } from "@utils/http";
import { PaystackProvider } from "./payments/paystack.provider";

function identity(value: string) {
  return isValidObjectId(value)
    ? { $or: [{ _id: value }, { publicId: value }] }
    : { publicId: value };
}

export class PaymentService {
  private provider = new PaystackProvider();
  constructor(
    _payments?: Repository<Payment>,
    _orders?: Repository<Order>,
    _ledger?: Repository<EscrowLedger>,
  ) {}

  async initialize(customerId: string, orderIdentifier: string) {
    const order = await Order.findOne({
      ...identity(orderIdentifier),
      userId: customerId,
      commercePaymentMethod: "PREPAID",
    });
    if (!order) throw new HttpError(404, "Order not found");
    return this.initializeOrder(order, customerId);
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

  private async initializeOrder(order: any, customerId: string) {
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
    const payment = await Payment.findOne({ orderId: order.id });
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
      amountMinor: Number(order.totalMinor),
      currency: order.currency || "NGN",
      email: customer.email,
      callbackUrl:
        process.env.PAYSTACK_CALLBACK_URL ||
        `${String(process.env.APP_URL || "http://localhost:4000").replace(/\/$/, "")}/api/v1/payments/paystack/callback`,
      metadata: {
        orderId: order.publicId,
        paymentId: payment.publicId,
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
      payment = await Payment.findOne({ orderId: order.id });
    }
    if (!payment?.orderId) throw new HttpError(404, "Payment not found");
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

  async webhook(rawBody: Buffer, signature: string, requestId?: string) {
    const parsed = this.provider.parseWebhook(rawBody, signature);
    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    let event;
    try {
      event = await PaymentWebhookEvent.create({
        provider: "paystack",
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
    const payment = await Payment.findOne({ transactionRef: parsed.reference });
    if (!payment?.orderId) {
      event.processingStatus = "ignored";
      event.failureCode = "PAYMENT_NOT_FOUND";
      await event.save();
      return { received: true, matched: false };
    }
    try {
      const verified = await this.provider.verify(parsed.reference);
      if (verified.reference !== payment.transactionRef)
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
      event.processingStatus = "processed";
      event.processedAt = new Date();
      await event.save();
      return { received: true, processed: true };
    } catch (error: any) {
      event.processingStatus = "failed";
      event.failureCode = error?.code || "PAYMENT_EVIDENCE_MISMATCH";
      await event.save();
      await IntegrationException.create({
        provider: "paystack",
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

  private async confirmPayment(
    payment: any,
    providerId?: string,
    paidAt?: Date,
    providerEventId?: string,
  ) {
    const order = await Order.findById(payment.orderId);
    if (!order || order.commercePaymentMethod !== "PREPAID")
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
    await this.emitOrderApproved(order);
    if (order.userId)
      await createCommerceNotification({
        eventKey: `order:${order.publicId}:payment-confirmed`,
        userId: order.userId,
        title: "Payment confirmed",
        body: "Your payment was verified and your Order is approved for fulfilment.",
        type: "payment_confirmed",
        data: { orderId: order.publicId, paymentId: payment.publicId },
      }).catch(() => undefined);
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

  capability() {
    return {
      provider: "paystack",
      prepaid: Boolean(process.env.PAYSTACK_SECRET_KEY),
      payAtHandover: true,
      tokenization: false,
    };
  }

  async refund(
    _paymentId: string,
    _amount: number,
    _idempotencyKey: string,
  ): Promise<{ providerReference?: string }> {
    throw new HttpError(
      409,
      "Refund execution is deferred to the returns and refunds phase",
      undefined,
      "INVALID_STATE_TRANSITION",
    );
  }

  private publicPayment(payment: any) {
    return {
      id: payment.publicId || payment.id,
      orderId: payment.orderId,
      provider: "paystack",
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
