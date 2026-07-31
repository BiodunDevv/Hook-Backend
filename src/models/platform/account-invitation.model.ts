import { AccountType } from '@lib/constants';
import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface AccountInvitation extends BaseEntity {
  accountId: string;
  accountType: AccountType;
  email: string;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt?: Date;
  revokedAt?: Date;
  invitedBy: string;
}

const schema = createSchema<AccountInvitation>({
  accountId: { type: String, required: true, index: true },
  accountType: { type: String, enum: Object.values(AccountType), required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  tokenHash: { type: String, required: true, unique: true, index: true },
  expiresAt: { type: Date, required: true },
  acceptedAt: { type: Date, index: true },
  revokedAt: { type: Date, index: true },
  invitedBy: { type: String, required: true, index: true },
});

schema.index({ accountId: 1, acceptedAt: 1, revokedAt: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AccountInvitation = createModel<AccountInvitation>('AccountInvitation', schema);
