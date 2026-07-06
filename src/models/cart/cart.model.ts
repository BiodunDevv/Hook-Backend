import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface Cart extends BaseEntity {
  userId: string;
  items?: any[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  isCheckedOut: boolean;
  user?: any;
}

const CartSchema = createSchema<Cart>({
  userId: { type: String, required: true, index: true },
  subtotal: { type: Number, default: 0 },
  deliveryFee: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  isCheckedOut: { type: Boolean, default: false },
  deletedAt: { type: Date },
});

CartSchema.index({ userId: 1, isCheckedOut: 1 });

export const Cart = createModel<Cart>('Cart', CartSchema);
