import { Request, Response } from 'express';
import { ProductStatus } from '@lib/constants';
import { normalizeStateCode, resolveActiveOperationalState } from '@services/operational-state.service';
import { HttpError, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';
import { Product } from '@models/products/product.model';

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

    const agentIds = (agents as any[]).map((agent) => agent.id);
    const statsRows = agentIds.length ? await Product.aggregate([
      { $match: { fieldAgentId: { $in: agentIds } } },
      { $group: {
        _id: '$fieldAgentId',
        productsUploaded: { $sum: 1 },
        pendingApproval: { $sum: { $cond: [{ $eq: ['$status', ProductStatus.PENDING_APPROVAL] }, 1, 0] } },
        approvedToday: { $sum: { $cond: [{ $and: [{ $eq: ['$status', ProductStatus.APPROVED] }, { $gte: ['$updatedAt', startOfToday()] }] }, 1, 0] } },
      } },
    ]) : [];
    const statsMap = new Map((statsRows as any[]).map((row) => [String(row._id), row]));
    const data = (agents as any[]).map((agent) => {
      const stats = statsMap.get(String(agent.id));
      return {
        ...agent,
        stats: {
          productsUploaded: Number(stats?.productsUploaded || 0),
          pendingApproval: Number(stats?.pendingApproval || 0),
          approvedToday: Number(stats?.approvedToday || 0),
        },
      };
    });

    sendSuccess(res, paginated(data, total, page, limit));
  };

  stats = async (_req: Request, res: Response) => {
    const [productStats, activeAgents] = await Promise.all([
      Product.aggregate([{ $facet: {
        pendingReview: [{ $match: { status: ProductStatus.PENDING_APPROVAL } }, { $count: 'count' }],
        approvedToday: [{ $match: { $or: [{ source: 'field_agent' }, { fieldAgentId: { $exists: true } }], status: ProductStatus.APPROVED, updatedAt: { $gte: startOfToday() } } }, { $count: 'count' }],
        rejected: [{ $match: { status: ProductStatus.REJECTED } }, { $count: 'count' }],
      } }]),
      adminRepos.fieldAgents().count({ where: { isActive: true } }),
    ]);
    const summary = (productStats as any[])[0] || {};
    sendSuccess(res, {
      pendingReview: Number(summary.pendingReview?.[0]?.count || 0),
      approvedToday: Number(summary.approvedToday?.[0]?.count || 0),
      rejected: Number(summary.rejected?.[0]?.count || 0),
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
        take: 200,
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

    const [products, productCount] = await Promise.all([
      adminRepos.products().find({
      where: { fieldAgentId: agent.id },
      order: { createdAt: 'DESC' },
        take: 10,
      }),
      adminRepos.products().count({ where: { fieldAgentId: agent.id } }),
    ]);
    const mine = products as any[];

    sendSuccess(res, {
      ...agent,
      stats: {
        productsUploaded: productCount,
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
