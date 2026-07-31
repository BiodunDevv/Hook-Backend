import { BaseEntity, createModel, createSchema } from "@models/base.model";

export interface OrderItem extends BaseEntity {
  publicId?: string;
  orderId: string;
  productId: string;
  productTitle: string;
  productImage?: string;
  vendorId?: string;
  variantId?: string;
  marketId?: string;
  stateId?: string;
  quoteId?: string;
  unitPriceMinor?: number;
  totalPriceMinor?: number;
  currency?: string;
  productSnapshot?: Record<string, unknown>;
  variantSnapshot?: Record<string, unknown>;
  quoteSnapshot?: Record<string, unknown>;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  selectedVariants?: { color?: string; size?: string };
  commissionAmount: number;
  product?: any;
  vendor?: any;
  order?: any;
  commerceMigrationVersion?: number;
}

const OrderItemSchema = createSchema<OrderItem>({
  publicId: { type: String, unique: true, sparse: true, index: true },
  orderId: { type: String, required: true, index: true },
  productId: { type: String, required: true, index: true },
  productTitle: { type: String, required: true },
  productImage: { type: String },
  vendorId: { type: String, index: true, sparse: true },
  variantId: { type: String, index: true, sparse: true },
  marketId: { type: String, index: true, sparse: true },
  stateId: { type: String, index: true, sparse: true },
  quoteId: { type: String, index: true, sparse: true },
  unitPriceMinor: { type: Number, min: 0 },
  totalPriceMinor: { type: Number, min: 0 },
  currency: { type: String, default: "NGN" },
  productSnapshot: { type: Object },
  variantSnapshot: { type: Object },
  quoteSnapshot: { type: Object },
  quantity: { type: Number, required: true },
  unitPrice: { type: Number, required: true },
  totalPrice: { type: Number, required: true },
  selectedVariants: { type: Object },
  commissionAmount: { type: Number, default: 0 },
  commerceMigrationVersion: { type: Number, index: true },
  deletedAt: { type: Date },
});

export const OrderItem = createModel<OrderItem>("OrderItem", OrderItemSchema);
