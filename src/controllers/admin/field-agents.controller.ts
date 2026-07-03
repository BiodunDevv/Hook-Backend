import { Request, Response } from 'express';
import { HttpError, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';

export class AdminFieldAgentsController {
  list = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const [data, total] = await adminRepos.fieldAgents().findAndCount({
      relations: { agent: true },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
    sendSuccess(res, paginated(data, total, page, limit));
  };

  detail = async (req: Request, res: Response) => {
    const agent = await adminRepos.fieldAgents().findOne({ where: { id: routeParam(req.params.id) }, relations: { agent: true } });
    if (!agent) throw new HttpError(404, 'Field agent not found');
    sendSuccess(res, agent);
  };

  toggle = async (req: Request, res: Response) => {
    const repo = adminRepos.fieldAgents();
    const agent = await repo.findOne({ where: { id: routeParam(req.params.id) } });
    if (!agent) throw new HttpError(404, 'Field agent not found');
    agent.isActive = !agent.isActive;
    await repo.save(agent);
    sendSuccess(res, { id: agent.id, isActive: agent.isActive });
  };
}
