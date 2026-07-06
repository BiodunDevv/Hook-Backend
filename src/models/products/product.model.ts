import { ProductStatus } from '@lib/constants';
import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface Product extends BaseEntity {
  title: string;
  slug: string;
  description?: string;
  costPrice: number;
  sellingPrice: number;
  discountedPrice?: number;
  minAcceptablePrice: number;
  quantity: number;
  reservedQuantity: number;
  colors?: string[];
  sizes?: string[];
  images: string[];
  videos?: string[];
  hookId?: string;
  status: ProductStatus;
  viewCount: number;
  orderCount: number;
  averageRating: number;
  vendorId: string;
  categoryId: string;
  vendor?: any;
  category?: any;
}

const ProductSchema = createSchema<Product>({
  title: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, trim: true },
  description: { type: String },
  costPrice: { type: Number, required: true },
  sellingPrice: { type: Number, required: true },
  discountedPrice: { type: Number },
  minAcceptablePrice: { type: Number, required: true },
  quantity: { type: Number, default: 0 },
  reservedQuantity: { type: Number, default: 0 },
  colors: [{ type: String }],
  sizes: [{ type: String }],
  images: [{ type: String }],
  videos: [{ type: String }],
  hookId: { type: String, unique: true, sparse: true },
  status: { type: String, enum: Object.values(ProductStatus), default: ProductStatus.DRAFT, index: true },
  viewCount: { type: Number, default: 0 },
  orderCount: { type: Number, default: 0 },
  averageRating: { type: Number, default: 0 },
  vendorId: { type: String, required: true, index: true },
  categoryId: { type: String, required: true, index: true },
  deletedAt: { type: Date },
});

ProductSchema.index({ vendorId: 1, status: 1 });
ProductSchema.index({ categoryId: 1 });
ProductSchema.index({ title: 'text', description: 'text' });

export const Product = createModel<Product>('Product', ProductSchema);
