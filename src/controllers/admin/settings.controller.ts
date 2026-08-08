import { Request, Response } from 'express';
import { auditAdminAction } from '@lib/audit';
import { sendSuccess } from '@utils/http';
import { CommerceSettings } from '@models/commerce/commerce.model';
import { Product } from '@models/products/product.model';
import { ProductAvailabilityStatus } from '@lib/constants';

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
    await auditAdminAction(req, 'settings.update', 'settings', 'platform', { fields: Object.keys(req.body) });
    sendSuccess(res, { ...settings, updatedAt: new Date().toISOString() });
  };

  catalogAvailability = async (_req: Request, res: Response) => {
    const [commerce, overdueCount] = await Promise.all([
      CommerceSettings.findOne({ key: 'commerce' }).select('catalogAvailabilityCheckDays defaultDeliveryFeeMinor updatedAt updatedBy').lean({ virtuals: true }),
      Product.countDocuments({ availabilityStatus: ProductAvailabilityStatus.UNCONFIRMED, availabilityCheckDueAt: { $lt: new Date() }, deletedAt: { $exists: false } }),
    ]);
    sendSuccess(res, {
      catalogAvailabilityCheckDays: commerce?.catalogAvailabilityCheckDays || 4,
      overdueCount,
      updatedAt: commerce?.updatedAt || null,
      updatedBy: commerce?.updatedBy || null,
    });
  };

  updateCatalogAvailability = async (req: Request, res: Response) => {
    const updated = await CommerceSettings.findOneAndUpdate(
      { key: 'commerce' },
      { $set: { catalogAvailabilityCheckDays: req.body.catalogAvailabilityCheckDays, updatedBy: req.user!.sub } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    ).lean({ virtuals: true });
    await auditAdminAction(req, 'settings.catalog_availability.updated', 'settings', 'commerce', { catalogAvailabilityCheckDays: req.body.catalogAvailabilityCheckDays, reason: req.body.reason });
    sendSuccess(res, { catalogAvailabilityCheckDays: updated?.catalogAvailabilityCheckDays || 4, updatedAt: updated?.updatedAt, updatedBy: updated?.updatedBy });
  };
}
