import { Request, Response } from 'express';
import { NegotiationService } from '@services/negotiation.service';
import { routeParam } from '@lib/api-utils';
import { sendCreated, sendSuccess } from '@utils/http';
import { recordAudit } from '@services/platform-audit.service';

function identity(req: Request) {
  return { customerId: req.user!.sub };
}

export class NegotiationController {
  private readonly negotiations = new NegotiationService();

  create = async (req: Request, res: Response) => {
    const created = await this.negotiations.start(identity(req), req.body);
    await recordAudit(req, {
      action: 'negotiation.started',
      entityType: 'negotiation',
      entityPublicId: created.negotiationId,
      after: { status: created.status, productId: req.body.productId, variantId: req.body.variantId, quantity: req.body.quantity },
    });
    sendCreated(res, created);
  };

  offer = async (req: Request, res: Response) => {
    const result = await this.negotiations.offer(
      identity(req),
      routeParam(req.params.id),
      req.body.offeredPriceMinor,
      req.header('idempotency-key') || '',
      req.body.message,
    );
    const auditResult = result as Record<string, unknown>;
    await recordAudit(req, {
      action: auditResult.providerFallback ? 'negotiation.azure_fallback' : 'negotiation.offer_processed',
      entityType: 'negotiation',
      entityPublicId: routeParam(req.params.id),
      after: {
        decision: auditResult.decision,
        status: auditResult.status,
        quoteId: auditResult.quoteId,
        providerFallback: auditResult.providerFallback,
      },
    });
    sendSuccess(res, result);
  };

  detail = async (req: Request, res: Response) => {
    sendSuccess(res, await this.negotiations.detail(identity(req), routeParam(req.params.id)));
  };

  list = async (req: Request, res: Response) => {
    sendSuccess(res, await this.negotiations.list(identity(req)));
  };

  active = async (req: Request, res: Response) => {
    sendSuccess(res, await this.negotiations.active(identity(req), {
      productId: String(req.query.productId || ''),
      variantId: String(req.query.variantId || ''),
      quantity: Math.max(1, Number(req.query.quantity) || 1),
    }));
  };

  accept = async (req: Request, res: Response) => {
    const result = await this.negotiations.accept(identity(req), routeParam(req.params.id));
    await recordAudit(req, {
      action: 'negotiation.quote_created',
      entityType: 'negotiation',
      entityPublicId: routeParam(req.params.id),
      after: { status: result.status, quoteId: result.quoteId, expiresAt: result.expiresAt },
    });
    sendSuccess(res, result);
  };

  close = async (req: Request, res: Response) => {
    sendSuccess(res, await this.negotiations.close(identity(req), routeParam(req.params.id)));
  };
}
