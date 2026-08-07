import { Request, Response } from 'express';
import { AppDataSource } from '@config/data-source';
import { DeviceToken } from '@models/notifications/device-token.model';
import { Notification } from '@models/notifications/notification.model';
import { NotificationService } from '@services/notification.service';
import { sendSuccess } from '@utils/http';

/** Notifications addressed to the authenticated staff account only. */
export class AdminNotificationsController {
  private readonly notifications = new NotificationService(
    AppDataSource.getRepository(DeviceToken),
    AppDataSource.getRepository(Notification),
  );

  list = async (req: Request, res: Response) => {
    sendSuccess(res, await this.notifications.list({ userId: req.user!.sub }, {
      limit: Number(req.query.limit || 30),
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
    }));
  };
}
