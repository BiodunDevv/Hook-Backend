import type { MongoRepository as Repository } from '@lib/mongo-repository';
import { PaymentStatus } from '@lib/constants';
import { Order } from '@models/orders/order.model';
import { Payment } from '@models/payments/payment.model';
import { HttpError } from '@utils/http';

type Gateway = 'paystack' | 'nomba';
type Method = 'card' | 'bank_transfer' | 'ussd';

export class PaymentService {
  constructor(
    private readonly payments: Repository<Payment>,
    private readonly orders: Repository<Order>,
  ) {}

  async initialize(userId: string, orderId: string, gateway: Gateway, paymentMethod: Method) {
    const order = await this.orders.findOne({ where: { id: orderId, userId } });
    if (!order) throw new HttpError(404, 'Order not found');

    const existing = await this.payments.findOne({ where: { orderId } });
    const payment = existing || this.payments.create({
      orderId,
      transactionRef: `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      gateway,
      paymentMethod,
      amount: order.total,
      gatewayFee: Math.round(order.total * 0.015),
      amountSettled: 0,
      status: PaymentStatus.PENDING,
      splitData: {
        hookShare: Math.round(order.total * 0.15),
        vendorShare: Math.round(order.total * 0.85),
        deliveryFee: order.deliveryFee,
        commission: Math.round(order.total * 0.15),
      },
    });

    payment.gateway = gateway;
    payment.paymentMethod = paymentMethod;
    payment.gatewayResponse = this.stubGatewayResponse(payment.transactionRef, gateway);
    await this.payments.save(payment);
    await this.orders.update(orderId, { paymentStatus: PaymentStatus.PENDING });

    return {
      payment,
      authorizationUrl: `https://checkout.hook.local/${gateway}/${payment.transactionRef}`,
      providerMode: 'stub',
    };
  }

  async verify(userId: string, reference: string) {
    const payment = await this.payments.findOne({ where: { transactionRef: reference }, relations: { order: true } });
    if (!payment || payment.order.userId !== userId) throw new HttpError(404, 'Payment not found');
    payment.status = PaymentStatus.SUCCESSFUL;
    payment.paidAt = new Date();
    payment.amountSettled = payment.amount - payment.gatewayFee;
    await this.payments.save(payment);
    await this.orders.update(payment.orderId, { paymentStatus: PaymentStatus.SUCCESSFUL });
    return payment;
  }

  async status(userId: string, orderId: string) {
    const order = await this.orders.findOne({ where: { id: orderId, userId }, relations: { payment: true } });
    if (!order) throw new HttpError(404, 'Order not found');
    return { orderId, paymentStatus: order.paymentStatus, payment: order.payment };
  }

  async webhook(gateway: Gateway, payload: Record<string, unknown>) {
    const reference = String(payload.reference || payload.transactionRef || '');
    if (!reference) return { received: true, matched: false };
    const payment = await this.payments.findOne({ where: { transactionRef: reference } });
    if (!payment) return { received: true, matched: false };
    payment.gateway = gateway;
    payment.gatewayResponse = payload;
    payment.status = String(payload.status).toLowerCase() === 'success'
      ? PaymentStatus.SUCCESSFUL
      : payment.status;
    if (payment.status === PaymentStatus.SUCCESSFUL) {
      payment.paidAt = payment.paidAt || new Date();
      await this.orders.update(payment.orderId, { paymentStatus: PaymentStatus.SUCCESSFUL });
    }
    await this.payments.save(payment);
    return { received: true, matched: true };
  }

  private stubGatewayResponse(reference: string, gateway: Gateway) {
    const hasKey = gateway === 'paystack'
      ? !!process.env.PAYSTACK_SECRET_KEY && !process.env.PAYSTACK_SECRET_KEY.includes('your_')
      : !!process.env.NOMBA_SECRET_KEY && !process.env.NOMBA_SECRET_KEY.includes('your_');
    return {
      gateway,
      mode: hasKey ? 'ready_for_live_adapter' : 'stub',
      reference,
      message: hasKey
        ? 'Provider key detected; live adapter can be enabled here.'
        : 'Provider key missing or placeholder; returning stub authorization.',
    };
  }
}
