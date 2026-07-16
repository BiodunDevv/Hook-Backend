import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface SavedPaymentMethod extends BaseEntity {
  userId: string;
  provider: 'opay';
  providerToken: string;
  brand?: string;
  last4: string;
  expiryDisplay?: string;
  consentedAt: Date;
  isDefault: boolean;
  isActive: boolean;
}

const schema = createSchema<SavedPaymentMethod>({
  userId: { type: String, required: true, index: true },
  provider: { type: String, enum: ['opay'], default: 'opay' },
  providerToken: { type: String, required: true },
  brand: { type: String },
  last4: { type: String, required: true, minlength: 4, maxlength: 4 },
  expiryDisplay: { type: String },
  consentedAt: { type: Date, required: true },
  isDefault: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  deletedAt: { type: Date },
});
schema.index({ userId: 1, providerToken: 1 }, { unique: true });
export const SavedPaymentMethod = createModel<SavedPaymentMethod>('SavedPaymentMethod', schema);
