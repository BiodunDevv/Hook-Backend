import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface CartItem extends BaseEntity {
  cartId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  selectedVariants?: { color?: string; size?: string };
  product?: any;
  cart?: any;
}

const CartItemSchema = createSchema<CartItem>({
  cartId: { type: String, required: true, index: true },
  productId: { type: String, required: true, index: true },
  quantity: { type: Number, required: true },
  unitPrice: { type: Number, required: true },
  totalPrice: { type: Number, required: true },
  selectedVariants: { type: Object },
  deletedAt: { type: Date },
});

CartItemSchema.index({ cartId: 1, productId: 1 });

export const CartItem = createModel<CartItem>('CartItem', CartItemSchema);
