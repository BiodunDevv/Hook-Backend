import { Request, Response } from 'express';
import { NegotiationStatus } from '@lib/constants';
import { Negotiation } from '@models/negotiations/negotiation.model';
import { Product } from '@models/products/product.model';
import { HttpError, sendSuccess } from '@utils/http';
import { routeParam } from './admin.helpers';

function identifier(value: string) {
  return /^[a-f\d]{24}$/i.test(value)
    ? { $or: [{ _id: value }, { publicId: value }] }
    : { publicId: value };
}

function safeSession(session: any, product?: any) {
  return {
    id: session.publicId,
    status: session.status,
    channel: session.channel,
    product: product ? {
      id: product.publicId,
      name: product.name,
      images: product.images || [],
    } : null,
    quantity: session.quantity,
    currency: session.currency,
    offerCount: session.offerCount,
    maximumOffers: session.maximumOffers,
    lastDecision: session.lastDecision || null,
    agreedPriceMinor: session.agreedPriceMinor || null,
    transcript: session.transcript || [],
    providerTelemetry: (session.providerTelemetry || []).map((entry: any) => ({
      provider: entry.provider,
      failed: Boolean(entry.failed),
      failureCode: entry.failureCode || null,
    })),
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export class AdminNegotiationsController {
  list = async (req: Request, res: Response) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const filter: Record<string, unknown> = {};
    if (req.query.status && Object.values(NegotiationStatus).includes(req.query.status as NegotiationStatus)) {
      filter.status = req.query.status;
    }
    if (req.platformContext?.stateId) filter.sourceStateId = req.platformContext.stateId;
    const sessions = await Negotiation.find(filter).sort({ createdAt: -1 }).limit(limit + 1).lean({ virtuals: true });
    const page = sessions.slice(0, limit);
    const products = await Product.find({ _id: { $in: page.map((item) => item.productId) } }).lean({ virtuals: true });
    const productById = new Map(products.map((product) => [product._id.toString(), product]));
    const total = await Negotiation.countDocuments(filter);
    const accepted = await Negotiation.countDocuments({
      ...filter,
      status: { $in: [NegotiationStatus.AGREED, NegotiationStatus.ACCEPTED] },
    });
    sendSuccess(res, {
      data: page.map((session) => safeSession(session, productById.get(session.productId))),
      total,
      hasMore: sessions.length > limit,
      accepted,
      conversionRate: total ? Math.round((accepted / total) * 10_000) / 100 : 0,
    });
  };

  detail = async (req: Request, res: Response) => {
    const filter: Record<string, unknown> = identifier(routeParam(req.params.id));
    if (req.platformContext?.stateId) filter.sourceStateId = req.platformContext.stateId;
    const session = await Negotiation.findOne(filter).lean({ virtuals: true });
    if (!session) throw new HttpError(404, 'Negotiation not found', undefined, 'NOT_FOUND');
    const product = await Product.findById(session.productId).lean({ virtuals: true });
    sendSuccess(res, safeSession(session, product));
  };
}
