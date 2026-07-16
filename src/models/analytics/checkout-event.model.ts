import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface CheckoutEvent extends BaseEntity {
  userId?: string;
  guestId?: string;
  orderId?: string;
  sessionId: string;
  event: 'payment_options_shown' | 'payment_method_selected' | 'checkout_abandoned' | 'payment_initiated' | 'payment_completed' | 'refund_requested' | 'order_cancelled' | 'delivered';
  paymentMode?: 'pay_now' | 'pay_on_delivery';
  metadata?: Record<string, unknown>;
}
const schema = createSchema<CheckoutEvent>({
  userId: { type: String, index: true },
  guestId: { type: String, index: true },
  orderId: { type: String, index: true },
  sessionId: { type: String, required: true, index: true },
  event: { type: String, required: true, index: true },
  paymentMode: { type: String, enum: ['pay_now', 'pay_on_delivery'] },
  metadata: { type: Object },
  deletedAt: { type: Date },
});
schema.index({ event: 1, createdAt: 1 });
export const CheckoutEvent = createModel<CheckoutEvent>('CheckoutEvent', schema);
