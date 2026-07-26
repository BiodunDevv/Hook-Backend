import type { MongoRepository as Repository } from '@lib/mongo-repository';
import { EscrowEventType, OrderStatus, PaymentMode, PaymentStatus } from '@lib/constants';
import { EscrowLedger } from '@models/payments/escrow-ledger.model';
import { Order } from '@models/orders/order.model';
import { Payment } from '@models/payments/payment.model';
import { HttpError } from '@utils/http';
import { OpayProvider } from './payments/opay.provider';

type Method = 'card' | 'bank_transfer' | 'ussd' | 'pos';

export class PaymentService {
  private provider = new OpayProvider();

  constructor(
    private readonly payments: Repository<Payment>,
    private readonly orders: Repository<Order>,
    private readonly ledger: Repository<EscrowLedger>,
  ) {}

  async initialize(ownerId: string, orderId: string, _gateway: 'opay', paymentMethod: Method) {
    const order = await this.findOwnedOrder(ownerId, orderId);
    if (order.paymentMode === PaymentMode.PAY_ON_DELIVERY && paymentMethod !== 'pos') {
      throw new HttpError(400, 'Pay on Delivery must be collected through the OPay delivery flow');
    }
    let payment = await this.payments.findOne({ where: { orderId } });
    if (!payment) payment = this.payments.create({
      orderId,
      transactionRef: `OPAY-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      gateway: 'opay', paymentMethod, amount: order.total, gatewayFee: 0, amountSettled: 0,
      status: PaymentStatus.PENDING, refundedAmount: 0,
      resourceType: 'order',
    });
    payment.gateway = 'opay';
    payment.paymentMethod = paymentMethod;
    const provider = await this.provider.initialize({
      reference: payment.transactionRef,
      amount: payment.amount,
      callbackUrl: `${process.env.APP_URL || ''}/api/v1/webhooks/payments/opay`,
      paymentMethod,
    });
    payment.gatewayResponse = provider;
    await this.payments.save(payment);
    await this.orders.update(orderId, { paymentStatus: PaymentStatus.PENDING });
    return { payment, ...provider };
  }

  async verify(ownerId: string, reference: string) {
    const payment = await this.payments.findOne({ where: { transactionRef: reference } });
    if (!payment) throw new HttpError(404, 'Payment not found');
    await this.assertPaymentOwner(ownerId, payment);
    const providerStatus = await this.provider.query(reference);
    await this.applyProviderStatus(payment, providerStatus, `query:${reference}:${String((providerStatus as any).orderNo || '')}`);
    return this.payments.findOne({ where: { id: payment.id } });
  }

  async status(ownerId: string, orderId: string) {
    const order = await this.findOwnedOrder(ownerId, orderId);
    return { orderId, paymentMode: order.paymentMode, paymentStatus: order.paymentStatus, payment: await this.payments.findOne({ where: { orderId } }) };
  }

  capability() { return this.provider.capability; }

  async webhook(payload: Record<string, unknown>, idempotencyKey: string, signature: string) {
    if (!this.provider.verifyCallback(payload, signature)) throw new HttpError(401, 'Invalid OPay callback signature');
    const data = (payload.data && typeof payload.data === 'object' ? payload.data : payload) as Record<string, unknown>;
    const reference = String(data.outOrderNo || data.reference || '');
    if (!reference) throw new HttpError(400, 'Missing OPay order reference');
    const payment = await this.payments.findOne({ where: { transactionRef: reference } });
    if (!payment) return { received: true, matched: false };
    const verifiedData = await this.provider.query(reference);
    await this.applyProviderStatus(payment, verifiedData, idempotencyKey);
    return { received: true, matched: true };
  }

  async refund(paymentId: string, amount: number, idempotencyKey: string) {
    const payment = await this.payments.findOne({ where: { id: paymentId } });
    if (!payment || payment.status !== PaymentStatus.SUCCESSFUL) throw new HttpError(409, 'Only successful payments can be refunded');
    if (amount <= 0 || amount > payment.amount - payment.refundedAmount) throw new HttpError(400, 'Invalid refund amount');
    const existing = await this.ledger.findOne({ where: { idempotencyKey } });
    if (existing) return existing;
    const provider = await this.provider.refund(payment.transactionRef, amount);
    payment.refundedAmount += amount;
    payment.refundedAt = new Date();
    payment.status = payment.refundedAmount >= payment.amount ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
    payment.gatewayResponse = { ...(payment.gatewayResponse || {}), lastRefund: provider };
    await this.payments.save(payment);
    if (payment.orderId) await this.orders.update(payment.orderId, { paymentStatus: payment.status });
    if (!payment.orderId) throw new HttpError(409, 'Legacy non-order payments cannot be refunded through this workflow');
    return this.ledger.save(this.ledger.create({
      orderId: payment.orderId, paymentId: payment.id, type: EscrowEventType.PARTIALLY_REFUNDED,
      amount, currency: 'NGN', idempotencyKey, providerReference: String((provider as any).orderNo || ''),
    }));
  }

  private async applyProviderStatus(payment: Payment, data: Record<string, unknown>, idempotencyKey: string) {
    if (await this.ledger.findOne({ where: { idempotencyKey } })) return;
    const status = String(data.status || (data as any).paymentStatus || '').toUpperCase();
    const rawAmount = data.amount as any;
    const providerAmount = rawAmount && typeof rawAmount === 'object' ? Number(rawAmount.total) : Number(rawAmount ?? payment.amount);
    const amount = providerAmount === Math.round(payment.amount * 100) ? providerAmount / 100 : providerAmount;
    const currency = String((rawAmount && typeof rawAmount === 'object' ? rawAmount.currency : data.currency) || 'NGN').toUpperCase();
    if (amount !== payment.amount || currency !== 'NGN') throw new HttpError(409, 'Provider payment amount or currency mismatch');
    if (status !== 'SUCCESS') return;
    payment.status = PaymentStatus.SUCCESSFUL;
    payment.paidAt = payment.paidAt || new Date();
    payment.gatewayRef = String(data.orderNo || data.payNo || payment.gatewayRef || '');
    payment.gatewayResponse = data;
    await this.payments.save(payment);
    if (payment.orderId) {
      await this.orders.update(payment.orderId, { paymentStatus: PaymentStatus.SUCCESSFUL, status: OrderStatus.PENDING });
    }
    if (!payment.orderId) throw new HttpError(409, 'Legacy non-order payments cannot be activated');
    await this.ledger.save(this.ledger.create({
      orderId: payment.orderId, paymentId: payment.id, type: EscrowEventType.PAYMENT_RECEIVED,
      amount: payment.amount, currency: 'NGN', idempotencyKey, providerReference: payment.gatewayRef,
    }));
    await this.ledger.save(this.ledger.create({
      orderId: payment.orderId, paymentId: payment.id, type: EscrowEventType.HELD,
      amount: payment.amount, currency: 'NGN', idempotencyKey: `held:${idempotencyKey}`,
    }));
  }

  private async findOwnedOrder(ownerId: string, orderId: string) {
    const order = await this.orders.findOne({ where: [{ id: orderId, userId: ownerId }, { id: orderId, guestId: ownerId }] });
    if (!order) throw new HttpError(404, 'Order not found');
    return order;
  }

  private async assertPaymentOwner(ownerId: string, payment: Payment) {
    if (payment.orderId) return this.findOwnedOrder(ownerId, payment.orderId);
    throw new HttpError(404, 'Payment not found');
  }
}
