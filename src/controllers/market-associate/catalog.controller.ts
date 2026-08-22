import { Request, Response } from 'express';
import { RunnerCatalogService } from '@services/catalog.service';
import { recordAudit } from '@services/platform-audit.service';
import { routeParam } from '@lib/api-utils';
import { sendCreated, sendSuccess } from '@utils/http';
import { presentSubmission } from '@services/catalog-presentation.service';

export class RunnerCatalogController {
  private readonly catalog = new RunnerCatalogService();

  dashboard = async (req: Request, res: Response) => {
    sendSuccess(res, await this.catalog.dashboard(req.user!.sub));
  };

  list = async (req: Request, res: Response) => {
    const result = await this.catalog.list(req.user!.sub, req.query);
    sendSuccess(res, { ...result, data: await Promise.all(result.data.map(presentSubmission)) });
  };

  detail = async (req: Request, res: Response) => {
    sendSuccess(res, await presentSubmission(await this.catalog.detail(req.user!.sub, routeParam(req.params.id))));
  };

  create = async (req: Request, res: Response) => {
    const created = await this.catalog.create(req.user!.sub, req.body);
    await recordAudit(req, {
      action: 'catalog.submission.created',
      entityType: 'product_submission',
      entityId: created.id,
      entityPublicId: created.publicId,
      stateId: created.sourceStateId,
      after: created,
    });
    sendCreated(res, await presentSubmission(created));
  };

  update = async (req: Request, res: Response) => {
    const before = await this.catalog.detail(req.user!.sub, routeParam(req.params.id));
    const updated = await this.catalog.update(req.user!.sub, routeParam(req.params.id), req.body);
    await recordAudit(req, {
      action: 'catalog.submission.updated',
      entityType: 'product_submission',
      entityId: updated.id,
      entityPublicId: updated.publicId,
      stateId: updated.sourceStateId,
      before,
      after: updated,
    });
    sendSuccess(res, await presentSubmission(updated));
  };

  submit = async (req: Request, res: Response) => {
    const updated = await this.catalog.submit(req.user!.sub, routeParam(req.params.id), req.body.version);
    await recordAudit(req, {
      action: 'catalog.submission.submitted',
      entityType: 'product_submission',
      entityId: updated.id,
      entityPublicId: updated.publicId,
      stateId: updated.sourceStateId,
      after: { status: updated.status, submittedAt: updated.submittedAt },
    });
    sendSuccess(res, await presentSubmission(updated));
  };
}
