import { BaseEntity, createModel, createSchema } from "@models/base.model";

export interface ProductLike extends BaseEntity {
  userId: string;
  productId: string;
  productPublicId: string;
}

const ProductLikeSchema = createSchema<ProductLike>({
  userId: { type: String, required: true, index: true },
  productId: { type: String, required: true, index: true },
  productPublicId: { type: String, required: true, index: true },
  deletedAt: { type: Date },
});

ProductLikeSchema.index({ userId: 1, productId: 1 }, { unique: true });
ProductLikeSchema.index({ userId: 1, createdAt: -1 });

export const ProductLike = createModel<ProductLike>(
  "ProductLike",
  ProductLikeSchema,
);
