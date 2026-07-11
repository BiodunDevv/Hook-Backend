import { Request, Response } from 'express';
import { AppDataSource } from '@config/data-source';
import { DeviceToken } from '@models/notifications/device-token.model';
import { Notification } from '@models/notifications/notification.model';
import { NotificationService } from '@services/notification.service';
import { sendSuccess } from '@utils/http';

function owner(req: Request) {
  return req.user?.sub ? { userId: req.user.sub } : { guestId: req.guestId };
}

export class DeviceController {
  private readonly notifications = new NotificationService(
    AppDataSource.getRepository(DeviceToken),
    AppDataSource.getRepository(Notification),
  );

  register = async (req: Request, res: Response) => {
    const notificationOwner = owner(req);
    const device = await this.notifications.registerDevice(notificationOwner, req.body);
    if (req.body.sendWelcome) {
      await this.notifications.sendPushToOwner(
        notificationOwner,
        'Welcome to Hook',
        'Your marketplace is ready.',
        { type: 'welcome' },
      );
    }
    sendSuccess(res, device);
  };

  unregister = async (req: Request, res: Response) => {
    sendSuccess(res, await this.notifications.unregisterDevice(owner(req), req.body.expoPushToken));
  };
}
