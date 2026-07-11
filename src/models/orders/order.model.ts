import { OrderStatus, PaymentStatus } from '@lib/constants';
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

export const Order = createModel<Order>('Order', OrderSchema);
