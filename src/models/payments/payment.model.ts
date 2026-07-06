import { PaymentStatus } from '@lib/constants';
import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface Payment extends BaseEntity {
  orderId: string;
  transactionRef: string;
  gatewayRef?: string;
  gateway: 'paystack' | 'nomba';
  paymentMethod: 'card' | 'bank_transfer' | 'ussd';
  amount: number;
  gatewayFee: number;
  amountSettled: number;
  status: PaymentStatus;
  gatewayResponse?: Record<string, unknown>;
  paidAt?: Date;
  splitData?: { hookShare: number; vendorShare: number; deliveryFee: number; commission: number };
  refundedAt?: Date;
  refundedAmount: number;
  order?: any;
}

const PaymentSchema = createSchema<Payment>({
  orderId: { type: String, required: true, unique: true, index: true },
  transactionRef: { type: String, required: true, unique: true },
  gatewayRef: { type: String, index: true },
  gateway: { type: String, enum: ['paystack', 'nomba'], required: true },
  paymentMethod: { type: String, enum: ['card', 'bank_transfer', 'ussd'], required: true },
  amount: { type: Number, required: true },
  gatewayFee: { type: Number, default: 0 },
  amountSettled: { type: Number, default: 0 },
  status: { type: String, enum: Object.values(PaymentStatus), default: PaymentStatus.PENDING, index: true },
  gatewayResponse: { type: Object },
  paidAt: { type: Date },
  splitData: { type: Object },
  refundedAt: { type: Date },
  refundedAmount: { type: Number, default: 0 },
  deletedAt: { type: Date },
});

export const Payment = createModel<Payment>('Payment', PaymentSchema);
