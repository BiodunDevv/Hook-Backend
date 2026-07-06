import { Request, Response } from 'express';
import { HttpError, sendCreated, sendSuccess } from '@utils/http';
import { getPagination, paginated, routeParam } from './admin.helpers';

const generatedReports: Array<Record<string, unknown>> = [];

export class AdminReportsController {
  list = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    sendSuccess(res, paginated(generatedReports.slice(skip, skip + limit), generatedReports.length, page, limit));
  };

  generate = async (req: Request, res: Response) => {
    const report = {
      id: `report-${Date.now()}`,
      type: req.body.type || 'sales',
      status: 'generated',
      createdAt: new Date().toISOString(),
      downloadUrl: null,
      data: {},
    };
    generatedReports.unshift(report);
    sendCreated(res, report);
  };

  detail = async (req: Request, res: Response) => {
    const report = generatedReports.find((item) => item.id === routeParam(req.params.id));
    if (!report) throw new HttpError(404, 'Report not found');
    sendSuccess(res, report);
  };
}
