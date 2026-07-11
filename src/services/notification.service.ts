import type { MongoRepository as Repository } from '@lib/mongo-repository';
import { DeviceToken } from '@models/notifications/device-token.model';
import { Notification } from '@models/notifications/notification.model';
import { HttpError } from '@utils/http';

type NotificationOwner = { userId?: string; guestId?: string };

export class NotificationService {
  constructor(
    private readonly devices: Repository<DeviceToken>,
    private readonly notifications: Repository<Notification>,
  ) {}

  async registerDevice(owner: NotificationOwner, body: Partial<DeviceToken>) {
    if (!owner.userId && !owner.guestId) throw new HttpError(400, 'A user or guest session is required');
    if (!body.expoPushToken?.startsWith('ExponentPushToken[') && !body.expoPushToken?.startsWith('ExpoPushToken[')) {
      throw new HttpError(400, 'Invalid Expo push token');
    }

    const existing = await this.devices.findOne({ where: { expoPushToken: body.expoPushToken } });
    const payload = {
      userId: owner.userId,
      guestId: owner.guestId,
      expoPushToken: body.expoPushToken,
      platform: body.platform || 'unknown',
      deviceName: body.deviceName,
      isActive: true,
      lastSeenAt: new Date(),
    };

    if (existing) {
      await this.devices.update(existing.id, payload);
      return this.devices.findOne({ where: { id: existing.id } });
    }

    return this.devices.save(this.devices.create(payload));
  }

  async unregisterDevice(owner: NotificationOwner, expoPushToken?: string) {
    if (expoPushToken) {
      const existing = await this.devices.findOne({ where: { expoPushToken } });
      if (existing) await this.devices.update(existing.id, { isActive: false });
      return { message: 'Device unregistered.' };
    }

    const tokens = await this.findOwnerDevices(owner);
    await Promise.all(tokens.map((token) => this.devices.update(token.id, { isActive: false })));
    return { message: 'Devices unregistered.' };
  }

  async create(owner: NotificationOwner, title: string, body: string, type = 'general', data?: Record<string, unknown>) {
    if (!owner.userId && !owner.guestId) return undefined;
    return this.notifications.save(this.notifications.create({
      ...owner,
      title,
      body,
      type,
      data,
      isRead: false,
    }));
  }

  async list(owner: NotificationOwner) {
    const where = this.ownerWhere(owner);
    const data = await this.notifications.find({ where, order: { createdAt: 'DESC' } });
    const unread = data.filter((item) => !item.isRead).length;
    return { data, unread, total: data.length };
  }

  async markRead(owner: NotificationOwner, id: string) {
    const notification = await this.notifications.findOne({ where: { id, ...this.ownerWhere(owner) } });
    if (!notification) throw new HttpError(404, 'Notification not found');
    await this.notifications.update(notification.id, { isRead: true, readAt: new Date() });
    return this.notifications.findOne({ where: { id: notification.id } });
  }

  async delete(owner: NotificationOwner, id: string) {
    const notification = await this.notifications.findOne({ where: { id, ...this.ownerWhere(owner) } });
    if (!notification) throw new HttpError(404, 'Notification not found');
    await this.notifications.delete({ id: notification.id });
    return { message: 'Notification deleted.' };
  }

  async sendWelcome(owner: NotificationOwner, name?: string) {
    const title = 'Welcome to Hook';
    const body = `Welcome${name ? `, ${name}` : ''}. Your marketplace is ready.`;
    await this.create(owner, title, body, 'welcome');
    await this.sendPushToOwner(owner, title, body, { type: 'welcome' });
  }

  async sendPushToOwner(owner: NotificationOwner, title: string, body: string, data?: Record<string, unknown>) {
    const devices = await this.findOwnerDevices(owner);
    await Promise.all(devices.map((device) => this.sendExpoPush(device.expoPushToken, title, body, data)));
  }

  private ownerWhere(owner: NotificationOwner) {
    if (owner.userId) return { userId: owner.userId };
    if (owner.guestId) return { guestId: owner.guestId };
    throw new HttpError(401, 'Authentication or guest session required');
  }

  private findOwnerDevices(owner: NotificationOwner) {
    if (owner.userId) return this.devices.find({ where: { userId: owner.userId, isActive: true } });
    if (owner.guestId) return this.devices.find({ where: { guestId: owner.guestId, isActive: true } });
    return Promise.resolve([]);
  }

  private async sendExpoPush(expoPushToken: string, title: string, body: string, data?: Record<string, unknown>) {
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: expoPushToken,
          sound: 'default',
          title,
          body,
          data,
        }),
      });
      if (!response.ok) console.warn(`[push] Expo responded ${response.status}`);
    } catch (error) {
      console.warn('[push] Failed to send Expo notification', error);
    }
  }
}
