import { AppDataSource } from '@config/data-source';
import { EscrowEventType, OrderStatus, PaymentStatus, SettlementStatus, VendorFulfilmentStatus } from '@lib/constants';
import { EscrowLedger } from '@models/payments/escrow-ledger.model';
import { OrderItem } from '@models/orders/order-item.model';
import { Order } from '@models/orders/order.model';
import { VendorFulfilment } from '@models/orders/vendor-fulfilment.model';
import { Payment } from '@models/payments/payment.model';
import { Product } from '@models/products/product.model';
import { Settlement } from '@models/settlements/settlement.model';
import { HttpError } from '@utils/http';

export class FulfilmentService {
  private fulfilments = AppDataSource.getRepository(VendorFulfilment);
  private orders = AppDataSource.getRepository(Order);
  private items = AppDataSource.getRepository(OrderItem);
  private payments = AppDataSource.getRepository(Payment);
  private settlements = AppDataSource.getRepository(Settlement);
  private ledger = AppDataSource.getRepository(EscrowLedger);

  async decide(input: {
    orderId: string;
    vendorId: string;
    decision: 'confirmed' | 'rejected';
    actorId: string;
    reason?: string;
    idempotencyKey: string;
  }) {
    const order = await this.orders.findOne({ where: { id: input.orderId } });
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.status === OrderStatus.AWAITING_PAYMENT || order.paymentStatus === PaymentStatus.UNPAID) {
      throw new HttpError(409, 'Vendor confirmation starts only after payment is verified');
    }
    const fulfilment = await this.fulfilments.findOne({ where: { orderId: input.orderId, vendorId: input.vendorId } });
    if (!fulfilment) throw new HttpError(404, 'Vendor fulfilment not found');
    if (fulfilment.idempotencyKeys?.includes(input.idempotencyKey)) return fulfilment;
    if (fulfilment.status !== VendorFulfilmentStatus.AWAITING_CONFIRMATION) {
      throw new HttpError(409, 'This vendor fulfilment has already been decided');
    }
    if (input.decision === 'rejected' && !input.reason) throw new HttpError(400, 'A rejection reason is required');

    const items = await this.items.find({ where: { id: { $in: fulfilment.orderItemIds } } });
    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product) continue;
      if (input.decision === 'confirmed') {
        if (product.quantity < item.quantity || product.reservedQuantity < item.quantity) {
          throw new HttpError(409, `${item.productTitle} no longer has enough reserved stock`);
        }
        product.quantity -= item.quantity;
        product.reservedQuantity -= item.quantity;
        product.orderCount += 1;
      } else {
        product.reservedQuantity = Math.max(0, product.reservedQuantity - item.quantity);
      }
      await product.save();
    }

    fulfilment.status = input.decision === 'confirmed'
      ? VendorFulfilmentStatus.CONFIRMED
      : VendorFulfilmentStatus.REJECTED;
    fulfilment.decidedBy = input.actorId;
    fulfilment.idempotencyKeys = [...(fulfilment.idempotencyKeys || []), input.idempotencyKey];
    if (input.decision === 'confirmed') fulfilment.confirmedAt = new Date();
    else {
      fulfilment.rejectedAt = new Date();
      fulfilment.rejectionReason = input.reason;
      fulfilment.refundAmount = fulfilment.itemTotal;
    }
    await this.fulfilments.save(fulfilment);

    if (input.decision === 'confirmed') await this.makePayoutEligible(fulfilment);
    else await this.queueRefund(fulfilment, input.idempotencyKey);
    await this.recalculateOrder(input.orderId);
    return this.fulfilments.findOne({ where: { id: fulfilment.id } });
  }

  async expireOverdue() {
    const overdue = await this.fulfilments.find({
      where: { status: VendorFulfilmentStatus.AWAITING_CONFIRMATION, confirmationDeadline: { $lt: new Date() } },
    });
    for (const fulfilment of overdue) {
      const order = await this.orders.findOne({ where: { id: fulfilment.orderId } });
      if (!order || order.status === OrderStatus.AWAITING_PAYMENT) continue;
      await this.decide({
        orderId: fulfilment.orderId,
        vendorId: fulfilment.vendorId,
        decision: 'rejected',
        actorId: 'system',
        reason: 'Vendor confirmation deadline expired',
        idempotencyKey: `expiry:${fulfilment.id}`,
      });
    }
    return overdue.length;
  }

  async makePayoutEligible(fulfilment: VendorFulfilment) {
    const payment = await this.payments.findOne({ where: { orderId: fulfilment.orderId, status: PaymentStatus.SUCCESSFUL } });
    if (!payment) return;
    const existing = await this.settlements.findOne({ where: { orderId: fulfilment.orderId, vendorId: fulfilment.vendorId } });
    if (!existing) {
      await this.settlements.save(this.settlements.create({
        vendorId: fulfilment.vendorId,
        orderId: fulfilment.orderId,
        itemTotal: fulfilment.itemTotal,
        commissionAmount: fulfilment.commissionAmount,
        netAmount: fulfilment.itemTotal - fulfilment.commissionAmount,
        deliveryFeePortion: 0,
        status: SettlementStatus.CLEARED,
        escrowReleaseAt: new Date(),
        escrowReleasedAt: new Date(),
      }));
    }
    await this.appendLedger({
      orderId: fulfilment.orderId,
      paymentId: payment.id,
      vendorId: fulfilment.vendorId,
      fulfilmentId: fulfilment.id,
      type: EscrowEventType.ELIGIBLE_FOR_PAYOUT,
      amount: fulfilment.itemTotal - fulfilment.commissionAmount,
      idempotencyKey: `eligible:${fulfilment.id}:${payment.id}`,
    });
  }

  private async queueRefund(fulfilment: VendorFulfilment, key: string) {
    const payment = await this.payments.findOne({ where: { orderId: fulfilment.orderId, status: PaymentStatus.SUCCESSFUL } });
    if (!payment) return;
    await this.appendLedger({
      orderId: fulfilment.orderId,
      paymentId: payment.id,
      vendorId: fulfilment.vendorId,
      fulfilmentId: fulfilment.id,
      type: EscrowEventType.REFUND_PENDING,
      amount: fulfilment.itemTotal,
      idempotencyKey: `refund:${key}`,
    });
  }

  private async recalculateOrder(orderId: string) {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) return;
    const rows = await this.fulfilments.find({ where: { orderId } });
    const waiting = rows.some((row) => row.status === VendorFulfilmentStatus.AWAITING_CONFIRMATION);
    const accepted = rows.filter((row) => row.status === VendorFulfilmentStatus.CONFIRMED);
    const rejected = rows.filter((row) => row.status === VendorFulfilmentStatus.REJECTED);
    if (!waiting) {
      if (!accepted.length) {
        order.status = OrderStatus.CANCELLED;
        order.deliveryFee = 0;
        order.total = 0;
      } else {
        order.status = OrderStatus.CONFIRMED;
        order.partialFulfilment = rejected.length > 0;
        const rejectedAmount = rejected.reduce((sum, row) => sum + row.itemTotal, 0);
        order.subtotal = Math.max(0, order.subtotal - rejectedAmount);
        order.total = Math.max(0, order.subtotal + order.deliveryFee - order.discount);
      }
      await this.orders.save(order);
    }
  }

  private async appendLedger(payload: Omit<EscrowLedger, 'id' | 'createdAt' | 'updatedAt' | 'currency'>) {
    const existing = await this.ledger.findOne({ where: { idempotencyKey: payload.idempotencyKey } });
    if (!existing) await this.ledger.save(this.ledger.create({ ...payload, currency: 'NGN' }));
  }
}
