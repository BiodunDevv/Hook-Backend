import { Request, Response } from 'express';
import { AppDataSource } from '@config/data-source';
import { Order } from '@models/orders/order.model';
import { Payment } from '@models/payments/payment.model';
import { PaymentService } from '@services/payment.service';
import { routeParam } from '@lib/api-utils';
import { sendSuccess } from '@utils/http';

export class WebhookController {
  private readonly payments = new PaymentService(
    AppDataSource.getRepository(Payment),
    AppDataSource.getRepository(Order),
  );

  payment = async (req: Request, res: Response) => {
    const gateway = routeParam(req.params.gateway) as 'paystack' | 'nomba';
    sendSuccess(res, await this.payments.webhook(gateway, req.body));
  };
}
