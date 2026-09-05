import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface Notification extends BaseEntity {
  userId: string;
  title: string;
  body: string;
  type: string;
  data?: Record<string, unknown>;
  isRead: boolean;
  readAt?: Date;
  eventKey?: string;
}

const NotificationSchema = createSchema<Notification>({
  userId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  type: { type: String, default: 'general', index: true },
  data: { type: Object },
  isRead: { type: Boolean, default: false, index: true },
  readAt: { type: Date },
  eventKey: { type: String, unique: true, sparse: true, index: true },
  deletedAt: { type: Date },
});

NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

export const Notification = createModel<Notification>('Notification', NotificationSchema);
