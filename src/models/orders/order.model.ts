import { OrderStatus, OrderType, PaymentMode, PaymentStatus } from '@lib/constants';
import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface Order extends BaseEntity {
  orderCode: string;
  userId?: string;
  guestId?: string;
  guestEmail?: string;
  guestName?: string;
  items?: any[];
  payment?: any;
  logistics?: any;
  user?: any;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  vendorCount: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMode: PaymentMode;
  orderType: OrderType;
  giftRecipient?: { name: string; email: string; phone: string; address: Order['deliveryAddress']; message?: string };
  boothId?: string;
  boothSnapshot?: { name: string; accessCodeMasked: string; source: 'code' | 'qr' };
  attendantSnapshot?: { userId: string; name: string; email: string; phone: string };
  deliverySubsidy: number;
  vendorConfirmationDeadline?: Date;
  partialFulfilment: boolean;
  deliveryAddress: {
    street: string;
    city: string;
    state: string;
    landmark?: string;
    coordinates?: { lat: number; lng: number };
    phone: string;
  };
  deliveryNotes?: string;
  scheduledDeliveryAt?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
}

const OrderSchema = createSchema<Order>({
  orderCode: { type: String, required: true, unique: true, index: true },
  userId: { type: String, index: true },
  guestId: { type: String, index: true },
  guestEmail: { type: String, lowercase: true, trim: true },
  guestName: { type: String },
  subtotal: { type: Number, required: true },
  deliveryFee: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  total: { type: Number, required: true },
  vendorCount: { type: Number, default: 0 },
  status: { type: String, enum: Object.values(OrderStatus), default: OrderStatus.PENDING, index: true },
  paymentStatus: { type: String, enum: Object.values(PaymentStatus), default: PaymentStatus.UNPAID, index: true },
  paymentMode: { type: String, enum: Object.values(PaymentMode), default: PaymentMode.PAY_NOW, index: true },
  orderType: { type: String, enum: Object.values(OrderType), default: OrderType.STANDARD, index: true },
  giftRecipient: { type: Object },
  boothId: { type: String, index: true },
  boothSnapshot: { type: Object },
  attendantSnapshot: { type: Object },
  deliverySubsidy: { type: Number, default: 0 },
  vendorConfirmationDeadline: { type: Date, index: true },
  partialFulfilment: { type: Boolean, default: false },
  deliveryAddress: { type: Object, required: true },
  deliveryNotes: { type: String },
  scheduledDeliveryAt: { type: Date },
  deliveredAt: { type: Date },
  cancelledAt: { type: Date },
  cancellationReason: { type: String },
  deletedAt: { type: Date },
});

OrderSchema.index({ userId: 1, status: 1 });
OrderSchema.index({ guestId: 1, status: 1 });
OrderSchema.index({ boothId: 1, createdAt: -1 });
OrderSchema.index({ boothId: 1, paymentStatus: 1, status: 1 });

export const Order = createModel<Order>('Order', OrderSchema);
