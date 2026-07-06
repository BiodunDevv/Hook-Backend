import { NegotiationStatus } from '@lib/constants';
import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface Negotiation extends BaseEntity {
  userId: string;
  productId: string;
  round: number;
  offeredPrice: number;
  counterPrice: number;
  acceptedPrice?: number;
  status: NegotiationStatus;
  costPrice: number;
  sellingPrice: number;
  minAcceptablePrice: number;
  messageHistory: Array<{ role: 'user' | 'bot'; message: string; price?: number; timestamp: string }>;
  expiredAt?: Date;
  acceptedAt?: Date;
  declineReason?: string;
  user?: any;
  product?: any;
}

const NegotiationSchema = createSchema<Negotiation>({
  userId: { type: String, required: true, index: true },
  productId: { type: String, required: true, index: true },
  round: { type: Number, default: 1 },
  offeredPrice: { type: Number, required: true },
  counterPrice: { type: Number, required: true },
  acceptedPrice: { type: Number },
  status: { type: String, enum: Object.values(NegotiationStatus), default: NegotiationStatus.ACTIVE, index: true },
  costPrice: { type: Number, required: true },
  sellingPrice: { type: Number, required: true },
  minAcceptablePrice: { type: Number, required: true },
  messageHistory: [{ type: Object }],
  expiredAt: { type: Date },
  acceptedAt: { type: Date },
  declineReason: { type: String },
  deletedAt: { type: Date },
});

NegotiationSchema.index({ userId: 1, productId: 1, status: 1 });

export const Negotiation = createModel<Negotiation>('Negotiation', NegotiationSchema);
