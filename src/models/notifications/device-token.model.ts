import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface DeviceToken extends BaseEntity {
  userId: string;
  expoPushToken: string;
  platform?: 'ios' | 'android' | 'web' | 'unknown';
  deviceName?: string;
  deviceId?: string;
  sessionId?: string;
  isActive: boolean;
  lastSeenAt: Date;
  welcomeSentAt?: Date;
}

const DeviceTokenSchema = createSchema<DeviceToken>({
  userId: { type: String, required: true, index: true },
  expoPushToken: { type: String, required: true, unique: true, index: true },
  platform: { type: String, default: 'unknown' },
  deviceName: { type: String },
  deviceId: { type: String, index: true },
  sessionId: { type: String, index: true },
  isActive: { type: Boolean, default: true, index: true },
  lastSeenAt: { type: Date, default: Date.now },
  welcomeSentAt: { type: Date },
  deletedAt: { type: Date },
});

DeviceTokenSchema.index({ userId: 1, isActive: 1 });
DeviceTokenSchema.index({ userId: 1, deviceId: 1 });

export const DeviceToken = createModel<DeviceToken>('DeviceToken', DeviceTokenSchema);
