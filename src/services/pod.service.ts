import {
  CommerceOrderStatus,
  CommercePaymentStatus,
  OrderStatus,
} from "@lib/constants";
import {
  CommerceSettings,
  PodCallRecord,
  PodOverride,
} from "@models/commerce/commerce.model";
import { Order } from "@models/orders/order.model";
import { Payment } from "@models/payments/payment.model";
import { User } from "@models/users/user.model";
import { PaymentService } from "@services/payment.service";
import { HttpError } from "@utils/http";
import { isValidObjectId } from "mongoose";
import { createCommerceNotification } from "@services/commerce-notification.service";

function orderIdentity(value: string) {
  return isValidObjectId(value)
    ? { $or: [{ _id: value }, { publicId: value }] }
    : { publicId: value };
}

export class PodService {
  private payments = new PaymentService();

  async recordCall(
    orderId: string,
    actorId: string,
    outcome: PodCallRecord["outcome"],
    notes?: string,
  ) {
    const order = await Order.findOne(orderIdentity(orderId));
    if (!order || order.commercePaymentMethod !== "PAY_AT_HANDOVER")
      throw new HttpError(404, "Pay-at-Handover Order not found");
    if (
      ![
        CommerceOrderStatus.OPERATIONS_REVIEW,
        CommerceOrderStatus.VERIFICATION_PENDING,
      ].includes(order.commerceStatus as any)
    )
      throw new HttpError(
        409,
        "Order is not awaiting POD verification",
        undefined,
        "INVALID_STATE_TRANSITION",
      );
    const record = await PodCallRecord.create({
      orderId: order.id,
      actorId,
      outcome,
      notes,
      calledAt: new Date(),
    });
    order.podReview = {
      ...(order.podReview || {}),
      lastCallId: record.id,
      callOutcome: outcome,
      callRecordedAt: record.calledAt,
      callActorId: actorId,
    };
    await order.save();
    return record;
  }

  async override(orderId: string, actorId: string, reason: string) {
    const order = await Order.findOne(orderIdentity(orderId));
    if (!order || order.commercePaymentMethod !== "PAY_AT_HANDOVER")
      throw new HttpError(404, "Pay-at-Handover Order not found");
    if (!(order.podReview as any)?.requiresOverride)
      throw new HttpError(
        409,
        "This Order does not require a high-value override",
      );
    const override = await PodOverride.findOneAndUpdate(
      { orderId: order.id },
      {
        $setOnInsert: {
          orderId: order.id,
          actorId,
          reason,
          amountMinor: order.totalMinor,
          approvedAt: new Date(),
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );
    order.podReview = {
      ...(order.podReview || {}),
      overrideId: override.id,
      overrideApproved: true,
      overrideApprovedAt: override.approvedAt,
      overrideActorId: actorId,
    };
    await order.save();
    return override;
  }

  async decide(
    orderId: string,
    actorId: string,
    decision: "APPROVE" | "PREPAYMENT_REQUIRED" | "CANCELLED",
    reason: string,
  ) {
    const order = await Order.findOne(orderIdentity(orderId));
    if (!order || order.commercePaymentMethod !== "PAY_AT_HANDOVER")
      throw new HttpError(404, "Pay-at-Handover Order not found");
    const pod = (order.podReview as any) || {};
    if (decision === "APPROVE") {
      if (pod.callOutcome !== "CONFIRMED")
        throw new HttpError(
          409,
          "A successful customer confirmation call is required",
          undefined,
          "POD_CONFIRMATION_REQUIRED",
        );
      if (pod.requiresOverride && !pod.overrideApproved)
        throw new HttpError(
          409,
          "Super Admin high-value override is required",
          undefined,
          "POD_OVERRIDE_REQUIRED",
        );
      const customer = await User.findById(order.userId).lean();
      if (!customer?.podEligible)
        throw new HttpError(
          409,
          "Customer is not eligible for Pay at Handover",
          undefined,
          "POD_NOT_ELIGIBLE",
        );
      order.commerceStatus = CommerceOrderStatus.APPROVED_FOR_FULFILMENT;
      order.commercePaymentStatus = CommercePaymentStatus.DUE_AT_HANDOVER;
      order.status = OrderStatus.APPROVED_FOR_FULFILMENT;
      order.timeline = [
        ...(order.timeline || []),
        {
          status: CommerceOrderStatus.APPROVED_FOR_FULFILMENT,
          at: new Date(),
          actorType: "POD_OPERATIONS",
          actorId,
          reason,
        },
      ];
      await order.save();
      await this.payments.approvePodPayment(order.id);
      await this.payments.emitOrderApproved(order);
    } else if (decision === "PREPAYMENT_REQUIRED") {
      order.commercePaymentMethod = "PREPAID";
      order.commercePaymentStatus = CommercePaymentStatus.PENDING;
      order.commerceStatus = CommerceOrderStatus.AWAITING_PAYMENT;
      order.status = OrderStatus.AWAITING_PAYMENT;
      order.timeline = [
        ...(order.timeline || []),
        { status: "PREPAYMENT_REQUIRED", at: new Date(), actorId, reason },
      ];
      await Payment.updateOne(
        { orderId: order.id },
        {
          $set: {
            paymentMethod: "card",
            gateway: "paystack",
            commerceStatus: CommercePaymentStatus.PENDING,
          },
        },
      );
      await order.save();
    } else {
      order.commerceStatus = CommerceOrderStatus.CANCELLED;
      order.status = OrderStatus.CANCELLED;
      order.cancelledAt = new Date();
      order.cancellationReason = reason;
      order.timeline = [
        ...(order.timeline || []),
        {
          status: CommerceOrderStatus.CANCELLED,
          at: new Date(),
          actorId,
          reason,
        },
      ];
      await order.save();
    }
    if (order.userId) {
      const copy =
        decision === "APPROVE"
          ? {
              title: "Order approved",
              body: "Your Pay-at-Handover Order is approved for fulfilment.",
              type: "pod_approved",
            }
          : decision === "PREPAYMENT_REQUIRED"
            ? {
                title: "Prepayment required",
                body: "Complete secure Paystack payment to continue this Order.",
                type: "prepayment_required",
              }
            : {
                title: "Order cancelled",
                body: "Your Pay-at-Handover request was declined. Review the Order for details.",
                type: "order_cancelled",
              };
      await createCommerceNotification({
        eventKey: `order:${order.publicId}:pod:${decision}`,
        userId: order.userId,
        ...copy,
        data: { orderId: order.publicId },
      }).catch(() => undefined);
    }
    return order.toJSON();
  }

  async restoreCustomer(customerId: string, actorId: string, reason: string) {
    const customer = await User.findByIdAndUpdate(
      customerId,
      {
        $set: {
          podEligible: true,
          podDisabledReason: undefined,
          podEligibilityUpdatedAt: new Date(),
        },
      },
      { returnDocument: "after" },
    ).lean({ virtuals: true });
    if (!customer) throw new HttpError(404, "Customer not found");
    return {
      id: customer.publicId,
      podEligible: customer.podEligible,
      updatedBy: actorId,
      reason,
    };
  }

  async getSettings() {
    return CommerceSettings.findOne({ key: "commerce" }).lean({
      virtuals: true,
    });
  }
  async updateSettings(actorId: string, update: Record<string, unknown>) {
    return CommerceSettings.findOneAndUpdate(
      { key: "commerce" },
      { $set: { ...update, updatedBy: actorId } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    ).lean({ virtuals: true });
  }
}
