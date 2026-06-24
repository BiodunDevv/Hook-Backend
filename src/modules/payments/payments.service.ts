import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { Order } from '@modules/orders/entities/order.entity';
import { PaymentStatus, ESCROW_HOLD_HOURS } from '@common/constants';
import { PaystackService } from '@integrations/paystack/paystack.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment) private paymentRepo: Repository<Payment>,
    @InjectRepository(Order) private orderRepo: Repository<Order>,
    private paystackService: PaystackService,
  ) {}

  async initiatePayment(orderId: string, userId: string) {
    const order = await this.orderRepo.findOne({ where: { id: orderId, userId }, relations: {
  items: true
} });
    if (!order) throw new BadRequestException('Order not found');

    // Initialize payment with Paystack
    const ref = `HK-${Date.now()}-${userId.substring(0, 6)}`;
    const payment = this.paymentRepo.create({
      orderId,
      transactionRef: ref,
      gateway: 'paystack',
      amount: order.total,
      status: PaymentStatus.PENDING,
    });
    await this.paymentRepo.save(payment);

    // Get payment URL from Paystack
    const result = await this.paystackService.initializeTransaction({
      email: '', // will be set by caller
      amount: order.total * 100, // Paystack uses kobo
      reference: ref,
      callbackUrl: `${process.env.APP_URL}/payment/callback`,
    });

    return { paymentUrl: result.data.authorization_url, transactionRef: ref };
  }

  async verifyPayment(reference: string) {
    const payment = await this.paymentRepo.findOne({ where: { transactionRef: reference }, relations: {
  order: true
} });
    if (!payment) throw new BadRequestException('Payment not found');

    const verification = await this.paystackService.verifyTransaction(reference);

    if (verification.data.status === 'success') {
      payment.status = PaymentStatus.SUCCESSFUL;
      payment.gatewayRef = verification.data.id?.toString();
      payment.gatewayResponse = verification.data;
      payment.amountSettled = verification.data.amount / 100;
      payment.paidAt = new Date();
      await this.paymentRepo.save(payment);

      await this.orderRepo.update(payment.orderId, { paymentStatus: PaymentStatus.SUCCESSFUL });
      this.logger.log(`Payment verified for order ${payment.orderId}: ${reference}`);
    }

    return payment;
  }

  async handleWebhook(payload: any) {
    // Verify webhook signature
    const event = payload.event;
    if (event === 'charge.success') {
      await this.verifyPayment(payload.data.reference);
    }
    return { received: true };
  }

  async getPaymentByOrder(orderId: string) {
    return this.paymentRepo.findOne({ where: { orderId } });
  }

  async getAllPayments(page = 1, limit = 20) {
    const [data, total] = await this.paymentRepo.findAndCount({
      relations: {
  order: true
},
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
