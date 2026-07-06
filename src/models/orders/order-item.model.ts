import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface OrderItem extends BaseEntity {
  orderId: string;
  productId: string;
  productTitle: string;
  productImage?: string;
  vendorId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  selectedVariants?: { color?: string; size?: string };
  commissionAmount: number;
  product?: any;
  vendor?: any;
  order?: any;
}

const OrderItemSchema = createSchema<OrderItem>({
  orderId: { type: String, required: true, index: true },
  productId: { type: String, required: true, index: true },
  productTitle: { type: String, required: true },
  productImage: { type: String },
  vendorId: { type: String, required: true, index: true },
  quantity: { type: Number, required: true },
  unitPrice: { type: Number, required: true },
  totalPrice: { type: Number, required: true },
  selectedVariants: { type: Object },
  commissionAmount: { type: Number, default: 0 },
  deletedAt: { type: Date },
});

export const OrderItem = createModel<OrderItem>('OrderItem', OrderItemSchema);
