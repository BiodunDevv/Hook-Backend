import { Request, Response } from 'express';
import { HttpError, sendCreated, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';

// Nested populate (fieldAgent → user) isn't supported by MongoRepository,
// so booths join their attendant agent in memory.
async function attachAgents(booths: any[]): Promise<any[]> {
  const agents = await adminRepos.fieldAgents().find({ relations: { agent: true } });
  const agentById = new Map((agents as any[]).map((agent) => [agent.id, agent]));
  return booths.map((booth) => ({
    ...booth,
    fieldAgent: booth.fieldAgentId ? agentById.get(booth.fieldAgentId) || null : null,
  }));
}

export class AdminBoothsController {
  list = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const [data, total] = await adminRepos.booths().findAndCount({
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
    sendSuccess(res, paginated(await attachAgents(data as any[]), total, page, limit));
  };

  analytics = async (_req: Request, res: Response) => {
    const booths = await adminRepos.booths().find({});
    const rows = booths as any[];
    const active = rows.filter((booth) => booth.isActive).length;
    sendSuccess(res, {
      total: rows.length,
      active,
      inactive: rows.length - active,
      withAgent: rows.filter((booth) => booth.fieldAgentId).length,
      phygital: rows.filter((booth) => booth.boothType === 'phygital').length,
      microHub: rows.filter((booth) => booth.boothType === 'micro_hub').length,
    });
  };

  detail = async (req: Request, res: Response) => {
    const booth = await adminRepos.booths().findOne({ where: { id: routeParam(req.params.id) } });
    if (!booth) throw new HttpError(404, 'Booth not found');
    const [enriched] = await attachAgents([booth]);
    sendSuccess(res, enriched);
  };

  status = async (req: Request, res: Response) => {
    const repo = adminRepos.booths();
    const booth = await repo.findOne({ where: { id: routeParam(req.params.id) } });
    if (!booth) throw new HttpError(404, 'Booth not found');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    booth.isActive = typeof body.isActive === 'boolean' ? body.isActive : !booth.isActive;
    await repo.save(booth);
    sendSuccess(res, { id: booth.id, isActive: booth.isActive });
  };

  create = async (req: Request, res: Response) => {
    const repo = adminRepos.booths();
    sendCreated(res, await repo.save(repo.create(req.body)));
  };
}
