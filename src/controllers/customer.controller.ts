import { Request, Response } from 'express';
import { AppDataSource } from '@config/data-source';
import { CartItem } from '@models/cart/cart-item.model';
import { Cart } from '@models/cart/cart.model';
import { Logistics } from '@models/logistics/logistics.model';
import { Negotiation } from '@models/negotiations/negotiation.model';
import { OrderItem } from '@models/orders/order-item.model';
import { Order } from '@models/orders/order.model';
import { Payment } from '@models/payments/payment.model';
import { Product } from '@models/products/product.model';
import { DeviceToken } from '@models/notifications/device-token.model';
import { Notification } from '@models/notifications/notification.model';
import { Settlement } from '@models/settlements/settlement.model';
import { CartService } from '@services/cart.service';
import { NegotiationService } from '@services/negotiation.service';
import { NotificationService } from '@services/notification.service';
import { OrderService } from '@services/order.service';
import { PaymentService } from '@services/payment.service';
import { routeParam } from '@lib/api-utils';
import { sendCreated, sendSuccess } from '@utils/http';

function owner(req: Request) {
  return req.user?.sub ? { userId: req.user.sub } : { guestId: req.guestId };
}

function ownerId(req: Request) {
  return req.user?.sub || req.guestId!;
}

export class CustomerController {
  private readonly cart = new CartService(
    AppDataSource.getRepository(Cart),
    AppDataSource.getRepository(CartItem),
    AppDataSource.getRepository(Product),
  );

  private readonly orders = new OrderService(
    AppDataSource.getRepository(Cart),
    AppDataSource.getRepository(CartItem),
    AppDataSource.getRepository(Order),
    AppDataSource.getRepository(OrderItem),
    AppDataSource.getRepository(Product),
    AppDataSource.getRepository(Logistics),
    AppDataSource.getRepository(Settlement),
  );

  private readonly negotiations = new NegotiationService(
    AppDataSource.getRepository(Negotiation),
    AppDataSource.getRepository(Product),
  );

  private readonly payments = new PaymentService(
    AppDataSource.getRepository(Payment),
    AppDataSource.getRepository(Order),
  );

  private readonly notificationService = new NotificationService(
    AppDataSource.getRepository(DeviceToken),
    AppDataSource.getRepository(Notification),
  );

  getCart = async (req: Request, res: Response) => {
    sendSuccess(res, await this.cart.getCart(owner(req)));
  };

  addCartItem = async (req: Request, res: Response) => {
    sendCreated(res, await this.cart.addItem(owner(req), req.body.productId, req.body.quantity, req.body.selectedVariants));
  };

  updateCartItem = async (req: Request, res: Response) => {
    sendSuccess(res, await this.cart.updateItem(owner(req), routeParam(req.params.itemId), req.body.quantity));
  };

  removeCartItem = async (req: Request, res: Response) => {
    sendSuccess(res, await this.cart.removeItem(owner(req), routeParam(req.params.itemId)));
  };

  clearCart = async (req: Request, res: Response) => {
    sendSuccess(res, await this.cart.clear(owner(req)));
  };

  checkout = async (req: Request, res: Response) => {
    sendCreated(res, await this.orders.checkout(owner(req), req.body));
  };

  listOrders = async (req: Request, res: Response) => {
    sendSuccess(res, await this.orders.listCustomerOrders(owner(req)));
  };

  getOrder = async (req: Request, res: Response) => {
    sendSuccess(res, await this.orders.getCustomerOrder(owner(req), routeParam(req.params.id)));
  };

  cancelOrder = async (req: Request, res: Response) => {
    sendSuccess(res, await this.orders.cancelCustomerOrder(owner(req), routeParam(req.params.id), req.body.reason));
  };

  startNegotiation = async (req: Request, res: Response) => {
    sendCreated(res, await this.negotiations.start(ownerId(req), req.body.productId, req.body.offeredPrice, req.body.message));
  };

  counterNegotiation = async (req: Request, res: Response) => {
    sendSuccess(res, await this.negotiations.counter(ownerId(req), routeParam(req.params.id), req.body.offeredPrice, req.body.message));
  };

  acceptNegotiation = async (req: Request, res: Response) => {
    sendSuccess(res, await this.negotiations.accept(ownerId(req), routeParam(req.params.id)));
  };

  listNegotiations = async (req: Request, res: Response) => {
    sendSuccess(res, await this.negotiations.list(ownerId(req)));
  };

  getNegotiation = async (req: Request, res: Response) => {
    sendSuccess(res, await this.negotiations.detail(ownerId(req), routeParam(req.params.id)));
  };

  initializePayment = async (req: Request, res: Response) => {
    sendCreated(res, await this.payments.initialize(ownerId(req), req.body.orderId, req.body.gateway, req.body.paymentMethod));
  };

  verifyPayment = async (req: Request, res: Response) => {
    sendSuccess(res, await this.payments.verify(ownerId(req), routeParam(req.params.reference)));
  };

  paymentStatus = async (req: Request, res: Response) => {
    sendSuccess(res, await this.payments.status(ownerId(req), routeParam(req.params.orderId)));
  };

  notifications = async (req: Request, res: Response) => {
    if (req.method === 'GET') {
      sendSuccess(res, await this.notificationService.list(owner(req)));
      return;
    }
    if (req.method === 'PATCH') {
      sendSuccess(res, await this.notificationService.markRead(owner(req), routeParam(req.params.id)));
      return;
    }
    if (req.method === 'DELETE') {
      sendSuccess(res, await this.notificationService.delete(owner(req), routeParam(req.params.id)));
      return;
    }
    sendSuccess(res, { data: [], unread: 0, total: 0 });
  };
}
