import { BaseEntity, createModel, createSchema } from '@models/base.model';

export type RefundRequestStatus = 'requested' | 'under_review' | 'approved' | 'rejected' | 'provider_pending' | 'refunded';
export interface RefundRequest extends BaseEntity {
  orderId: string; paymentId?: string; requestedBy: string; reason: string;
  reasonType: 'vendor_unavailable' | 'vendor_timeout' | 'not_delivered' | 'damaged' | 'wrong_item' | 'other';
  amount: number; evidenceUrls: string[]; status: RefundRequestStatus;
  assignedSupportUserId?: string; decidedBy?: string; decisionNote?: string;
  providerReference?: string; idempotencyKey: string; auditHistory: Array<Record<string, unknown>>;
}
const schema = createSchema<RefundRequest>({
  orderId: { type: String, required: true, index: true }, paymentId: { type: String, index: true },
  requestedBy: { type: String, required: true, index: true }, reason: { type: String, required: true },
  reasonType: { type: String, required: true, enum: ['vendor_unavailable', 'vendor_timeout', 'not_delivered', 'damaged', 'wrong_item', 'other'] },
  amount: { type: Number, required: true }, evidenceUrls: [{ type: String }],
  status: { type: String, required: true, default: 'requested', index: true },
  assignedSupportUserId: { type: String }, decidedBy: { type: String }, decisionNote: { type: String },
  providerReference: { type: String }, idempotencyKey: { type: String, required: true, unique: true },
  auditHistory: [{ type: Object }], deletedAt: { type: Date },
});
schema.index({ orderId: 1, status: 1 });
export const RefundRequest = createModel<RefundRequest>('RefundRequest', schema);
