import { Request, Response } from 'express';
import { OrderStatus } from '@lib/constants';
import { HttpError, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';

export class AdminOrdersController {
  list = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const where = typeof req.query.status === 'string' ? { status: req.query.status as OrderStatus } : {};
    const [data, total] = await adminRepos.orders().findAndCount({
      where,
      relations: { user: true, items: true, payment: true, logistics: true },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
    sendSuccess(res, paginated(data, total, page, limit));
  };

  detail = async (req: Request, res: Response) => {
    const order = await adminRepos.orders().findOne({
      where: { id: routeParam(req.params.id) },
      relations: { user: true, items: true, payment: true, logistics: true },
    });
    if (!order) throw new HttpError(404, 'Order not found');
    sendSuccess(res, order);
  };

  status = async (req: Request, res: Response) => {
    const orders = adminRepos.orders();
    const order = await orders.findOne({ where: { id: routeParam(req.params.id) } });
    if (!order) throw new HttpError(404, 'Order not found');
    order.status = req.body.status || order.status;
    if (order.status === OrderStatus.DELIVERED) order.deliveredAt = new Date();
    await orders.save(order);
    sendSuccess(res, order);
  };
}
