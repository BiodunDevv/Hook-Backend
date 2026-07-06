import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface Category extends BaseEntity {
  name: string;
  slug: string;
  iconUrl?: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  parentId?: string;
  parent?: any;
  children?: any[];
  products?: any[];
}

const CategorySchema = createSchema<Category>({
  name: { type: String, required: true, unique: true, trim: true },
  slug: { type: String, required: true, unique: true, trim: true },
  iconUrl: { type: String },
  description: { type: String },
  sortOrder: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true, index: true },
  parentId: { type: String, index: true },
  deletedAt: { type: Date },
});

export const Category = createModel<Category>('Category', CategorySchema);
