import { Request, Response } from 'express';
import { sendSuccess } from '@utils/http';

let settings: Record<string, unknown> = {
  platformName: 'Hook',
  supportEmail: process.env.BREVO_FROM_EMAIL || 'support@hook.local',
  commissionPercentage: 15,
};

export class AdminSettingsController {
  get = async (_req: Request, res: Response) => {
    sendSuccess(res, { ...settings, updatedAt: new Date().toISOString() });
  };

  update = async (req: Request, res: Response) => {
    settings = { ...settings, ...req.body };
    sendSuccess(res, { ...settings, updatedAt: new Date().toISOString() });
  };
}
