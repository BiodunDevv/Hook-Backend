import { Request, Response } from 'express';
import { HttpError, sendCreated, sendSuccess } from '@utils/http';
import { auditAdminAction } from '@lib/audit';
import { Banner } from '@models/platform/banner.model';
import { publishConfigChanged } from '@services/realtime.service';

const view = (banner: any) => ({
  id: String(banner._id),
  text: banner.text,
  imageUrl: banner.imageUrl || '',
  linkType: banner.linkType || 'none',
  linkTarget: banner.linkTarget || '',
  placement: banner.placement,
  tone: banner.tone,
  isActive: banner.isActive,
  sortOrder: banner.sortOrder,
  startsAt: banner.startsAt || null,
  endsAt: banner.endsAt || null,
  updatedAt: banner.updatedAt,
});

export class AdminBannersController {
  list = async (_req: Request, res: Response) => {
    const banners = await Banner.find({ deletedAt: { $exists: false } }).sort({ sortOrder: 1, createdAt: -1 }).lean();
    sendSuccess(res, banners.map(view));
  };

  create = async (req: Request, res: Response) => {
    const banner = await Banner.create({ ...req.body, updatedBy: req.user!.sub });
    await auditAdminAction(req, 'banner.create', 'banner', String(banner._id), { text: banner.text });
    publishConfigChanged('banners');
    sendCreated(res, view(banner.toObject()));
  };

  update = async (req: Request, res: Response) => {
    const banner = await Banner.findOneAndUpdate({ _id: req.params.id, deletedAt: { $exists: false } }, { $set: { ...req.body, updatedBy: req.user!.sub } }, { returnDocument: 'after' }).lean();
    if (!banner) throw new HttpError(404, 'Banner not found');
    await auditAdminAction(req, 'banner.update', 'banner', String(banner._id), { fields: Object.keys(req.body) });
    publishConfigChanged('banners');
    sendSuccess(res, view(banner));
  };

  remove = async (req: Request, res: Response) => {
    const banner = await Banner.findOneAndUpdate({ _id: req.params.id, deletedAt: { $exists: false } }, { $set: { deletedAt: new Date() } }).lean();
    if (!banner) throw new HttpError(404, 'Banner not found');
    await auditAdminAction(req, 'banner.delete', 'banner', String(banner._id), {});
    publishConfigChanged('banners');
    sendSuccess(res, { deleted: true });
  };
}

/** Public: only banners that are on, inside their schedule, for the placement. */
export async function publicBanners(req: Request, res: Response) {
  const placement = req.query.placement === 'category' ? 'category' : 'home';
  const now = new Date();
  const banners = await Banner.find({
    isActive: true,
    deletedAt: { $exists: false },
    placement: { $in: [placement, 'all'] },
    $and: [
      { $or: [{ startsAt: { $exists: false } }, { startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: { $exists: false } }, { endsAt: null }, { endsAt: { $gt: now } }] },
    ],
  }).sort({ sortOrder: 1, createdAt: -1 }).limit(10).lean();
  sendSuccess(res, banners.map((banner: any) => ({ id: String(banner._id), text: banner.text, imageUrl: banner.imageUrl || '', tone: banner.tone, linkType: banner.linkType || 'none', linkTarget: banner.linkTarget || '' })));
}
