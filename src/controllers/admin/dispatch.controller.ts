import { Request, Response } from 'express';
import { LogisticsStatus, UserRole } from '@lib/constants';
import { sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated } from './admin.helpers';

export class AdminDispatchController {
  active = async (_req: Request, res: Response) => {
    sendSuccess(res, await adminRepos.logistics().find({
      where: { status: LogisticsStatus.IN_TRANSIT },
      relations: { order: true, driver: true },
      order: { updatedAt: 'DESC' },
    }));
  };

  list = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const [data, total] = await adminRepos.logistics().findAndCount({
      relations: { order: true, driver: true },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
    sendSuccess(res, paginated(data, total, page, limit));
  };

  drivers = async (_req: Request, res: Response) => {
    sendSuccess(res, await adminRepos.users().find({ where: { role: UserRole.EV_DRIVER, isActive: true } }));
  };
}
