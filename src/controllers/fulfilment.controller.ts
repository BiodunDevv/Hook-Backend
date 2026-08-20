import { Request, Response } from 'express';
import { fulfilmentService } from '@services/fulfilment.service';
import { routeParam } from '@lib/api-utils';
import { sendCreated, sendSuccess } from '@utils/http';

function actor(req: Request) {
  return {
    accountId: req.user!.sub,
    publicId: req.user!.publicId,
    accountType: req.user!.accountType,
    stateIds: req.user!.assignedStateIds,
    hubIds: req.user!.assignedHubIds,
  };
}

export class FulfilmentController {
  runnerDashboard = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.runnerTasks(req.user!.sub, { limit: 100 }));
  runnerTasks = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.runnerTasks(req.user!.sub, req.query as Record<string, unknown>));
  runnerTask = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.runnerTask(req.user!.sub, routeParam(req.params.id)));
  runnerAction = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.runnerTransition(req.user!.sub, routeParam(req.params.id), routeParam(req.params.action), Number(req.body.version), req.body));
  runnerIssue = async (req: Request, res: Response) => sendCreated(res, await fulfilmentService.runnerIssue(req.user!.sub, routeParam(req.params.id), req.body));
  verifyItem = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.verifyItem(req.user!.sub, routeParam(req.params.id), routeParam(req.params.orderItemId), req.body));

  controlTower = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.controlTower(actor(req), req.query as Record<string, unknown>));
  adminTaskDetail = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.adminTaskDetail(actor(req), routeParam(req.params.id)));
  assignmentRunners = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.assignmentRunners(actor(req), req.query as Record<string, unknown>));
  assignmentHubs = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.assignmentHubs(actor(req), req.query as Record<string, unknown>));
  reassignTask = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.reassignTask(actor(req), routeParam(req.params.id), req.body));
  adminExceptions = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.exceptions(actor(req), req.query as Record<string, unknown>));
  resolveException = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.resolveException(actor(req), routeParam(req.params.id), req.body));
  hubDashboard = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.hubDashboard(actor(req), req.query as Record<string, unknown>));
  adminConsolidations = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.consolidations(actor(req), req.query as Record<string, unknown>));
  receivePackage = async (req: Request, res: Response) => sendCreated(res, await fulfilmentService.receivePackage(actor(req), routeParam(req.params.id), req.body));
  qualityCheck = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.qualityCheck(actor(req), routeParam(req.params.id), req.body));
  consolidate = async (req: Request, res: Response) => sendCreated(res, await fulfilmentService.consolidate(actor(req), routeParam(req.params.id), req.body));
  sealConsolidation = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.sealConsolidation(actor(req), routeParam(req.params.id), req.body));
  createShipment = async (req: Request, res: Response) => sendCreated(res, await fulfilmentService.createManualShipment(actor(req), routeParam(req.params.id), req.body));
  updateShipment = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.updateShipment(actor(req), routeParam(req.params.id), req.body));
  partnerCustody = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.partnerCustody(actor(req), routeParam(req.params.orderId)));
  partnerCustodyList = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.partnerCustodyList(actor(req), req.query as Record<string, unknown>));
  receiveCustody = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.receiveCustody(actor(req), routeParam(req.params.id), String(req.header('idempotency-key') || req.body.idempotencyKey || '')));
  releaseCustody = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.releaseCustody(actor(req), routeParam(req.params.id), String(req.body.code || ''), String(req.header('idempotency-key') || req.body.idempotencyKey || '')));

  customerFulfilment = async (req: Request, res: Response) => {
    const order = await fulfilmentService.customerOrderProgress(req.user!.sub, routeParam(req.params.id));
    sendSuccess(res, order);
  };
  customerReturn = async (req: Request, res: Response) => sendCreated(res, await fulfilmentService.createReturn(actor(req), routeParam(req.params.id), req.body));

  adminReturnReview = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.reviewReturn(actor(req), routeParam(req.params.id), req.body));
  adminRefund = async (req: Request, res: Response) => sendCreated(res, await fulfilmentService.createRefund(actor(req), req.body));
  adminRefundProcess = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.processRefund(actor(req), routeParam(req.params.id), req.body));
  adminReturns = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.returns(actor(req), req.query as Record<string, unknown>));
  adminRefunds = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.refunds(actor(req), req.query as Record<string, unknown>));
  adminShipments = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.shipments(actor(req), req.query as Record<string, unknown>));
  logisticsReadiness = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.logisticsReadiness(actor(req)));
  logisticsWebhook = async (req: Request, res: Response) => sendSuccess(res, await fulfilmentService.logisticsWebhook(routeParam(req.params.provider), String(req.header('x-provider-event-id') || ''), req.body, String(req.header('x-provider-signature') || '')));
}
