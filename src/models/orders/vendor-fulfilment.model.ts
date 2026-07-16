import { VendorFulfilmentStatus } from '@lib/constants';
import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface VendorFulfilment extends BaseEntity {
  orderId: string;
  vendorId: string;
  orderItemIds: string[];
  status: VendorFulfilmentStatus;
  itemTotal: number;
  commissionAmount: number;
  refundAmount: number;
  confirmationDeadline: Date;
  confirmedAt?: Date;
  rejectedAt?: Date;
  rejectionReason?: string;
  decidedBy?: string;
  idempotencyKeys: string[];
}

const schema = createSchema<VendorFulfilment>({
  orderId: { type: String, required: true, index: true },
  vendorId: { type: String, required: true, index: true },
  orderItemIds: [{ type: String, required: true }],
  status: { type: String, enum: Object.values(VendorFulfilmentStatus), default: VendorFulfilmentStatus.AWAITING_CONFIRMATION, index: true },
  itemTotal: { type: Number, required: true },
  commissionAmount: { type: Number, required: true },
  refundAmount: { type: Number, default: 0 },
  confirmationDeadline: { type: Date, required: true, index: true },
  confirmedAt: { type: Date },
  rejectedAt: { type: Date },
  rejectionReason: { type: String },
  decidedBy: { type: String },
  idempotencyKeys: [{ type: String }],
  deletedAt: { type: Date },
});
schema.index({ orderId: 1, vendorId: 1 }, { unique: true });
schema.index({ status: 1, confirmationDeadline: 1 });
export const VendorFulfilment = createModel<VendorFulfilment>('VendorFulfilment', schema);
