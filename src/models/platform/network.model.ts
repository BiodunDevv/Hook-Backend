import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface Market extends BaseEntity {
  publicId: string;
  name: string;
  normalizedName: string;
  stateId: string;
  cityId: string;
  zoneId?: string;
  hubId?: string;
  address: string;
  coordinates?: { lat: number; lng: number };
  operatingHours?: Record<string, unknown>;
  notes?: string;
  status: 'active' | 'inactive';
}

export interface DispatchHub extends BaseEntity {
  publicId: string;
  name: string;
  stateId: string;
  cityId: string;
  zoneIds: string[];
  address: string;
  coordinates?: { lat: number; lng: number };
  capacity?: Record<string, unknown>;
  operatingHours?: Record<string, unknown>;
  cutoffRules?: Record<string, unknown>;
  contact?: Record<string, unknown>;
  marketIds: string[];
  staffIds: string[];
  status: 'active' | 'inactive';
}

const marketSchema = createSchema<Market>({
  publicId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  normalizedName: { type: String, required: true, trim: true, lowercase: true },
  stateId: { type: String, required: true, index: true },
  cityId: { type: String, required: true, index: true },
  zoneId: { type: String, index: true },
  hubId: { type: String, index: true },
  address: { type: String, required: true, trim: true },
  coordinates: { type: Object },
  operatingHours: { type: Object },
  notes: { type: String },
  status: { type: String, enum: ['active', 'inactive'], default: 'inactive', index: true },
});
marketSchema.index({ stateId: 1, normalizedName: 1 }, { unique: true });

const hubSchema = createSchema<DispatchHub>({
  publicId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  stateId: { type: String, required: true, index: true },
  cityId: { type: String, required: true, index: true },
  zoneIds: { type: [String], default: [], index: true },
  address: { type: String, required: true, trim: true },
  coordinates: { type: Object },
  capacity: { type: Object },
  operatingHours: { type: Object },
  cutoffRules: { type: Object },
  contact: { type: Object },
  marketIds: { type: [String], default: [], index: true },
  staffIds: { type: [String], default: [], index: true },
  status: { type: String, enum: ['active', 'inactive'], default: 'inactive', index: true },
});
hubSchema.index({ stateId: 1, name: 1 }, { unique: true });

export const Market = createModel<Market>('Market', marketSchema);
export const DispatchHub = createModel<DispatchHub>('DispatchHub', hubSchema);
