import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface BoothInventory extends BaseEntity {
  boothId: string;
  productId: string;
  vendorId: string;
  isActive: boolean;
}
const schema = createSchema<BoothInventory>({
  boothId: { type: String, required: true, index: true },
  productId: { type: String, required: true, index: true },
  vendorId: { type: String, required: true, index: true },
  isActive: { type: Boolean, default: true, index: true },
  deletedAt: { type: Date },
});
schema.index({ boothId: 1, productId: 1 }, { unique: true });
export const BoothInventory = createModel<BoothInventory>('BoothInventory', schema);
