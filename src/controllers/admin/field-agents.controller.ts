import { Request, Response } from 'express';
import { ProductStatus } from '@lib/constants';
import { normalizeStateCode, resolveActiveOperationalState } from '@services/operational-state.service';
import { HttpError, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';

// Titles hinting at counterfeit goods get flagged for manual review
const COUNTERFEIT_PATTERN = /replica|first copy|copy|fake|counterfeit|knock[\s-]?off/i;

function runnerDisplayName(agent: any): string {
  const user = agent?.agent;
  return `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.email || 'Runner';
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export class AdminFieldAgentsController {
  list = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const stateCode = normalizeStateCode(req.query.stateCode);
    const where: Record<string, unknown> = {};
    if (stateCode) where.stateCode = stateCode;
    const [agents, total] = await adminRepos.fieldAgents().findAndCount({
      where,
      relations: { agent: true },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    // Live stats per agent from actual product attribution — no stale stored counters
    const products = await adminRepos.products().find({});
    const data = (agents as any[]).map((agent) => {
      const mine = (products as any[]).filter((p) => p.fieldAgentId === agent.id);
      return {
        ...agent,
        stats: {
          productsUploaded: mine.length,
          pendingApproval: mine.filter((p) => p.status === ProductStatus.PENDING_APPROVAL).length,
          approvedToday: mine.filter((p) => p.status === ProductStatus.APPROVED && new Date(p.updatedAt) >= startOfToday()).length,
        },
      };
    });

    sendSuccess(res, paginated(data, total, page, limit));
  };

  stats = async (_req: Request, res: Response) => {
    const [products, activeAgents] = await Promise.all([
      adminRepos.products().find({}),
      adminRepos.fieldAgents().count({ where: { isActive: true } }),
    ]);

    const fieldProducts = (products as any[]).filter((p) => p.source === 'field_agent' || p.fieldAgentId);
    const today = startOfToday();

    sendSuccess(res, {
      pendingReview: (products as any[]).filter((p) => p.status === ProductStatus.PENDING_APPROVAL).length,
      approvedToday: fieldProducts.filter((p) => p.status === ProductStatus.APPROVED && new Date(p.updatedAt) >= today).length,
      rejected: (products as any[]).filter((p) => p.status === ProductStatus.REJECTED).length,
      activeAgents,
    });
  };

  queue = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const [pending, agents] = await Promise.all([
      adminRepos.products().find({
        where: { status: ProductStatus.PENDING_APPROVAL },
        relations: { vendor: true, category: true },
        order: { createdAt: 'ASC' },
      }),
      adminRepos.fieldAgents().find({ relations: { agent: true } }),
    ]);

    const agentById = new Map((agents as any[]).map((agent) => [agent.id, agent]));

    const rows = (pending as any[]).map((product) => {
      const agent = product.fieldAgentId ? agentById.get(product.fieldAgentId) : undefined;
      const flagged = COUNTERFEIT_PATTERN.test(product.title || '');
      return {
        id: product.id,
        title: product.title,
        image: Array.isArray(product.images) ? product.images[0] : null,
        category: product.category?.name || 'Uncategorized',
        costPrice: product.costPrice,
        sellingPrice: product.sellingPrice,
        quantity: product.quantity,
        sizes: product.sizes || [],
        colors: product.colors || [],
        createdAt: product.createdAt,
        market: agent?.assignedMarket || product.vendor?.businessAddress || 'Marketplace',
        agentName: agent ? runnerDisplayName(agent) : product.vendor?.businessName || 'Legacy catalog source',
        source: product.source || 'admin',
        flagged,
        flagReason: flagged
          ? 'Title implies counterfeit item. Please review before approving.'
          : null,
      };
    });

    const data = rows.slice(skip, skip + limit);
    sendSuccess(res, { ...paginated(data, rows.length, page, limit), queueSize: rows.length });
  };

  detail = async (req: Request, res: Response) => {
    const agent: any = await adminRepos.fieldAgents().findOne({
      where: { id: routeParam(req.params.id) },
      relations: { agent: true },
    });
    if (!agent) throw new HttpError(404, 'Runner not found');

    const products = await adminRepos.products().find({
      where: { fieldAgentId: agent.id },
      order: { createdAt: 'DESC' },
    });
    const mine = products as any[];

    sendSuccess(res, {
      ...agent,
      stats: {
        productsUploaded: mine.length,
        pendingApproval: mine.filter((p) => p.status === ProductStatus.PENDING_APPROVAL).length,
        approvedToday: mine.filter((p) => p.status === ProductStatus.APPROVED && new Date(p.updatedAt) >= startOfToday()).length,
      },
      recentUploads: mine.slice(0, 10).map((p) => ({
        id: p.id,
        title: p.title,
        image: Array.isArray(p.images) ? p.images[0] : null,
        status: p.status,
        sellingPrice: p.sellingPrice,
        createdAt: p.createdAt,
      })),
    });
  };

  toggle = async (req: Request, res: Response) => {
    const repo = adminRepos.fieldAgents();
    const agent = await repo.findOne({ where: { id: routeParam(req.params.id) } });
    if (!agent) throw new HttpError(404, 'Runner not found');
    agent.isActive = !agent.isActive;
    await repo.save(agent);
    sendSuccess(res, { id: agent.id, isActive: agent.isActive });
  };

  setState = async (req: Request, res: Response) => {
    const repo = adminRepos.fieldAgents();
    const agent = await repo.findOne({ where: { id: routeParam(req.params.id) } });
    if (!agent) throw new HttpError(404, 'Runner not found');
    const state = await resolveActiveOperationalState(req.body.stateCode);
    agent.stateCode = state.stateCode;
    agent.stateName = state.stateName;
    await repo.save(agent);
    sendSuccess(res, { id: agent.id, stateCode: agent.stateCode, stateName: agent.stateName });
  };
}
