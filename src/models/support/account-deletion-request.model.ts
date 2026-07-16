import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface AccountDeletionRequest extends BaseEntity {
  userId: string;
  reason?: string;
  status: 'requested' | 'identity_verified' | 'cooling_off' | 'approved' | 'anonymized' | 'cancelled';
  assignedTo?: string;
  identityVerifiedAt?: Date;
  coolingOffUntil: Date;
  anonymizedAt?: Date;
}
const schema = createSchema<AccountDeletionRequest>({
  userId: { type: String, required: true, index: true },
  reason: { type: String },
  status: { type: String, enum: ['requested', 'identity_verified', 'cooling_off', 'approved', 'anonymized', 'cancelled'], default: 'requested', index: true },
  assignedTo: { type: String, index: true },
  identityVerifiedAt: { type: Date },
  coolingOffUntil: { type: Date, required: true },
  anonymizedAt: { type: Date },
  deletedAt: { type: Date },
});
schema.index({ userId: 1, status: 1 });
export const AccountDeletionRequest = createModel<AccountDeletionRequest>('AccountDeletionRequest', schema);
