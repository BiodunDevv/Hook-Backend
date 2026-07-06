import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface FieldAgent extends BaseEntity {
  agentId: string;
  assignedMarket: string;
  coverageArea?: { lat: number; lng: number; radiusKm: number };
  isActive: boolean;
  stats?: { productsUploaded: number; pendingApproval: number; approvedToday: number };
  agent?: any;
  booths?: any[];
}

const FieldAgentSchema = createSchema<FieldAgent>({
  agentId: { type: String, required: true, index: true },
  assignedMarket: { type: String, required: true },
  coverageArea: { type: Object },
  isActive: { type: Boolean, default: true, index: true },
  stats: { type: Object },
  deletedAt: { type: Date },
});

export const FieldAgent = createModel<FieldAgent>('FieldAgent', FieldAgentSchema);
