import { Request, Response } from 'express';
import { HttpError, sendCreated, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';

export class AdminBoothsController {
  list = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const [data, total] = await adminRepos.booths().findAndCount({ order: { createdAt: 'DESC' }, skip, take: limit });
    sendSuccess(res, paginated(data, total, page, limit));
  };

  analytics = async (_req: Request, res: Response) => {
    const repo = adminRepos.booths();
    const total = await repo.count();
    const active = await repo.count({ where: { isActive: true } });
    sendSuccess(res, { total, active, inactive: total - active, feed: [] });
  };

  detail = async (req: Request, res: Response) => {
    const booth = await adminRepos.booths().findOne({ where: { id: routeParam(req.params.id) } });
    if (!booth) throw new HttpError(404, 'Booth not found');
    sendSuccess(res, booth);
  };

  status = async (req: Request, res: Response) => {
    const repo = adminRepos.booths();
    const booth = await repo.findOne({ where: { id: routeParam(req.params.id) } });
    if (!booth) throw new HttpError(404, 'Booth not found');
    booth.isActive = req.body.isActive ?? !booth.isActive;
    await repo.save(booth);
    sendSuccess(res, { id: booth.id, isActive: booth.isActive });
  };

  create = async (req: Request, res: Response) => {
    const repo = adminRepos.booths();
    sendCreated(res, await repo.save(repo.create(req.body)));
  };
}
