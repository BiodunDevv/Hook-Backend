import { Schema } from 'mongoose';
import { BaseEntity, createModel, createSchema } from '@models/base.model';

export type DeliveryPricingScope = 'global' | 'state' | 'zone';
export type DeliveryPricingMode = 'flat' | 'per_km' | 'distance_bands';

export interface DeliveryPricingBand {
  upToKm: number;
  feeMinor: number;
}

export interface DeliveryPricingRule extends BaseEntity {
  publicId: string;
  name: string;
  scope: DeliveryPricingScope;
  scopeId?: string;
  mode: DeliveryPricingMode;
  flatFeeMinor?: number;
  baseFeeMinor?: number;
  feePerKmMinor?: number;
  fallbackFeeMinor?: number;
  originHubId?: string;
  bands?: DeliveryPricingBand[];
  status: 'active' | 'inactive';
  effectiveFrom?: Date;
  effectiveUntil?: Date;
  version: number;
  createdBy?: string;
  updatedBy?: string;
}

const bandSchema = new Schema<DeliveryPricingBand>({
  upToKm: { type: Number, required: true, min: 0 },
  feeMinor: { type: Number, required: true, min: 0 },
}, { _id: false });

const schema = createSchema<DeliveryPricingRule>({
  publicId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  scope: { type: String, enum: ['global', 'state', 'zone'], required: true, index: true },
  scopeId: { type: String, index: true, sparse: true },
  mode: { type: String, enum: ['flat', 'per_km', 'distance_bands'], required: true },
  flatFeeMinor: { type: Number, min: 0 },
  baseFeeMinor: { type: Number, min: 0 },
  feePerKmMinor: { type: Number, min: 0 },
  fallbackFeeMinor: { type: Number, min: 0 },
  originHubId: { type: String, index: true, sparse: true },
  bands: { type: [bandSchema], default: [] },
  status: { type: String, enum: ['active', 'inactive'], default: 'inactive', index: true },
  effectiveFrom: { type: Date, index: true },
  effectiveUntil: { type: Date, index: true },
  version: { type: Number, default: 1, min: 1 },
  createdBy: { type: String },
  updatedBy: { type: String },
  deletedAt: { type: Date },
});

schema.index({ scope: 1, scopeId: 1, status: 1, effectiveFrom: 1, effectiveUntil: 1 });
schema.index({ status: 1, scope: 1, effectiveFrom: 1 });

export const DeliveryPricingRule = createModel<DeliveryPricingRule>('DeliveryPricingRule', schema);
