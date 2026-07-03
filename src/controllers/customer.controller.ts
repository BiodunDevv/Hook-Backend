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
import { Settlement } from '@models/settlements/settlement.model';
import { CartService } from '@services/cart.service';
import { NegotiationService } from '@services/negotiation.service';
import { OrderService } from '@services/order.service';
import { PaymentService } from '@services/payment.service';
import { routeParam } from '@lib/api-utils';
import { sendCreated, sendSuccess } from '@utils/http';

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

  getCart = async (req: Request, res: Response) => {
    sendSuccess(res, await this.cart.getCart(req.user!.sub));
  };

  addCartItem = async (req: Request, res: Response) => {
    sendCreated(res, await this.cart.addItem(req.user!.sub, req.body.productId, req.body.quantity, req.body.selectedVariants));
  };

  updateCartItem = async (req: Request, res: Response) => {
    sendSuccess(res, await this.cart.updateItem(req.user!.sub, routeParam(req.params.itemId), req.body.quantity));
  };

  removeCartItem = async (req: Request, res: Response) => {
    sendSuccess(res, await this.cart.removeItem(req.user!.sub, routeParam(req.params.itemId)));
  };

  clearCart = async (req: Request, res: Response) => {
    sendSuccess(res, await this.cart.clear(req.user!.sub));
  };

  checkout = async (req: Request, res: Response) => {
    sendCreated(res, await this.orders.checkout(req.user!.sub, req.body));
  };

  listOrders = async (req: Request, res: Response) => {
    sendSuccess(res, await this.orders.listCustomerOrders(req.user!.sub));
  };

  getOrder = async (req: Request, res: Response) => {
    sendSuccess(res, await this.orders.getCustomerOrder(req.user!.sub, routeParam(req.params.id)));
  };

  cancelOrder = async (req: Request, res: Response) => {
    sendSuccess(res, await this.orders.cancelCustomerOrder(req.user!.sub, routeParam(req.params.id), req.body.reason));
  };

  startNegotiation = async (req: Request, res: Response) => {
    sendCreated(res, await this.negotiations.start(req.user!.sub, req.body.productId, req.body.offeredPrice, req.body.message));
  };

  counterNegotiation = async (req: Request, res: Response) => {
    sendSuccess(res, await this.negotiations.counter(req.user!.sub, routeParam(req.params.id), req.body.offeredPrice, req.body.message));
  };

  acceptNegotiation = async (req: Request, res: Response) => {
    sendSuccess(res, await this.negotiations.accept(req.user!.sub, routeParam(req.params.id)));
  };

  listNegotiations = async (req: Request, res: Response) => {
    sendSuccess(res, await this.negotiations.list(req.user!.sub));
  };

  getNegotiation = async (req: Request, res: Response) => {
    sendSuccess(res, await this.negotiations.detail(req.user!.sub, routeParam(req.params.id)));
  };

  initializePayment = async (req: Request, res: Response) => {
    sendCreated(res, await this.payments.initialize(req.user!.sub, req.body.orderId, req.body.gateway, req.body.paymentMethod));
  };

  verifyPayment = async (req: Request, res: Response) => {
    sendSuccess(res, await this.payments.verify(req.user!.sub, routeParam(req.params.reference)));
  };

  paymentStatus = async (req: Request, res: Response) => {
    sendSuccess(res, await this.payments.status(req.user!.sub, routeParam(req.params.orderId)));
  };

  notifications = async (_req: Request, res: Response) => {
    sendSuccess(res, { data: [], unread: 0, total: 0 });
  };
}
