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
  /** Which group a customer can switch off (orders, account, credit, reminders, discovery). */
  group?: string;
  priority?: 'transactional' | 'engagement';
  /** When the push was handed to Expo; unset if it was not sent. */
  pushedAt?: Date;
  /** When the customer opened the notification from the phone. */
  openedAt?: Date;
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
  group: { type: String },
  priority: { type: String, enum: ['transactional', 'engagement'] },
  pushedAt: { type: Date },
  openedAt: { type: Date },
  deletedAt: { type: Date },
});

NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
// Frequency caps count recent engagement pushes per customer.
NotificationSchema.index({ userId: 1, priority: 1, pushedAt: -1 }, { sparse: true });

export const Notification = createModel<Notification>('Notification', NotificationSchema);
