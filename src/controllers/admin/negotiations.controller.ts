import { Request, Response } from 'express';
import { sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';

export class AdminNegotiationsController {
  list = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const [data, total] = await adminRepos.negotiations().findAndCount({
      relations: { user: true, product: true },
      order: { updatedAt: 'DESC' },
      skip,
      take: limit,
    });
    const accepted = await adminRepos.negotiations().count({ where: { status: 'accepted' as any } });
    sendSuccess(res, { ...paginated(data, total, page, limit), accepted, conversionRate: total ? Math.round((accepted / total) * 10000) / 100 : 0 });
  };

  detail = async (req: Request, res: Response) => {
    sendSuccess(res, await adminRepos.negotiations().findOne({
      where: { id: routeParam(req.params.id) },
      relations: { user: true, product: true },
    }));
  };
}
