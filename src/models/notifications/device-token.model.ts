import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface DeviceToken extends BaseEntity {
  userId?: string;
  guestId?: string;
  expoPushToken: string;
  platform?: 'ios' | 'android' | 'web' | 'unknown';
  deviceName?: string;
  isActive: boolean;
  lastSeenAt: Date;
}

const DeviceTokenSchema = createSchema<DeviceToken>({
  userId: { type: String, index: true },
  guestId: { type: String, index: true },
  expoPushToken: { type: String, required: true, unique: true, index: true },
  platform: { type: String, default: 'unknown' },
  deviceName: { type: String },
  isActive: { type: Boolean, default: true, index: true },
  lastSeenAt: { type: Date, default: Date.now },
  deletedAt: { type: Date },
});

DeviceTokenSchema.index({ userId: 1, isActive: 1 });
DeviceTokenSchema.index({ guestId: 1, isActive: 1 });

export const DeviceToken = createModel<DeviceToken>('DeviceToken', DeviceTokenSchema);
