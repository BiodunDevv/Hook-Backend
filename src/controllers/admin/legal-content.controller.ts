import { Request, Response } from 'express';
import { LegalContent } from '@models/platform/legal-content.model';
import { recordAudit } from '@services/platform-audit.service';
import { routeParam } from '@lib/api-utils';
import { HttpError, sendSuccess } from '@utils/http';

const DEFAULT_TITLES: Record<string, string> = {
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
};

function assertType(type: string): asserts type is 'terms' | 'privacy' {
  if (type !== 'terms' && type !== 'privacy') {
    throw new HttpError(404, 'Unknown legal document type', undefined, 'NOT_FOUND');
  }
}

export class AdminLegalContentController {
  get = async (req: Request, res: Response) => {
    const type = routeParam(req.params.type);
    assertType(type);
    const doc = await LegalContent.findOne({ type }).lean();
    sendSuccess(res, {
      type,
      title: doc?.title || DEFAULT_TITLES[type],
      bodyHtml: doc?.bodyHtml || '',
      version: doc?.version || 0,
      effectiveDate: doc?.effectiveDate || null,
      updatedAt: doc?.updatedAt || null,
    });
  };

  update = async (req: Request, res: Response) => {
    const type = routeParam(req.params.type);
    assertType(type);
    const existing = await LegalContent.findOne({ type }).lean();
    const updated = await LegalContent.findOneAndUpdate(
      { type },
      {
        $set: {
          title: req.body.title || DEFAULT_TITLES[type],
          bodyHtml: req.body.bodyHtml,
          effectiveDate: req.body.effectiveDate ? new Date(req.body.effectiveDate) : new Date(),
          version: (existing?.version || 0) + 1,
          updatedBy: req.user!.sub,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    ).lean();
    await recordAudit(req, {
      action: 'legal_content.update',
      entityType: 'legal_content',
      entityId: type,
      before: existing || undefined,
      after: updated || undefined,
      reason: req.body.reason,
    });
    sendSuccess(res, {
      type,
      title: updated?.title,
      bodyHtml: updated?.bodyHtml,
      version: updated?.version,
      effectiveDate: updated?.effectiveDate,
      updatedAt: updated?.updatedAt,
    });
  };
}
