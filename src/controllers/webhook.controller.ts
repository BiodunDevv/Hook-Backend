import { Request, Response } from 'express';
import { AppDataSource } from '@config/data-source';
import { Order } from '@models/orders/order.model';
import { Payment } from '@models/payments/payment.model';
import { EscrowLedger } from '@models/payments/escrow-ledger.model';
import { PaymentService } from '@services/payment.service';
import { routeParam } from '@lib/api-utils';
import { sendError, sendSuccess } from '@utils/http';

export class WebhookController {
  private readonly payments = new PaymentService(
    AppDataSource.getRepository(Payment),
    AppDataSource.getRepository(Order),
    AppDataSource.getRepository(EscrowLedger),
  );

  payment = async (req: Request, res: Response) => {
    const gateway = routeParam(req.params.gateway);
    if (gateway !== 'opay') {
      sendError(res, 410, 'INVALID_STATE_TRANSITION', 'Legacy payment webhooks are no longer active');
      return;
    }
    const transactionId = String(req.header('x-opay-tranid') || req.body?.transactionId || req.body?.data?.orderNo || '');
    if (!transactionId) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Missing OPay transaction id');
      return;
    }
    const signature = String(req.body?.sha512 || req.header('signature') || req.header('x-opay-signature') || '');
    sendSuccess(res, await this.payments.webhook(req.body, `opay-webhook:${transactionId}`, signature));
  };
}
