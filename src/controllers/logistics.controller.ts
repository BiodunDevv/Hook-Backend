import { Request, Response } from 'express';
import { AppDataSource } from '@config/data-source';
import { LogisticsStatus } from '@lib/constants';
import { routeParam } from '@lib/api-utils';
import { FieldAgent } from '@models/field-agents/field-agent.model';
import { Logistics } from '@models/logistics/logistics.model';
import { User } from '@models/users/user.model';
import { LogisticsService } from '@services/logistics.service';
import { sendSuccess } from '@utils/http';

export class LogisticsController {
  private readonly logistics = new LogisticsService(
    AppDataSource.getRepository(User),
    AppDataSource.getRepository(Logistics),
    AppDataSource.getRepository(FieldAgent),
  );

  assignDriver = async (req: Request, res: Response) => {
    sendSuccess(res, await this.logistics.assignDriver(req.body.orderId, req.body.driverId));
  };

  jobs = async (req: Request, res: Response) => {
    sendSuccess(res, await this.logistics.jobs(req.user!.sub));
  };

  updateJob = async (req: Request, res: Response) => {
    sendSuccess(res, await this.logistics.updateDriverJob(
      req.user!.sub,
      routeParam(req.params.id),
      req.body.status as LogisticsStatus,
      req.body,
    ));
  };

  verifyOtp = async (req: Request, res: Response) => {
    sendSuccess(res, await this.logistics.verifyOtp(req.user!.sub, routeParam(req.params.id), req.body.otp));
  };

  fieldProfile = async (req: Request, res: Response) => {
    sendSuccess(res, await this.logistics.fieldProfile(req.user!.sub));
  };
}
