import { SettlementStatus } from '@lib/constants';
import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface Settlement extends BaseEntity {
  vendorId: string;
  orderId: string;
  settlementRef?: string;
  itemTotal: number;
  commissionAmount: number;
  netAmount: number;
  deliveryFeePortion: number;
  status: SettlementStatus;
  escrowReleaseAt: Date;
  escrowReleasedAt?: Date;
  paidAt?: Date;
  gatewayTransferRef?: string;
  notes?: string;
  vendor?: any;
  order?: any;
}

const SettlementSchema = createSchema<Settlement>({
  vendorId: { type: String, required: true, index: true },
  orderId: { type: String, required: true, index: true },
  settlementRef: { type: String, unique: true, sparse: true },
  itemTotal: { type: Number, required: true },
  commissionAmount: { type: Number, required: true },
  netAmount: { type: Number, required: true },
  deliveryFeePortion: { type: Number, required: true },
  status: { type: String, enum: Object.values(SettlementStatus), default: SettlementStatus.PENDING_ESCROW, index: true },
  escrowReleaseAt: { type: Date, required: true },
  escrowReleasedAt: { type: Date },
  paidAt: { type: Date },
  gatewayTransferRef: { type: String },
  notes: { type: String },
  deletedAt: { type: Date },
});

SettlementSchema.index({ vendorId: 1, status: 1 });

export const Settlement = createModel<Settlement>('Settlement', SettlementSchema);
