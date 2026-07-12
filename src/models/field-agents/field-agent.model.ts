import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface FieldAgent extends BaseEntity {
  agentId: string;
  assignedMarket: string;
  stateCode?: string;
  stateName?: string;
  coverageArea?: { lat: number; lng: number; radiusKm: number };
  isActive: boolean;
  stats?: { productsUploaded: number; pendingApproval: number; approvedToday: number };
  agent?: any;
  booths?: any[];
}

const FieldAgentSchema = createSchema<FieldAgent>({
  agentId: { type: String, required: true, index: true },
  assignedMarket: { type: String, required: true },
  stateCode: { type: String, uppercase: true, trim: true, index: true },
  stateName: { type: String, trim: true },
  coverageArea: { type: Object },
  isActive: { type: Boolean, default: true, index: true },
  stats: { type: Object },
  deletedAt: { type: Date },
});

FieldAgentSchema.index({ stateCode: 1, isActive: 1 });

export const FieldAgent = createModel<FieldAgent>('FieldAgent', FieldAgentSchema);
