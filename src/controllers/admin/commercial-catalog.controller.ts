import { Request, Response } from 'express';
import { ScopeType } from '@lib/constants';
import { routeParam } from '@lib/api-utils';
import { CommercialCatalogService, publicProductRepresentation } from '@services/commercial-catalog.service';
import { Product } from '@models/products/product.model';
import { recordAudit } from '@services/platform-audit.service';
import { sendSuccess } from '@utils/http';
import { presentCommercialList, presentCommercialSummary } from '@services/catalog-presentation.service';
import { adminCatalogCache } from '@lib/ttl-cache';

function stateScope(req: Request) {
  if (req.platformContext?.stateId) return [req.platformContext.stateId];
  return req.user?.scopeType === ScopeType.GLOBAL ? undefined : req.user?.assignedStateIds;
}

export class AdminCommercialCatalogController {
  private readonly catalog = new CommercialCatalogService();

  dashboard = async (req: Request, res: Response) => {
    const scope = stateScope(req);
    const cacheKey = `commercial:${scope?.join(',') || 'global'}`;
    const cached = adminCatalogCache.get(cacheKey);
    if (cached) {
      sendSuccess(res, cached);
      return;
    }
    const response = await this.catalog.dashboard(scope);
    adminCatalogCache.set(cacheKey, response);
    sendSuccess(res, response);
  };
  list = async (req: Request, res: Response) => {
    const result = await this.catalog.list(req.query, stateScope(req));
    sendSuccess(res, { ...result, data: result.data.map(presentCommercialList) });
  };
  detail = async (req: Request, res: Response) => sendSuccess(
    res,
    presentCommercialSummary(await this.catalog.detail(routeParam(req.params.id), stateScope(req))),
  );

  preview = async (req: Request, res: Response) => {
    const detail = await this.catalog.detail(routeParam(req.params.id), stateScope(req));
    const product = await Product.findById(detail._id).lean({ virtuals: true });
    sendSuccess(res, await publicProductRepresentation(product));
  };

  update = async (req: Request, res: Response) => {
    const before = await this.catalog.detail(routeParam(req.params.id), stateScope(req));
    const updated = await this.catalog.update(routeParam(req.params.id), req.body, req.user!.sub, stateScope(req));
    await this.audit(req, 'catalog.product.updated', before, updated);
    sendSuccess(res, presentCommercialSummary(updated));
  };

  pricing = async (req: Request, res: Response) => {
    const before = await this.catalog.detail(routeParam(req.params.id), stateScope(req));
    const updated = await this.catalog.pricing(routeParam(req.params.id), req.body, req.user!.sub, stateScope(req));
    await this.audit(req, 'catalog.product.pricing_updated', before.pricing, updated.pricing, req.body.reason, updated);
    sendSuccess(res, presentCommercialSummary(updated));
  };

  rules = async (req: Request, res: Response) => {
    const before = await this.catalog.detail(routeParam(req.params.id), stateScope(req));
    const updated = await this.catalog.rules(routeParam(req.params.id), req.body, req.user!.sub, stateScope(req));
    await this.audit(req, 'catalog.product.negotiation_rules_updated', before.negotiationRules, updated.negotiationRules, req.body.reason, updated);
    sendSuccess(res, presentCommercialSummary(updated));
  };

  publish = async (req: Request, res: Response) => this.lifecycle(req, res, 'publish');
  pause = async (req: Request, res: Response) => this.lifecycle(req, res, 'pause');
  unpublish = async (req: Request, res: Response) => this.lifecycle(req, res, 'unpublish');
  availabilityUnconfirmed = async (req: Request, res: Response) => this.lifecycle(req, res, 'availability_unconfirmed');

  private lifecycle = async (
    req: Request,
    res: Response,
    action: 'publish' | 'pause' | 'unpublish' | 'availability_unconfirmed',
  ) => {
    const before = await this.catalog.detail(routeParam(req.params.id), stateScope(req));
    const updated = await this.catalog.lifecycle(routeParam(req.params.id), action, req.body, req.user!.sub, stateScope(req));
    await this.audit(req, `catalog.product.${action}`, { status: before.status }, { status: updated.status }, req.body.reason, updated);
    sendSuccess(res, presentCommercialSummary(updated));
  };

  private audit = async (
    req: Request,
    action: string,
    before: unknown,
    after: unknown,
    reason?: string,
    product?: any,
  ) => recordAudit(req, {
    action,
    entityType: 'product',
    entityId: product?._id || (after as any)?._id,
    entityPublicId: product?.publicId || (after as any)?.publicId,
    stateId: product?.sourceStateId || (after as any)?.sourceStateId,
    before,
    after,
    reason,
  });
}
