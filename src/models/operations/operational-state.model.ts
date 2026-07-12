import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface OperationalState extends BaseEntity {
  code: string;
  name: string;
  countryCode: string;
  countryName: string;
  isEnabled: boolean;
  enabledAt?: Date;
  sortOrder: number;
}

const OperationalStateSchema = createSchema<OperationalState>({
  code: { type: String, required: true, uppercase: true, trim: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  countryCode: { type: String, default: 'NG', index: true },
  countryName: { type: String, default: 'Nigeria' },
  isEnabled: { type: Boolean, default: false, index: true },
  enabledAt: { type: Date },
  sortOrder: { type: Number, default: 999 },
  deletedAt: { type: Date },
});

OperationalStateSchema.index({ isEnabled: 1, sortOrder: 1 });

export const OperationalState = createModel<OperationalState>('OperationalState', OperationalStateSchema);
