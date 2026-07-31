import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface Category extends BaseEntity {
  publicId?: string;
  name: string;
  slug: string;
  iconUrl?: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  parentId?: string;
  attributeSchema?: Record<string, unknown>;
  requiredAttributes?: string[];
  optionalAttributes?: string[];
  variantAttributes?: string[];
  parent?: any;
  children?: any[];
  products?: any[];
}

const CategorySchema = createSchema<Category>({
  publicId: { type: String, unique: true, sparse: true, index: true },
  name: { type: String, required: true, unique: true, trim: true },
  slug: { type: String, required: true, unique: true, trim: true },
  iconUrl: { type: String },
  description: { type: String },
  sortOrder: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true, index: true },
  parentId: { type: String, index: true },
  attributeSchema: { type: Object, default: {} },
  requiredAttributes: { type: [String], default: [] },
  optionalAttributes: { type: [String], default: [] },
  variantAttributes: { type: [String], default: [] },
  deletedAt: { type: Date },
});

export const Category = createModel<Category>('Category', CategorySchema);
