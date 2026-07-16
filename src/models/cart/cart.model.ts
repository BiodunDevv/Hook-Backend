import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface Cart extends BaseEntity {
  userId?: string;
  guestId?: string;
  items?: any[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  isCheckedOut: boolean;
  boothId?: string;
  boothSessionVersion?: number;
  boothSource?: 'code' | 'qr';
  user?: any;
}

const CartSchema = createSchema<Cart>({
  userId: { type: String, index: true },
  guestId: { type: String, index: true },
  subtotal: { type: Number, default: 0 },
  deliveryFee: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  isCheckedOut: { type: Boolean, default: false },
  boothId: { type: String, index: true },
  boothSessionVersion: { type: Number },
  boothSource: { type: String, enum: ['code', 'qr'] },
  deletedAt: { type: Date },
});

CartSchema.index({ userId: 1, isCheckedOut: 1 });
CartSchema.index({ guestId: 1, isCheckedOut: 1 });

export const Cart = createModel<Cart>('Cart', CartSchema);
