import { AccountType } from '@lib/constants';
import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface AccountSession extends BaseEntity {
  accountId: string;
  accountType: AccountType;
  familyId: string;
  refreshTokenHash: string;
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  ipAddress?: string;
  userAgent?: string;
  expiresAt: Date;
  lastUsedAt: Date;
  revokedAt?: Date;
  revokedBy?: string;
  revocationReason?: string;
}

const schema = createSchema<AccountSession>({
  accountId: { type: String, required: true, index: true },
  accountType: { type: String, enum: Object.values(AccountType), required: true, index: true },
  familyId: { type: String, required: true, index: true },
  refreshTokenHash: { type: String, required: true, unique: true, index: true },
  deviceId: { type: String, index: true },
  deviceName: { type: String },
  platform: { type: String },
  ipAddress: { type: String },
  userAgent: { type: String },
  expiresAt: { type: Date, required: true },
  lastUsedAt: { type: Date, required: true },
  revokedAt: { type: Date, index: true },
  revokedBy: { type: String },
  revocationReason: { type: String },
});

schema.index({ accountId: 1, revokedAt: 1, expiresAt: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AccountSession = createModel<AccountSession>('AccountSession', schema);

export interface GuestSession extends BaseEntity {
  publicId: string;
  tokenHash: string;
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  ipAddress?: string;
  userAgent?: string;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt?: Date;
  convertedAccountId?: string;
}

const guestSchema = createSchema<GuestSession>({
  publicId: { type: String, required: true, unique: true, index: true },
  tokenHash: { type: String, required: true, unique: true, index: true },
  deviceId: { type: String, index: true },
  deviceName: { type: String },
  platform: { type: String },
  ipAddress: { type: String },
  userAgent: { type: String },
  expiresAt: { type: Date, required: true },
  lastSeenAt: { type: Date, required: true },
  revokedAt: { type: Date, index: true },
  convertedAccountId: { type: String, index: true },
});

guestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const GuestSession = createModel<GuestSession>('GuestSession', guestSchema);
