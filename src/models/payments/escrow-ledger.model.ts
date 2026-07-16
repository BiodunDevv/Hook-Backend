import { EscrowEventType } from '@lib/constants';
import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface EscrowLedger extends BaseEntity {
  orderId: string;
  paymentId?: string;
  vendorId?: string;
  fulfilmentId?: string;
  type: EscrowEventType;
  amount: number;
  currency: 'NGN';
  idempotencyKey: string;
  providerReference?: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
}

const schema = createSchema<EscrowLedger>({
  orderId: { type: String, required: true, index: true },
  paymentId: { type: String, index: true },
  vendorId: { type: String, index: true },
  fulfilmentId: { type: String, index: true },
  type: { type: String, enum: Object.values(EscrowEventType), required: true, index: true },
  amount: { type: Number, required: true },
  currency: { type: String, enum: ['NGN'], default: 'NGN' },
  idempotencyKey: { type: String, required: true, unique: true },
  providerReference: { type: String },
  actorId: { type: String },
  metadata: { type: Object },
  deletedAt: { type: Date },
});
schema.index({ orderId: 1, createdAt: 1 });
export const EscrowLedger = createModel<EscrowLedger>('EscrowLedger', schema);
