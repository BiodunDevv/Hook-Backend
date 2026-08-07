import { Request, Response } from "express";
import { AppDataSource } from "@config/data-source";
import { CartItem } from "@models/cart/cart-item.model";
import { Cart } from "@models/cart/cart.model";
import { Logistics } from "@models/logistics/logistics.model";
import { OrderItem } from "@models/orders/order-item.model";
import { Order } from "@models/orders/order.model";
import { Payment } from "@models/payments/payment.model";
import { EscrowLedger } from "@models/payments/escrow-ledger.model";
import { Product } from "@models/products/product.model";
import { User } from "@models/users/user.model";
import { DeviceToken } from "@models/notifications/device-token.model";
import { Notification } from "@models/notifications/notification.model";
import { AccountDeletionRequest } from "@models/support/account-deletion-request.model";
import { CheckoutEvent } from "@models/analytics/checkout-event.model";
import { SavedPaymentMethod } from "@models/payments/saved-payment-method.model";
import { CartService } from "@services/cart.service";
import { NotificationService } from "@services/notification.service";
import { OrderService } from "@services/order.service";
import { PaymentService } from "@services/payment.service";
import { HttpError } from "@utils/http";
import { routeParam } from "@lib/api-utils";
import { sendCreated, sendSuccess } from "@utils/http";
import { RefundRequest } from "@models/orders/refund-request.model";
import { OrderStatus, PaymentStatus } from "@lib/constants";
import { publicCart, publicOrder } from "@lib/public-resource";
import { AddressService } from "@services/address.service";
import { CheckoutService } from "@services/checkout.service";
import { CommerceSettings } from "@models/commerce/commerce.model";

function owner(req: Request) {
  return req.user?.sub
    ? { userId: req.user.sub }
    : { guestSessionId: req.guestSessionId, guestId: req.guestId };
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
  );

  private readonly payments = new PaymentService(
    AppDataSource.getRepository(Payment),
    AppDataSource.getRepository(Order),
    AppDataSource.getRepository(EscrowLedger),
  );

  private readonly notificationService = new NotificationService(
    AppDataSource.getRepository(DeviceToken),
    AppDataSource.getRepository(Notification),
  );
  private readonly addresses = new AddressService();
  private readonly checkoutV4 = new CheckoutService();

  getCart = async (req: Request, res: Response) => {
    sendSuccess(
      res,
      publicCart(await this.cart.getCart(owner(req))),
      "Cart retrieved successfully",
    );
  };

  addCartItem = async (req: Request, res: Response) => {
    sendCreated(
      res,
      publicCart(
        await this.cart.addItem(
          owner(req),
          req.body.productId,
          req.body.quantity,
          req.body.selectedVariants,
          req.body.variantId,
          req.body.quoteId,
          { deferRecalculation: true },
        ),
      ),
      "Item added to cart successfully",
    );
  };

  updateCartItem = async (req: Request, res: Response) => {
    sendSuccess(
      res,
      publicCart(
        await this.cart.updateItem(
          owner(req),
          routeParam(req.params.itemId),
          req.body.quantity,
          { deferRecalculation: true },
        ),
      ),
      "Cart updated successfully",
    );
  };

  removeCartItem = async (req: Request, res: Response) => {
    sendSuccess(
      res,
      publicCart(
        await this.cart.removeItem(owner(req), routeParam(req.params.itemId), {
          deferRecalculation: true,
        }),
      ),
      "Item removed from cart successfully",
    );
  };

  clearCart = async (req: Request, res: Response) => {
    sendSuccess(
      res,
      publicCart(await this.cart.clear(owner(req), undefined, { deferRecalculation: true })),
      "Cart cleared successfully",
    );
  };

  clearCartState = async (req: Request, res: Response) => {
    sendSuccess(
      res,
      publicCart(
        await this.cart.clear(owner(req), routeParam(req.params.stateId), {
          deferRecalculation: true,
        }),
      ),
      "State basket cleared successfully",
    );
  };

  listAddresses = async (req: Request, res: Response) =>
    sendSuccess(res, await this.addresses.list(req.user!.sub));
  createAddress = async (req: Request, res: Response) =>
    sendCreated(res, await this.addresses.create(req.user!.sub, req.body));
  updateAddress = async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await this.addresses.update(
        req.user!.sub,
        routeParam(req.params.id),
        req.body,
      ),
    );
  deleteAddress = async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await this.addresses.archive(req.user!.sub, routeParam(req.params.id)),
    );
  defaultAddress = async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await this.addresses.setDefault(req.user!.sub, routeParam(req.params.id)),
    );

  checkoutPreview = async (req: Request, res: Response) =>
    sendCreated(
      res,
      await this.checkoutV4.preview(
        { type: "customer", actorId: req.user!.sub, customerId: req.user!.sub },
        routeParam(req.params.stateId),
        req.body,
      ),
    );
  checkoutConfirm = async (req: Request, res: Response) =>
    sendCreated(
      res,
      await this.checkoutV4.confirm(
        { type: "customer", actorId: req.user!.sub, customerId: req.user!.sub },
        req.body.previewToken,
        String(req.header("idempotency-key") || ""),
      ),
    );
  commerceConfig = async (_req: Request, res: Response) => {
    const settings = await CommerceSettings.findOne({ key: "commerce" }).lean();
    sendSuccess(res, {
      currency: settings?.currency || "NGN",
      podEnabled: settings?.podEnabled || false,
      policyVersions: settings?.activePolicyVersions || {},
    });
  };

  checkout = async (req: Request, res: Response) => {
    sendCreated(
      res,
      publicOrder(await this.orders.checkout(owner(req), req.body)),
    );
  };

  listOrders = async (req: Request, res: Response) => {
    sendSuccess(
      res,
      (await this.orders.listCustomerOrders(owner(req))).map((order: unknown) =>
        publicOrder(order as any),
      ),
    );
  };

  getOrder = async (req: Request, res: Response) => {
    sendSuccess(
      res,
      publicOrder(
        await this.orders.getCustomerOrder(
          owner(req),
          routeParam(req.params.id),
        ),
      ),
    );
  };

  cancelOrder = async (req: Request, res: Response) => {
    sendSuccess(
      res,
      publicOrder(
        await this.orders.cancelCustomerOrder(
          owner(req),
          routeParam(req.params.id),
          req.body.reason,
        ),
      ),
    );
  };

  initializePayment = async (req: Request, res: Response) => {
    if (!req.user?.sub)
      throw new HttpError(401, "Customer authentication required");
    sendCreated(
      res,
      await this.payments.initialize(req.user.sub, req.body.orderId),
    );
  };

  paymentStatus = async (req: Request, res: Response) => {
    if (!req.user?.sub)
      throw new HttpError(401, "Customer authentication required");
    sendSuccess(
      res,
      await this.payments.status(req.user.sub, routeParam(req.params.orderId)),
    );
  };

  paymentMethodCapability = async (_req: Request, res: Response) => {
    sendSuccess(res, this.payments.capability());
  };

  listPaymentMethods = async (req: Request, res: Response) => {
    if (!req.user?.sub)
      throw new HttpError(
        401,
        "Register or sign in to view saved payment methods",
      );
    sendSuccess(
      res,
      await AppDataSource.getRepository(SavedPaymentMethod).find({
        where: { userId: req.user.sub, isActive: true },
        select: [
          "id",
          "provider",
          "brand",
          "last4",
          "expiryDisplay",
          "consentedAt",
          "isDefault",
          "createdAt",
        ],
      }),
    );
  };

  savePaymentMethod = async (req: Request, res: Response) => {
    if (process.env.OPAY_TOKENIZATION_ENABLED !== "true")
      throw new HttpError(
        409,
        "Saved cards are not enabled for this merchant account",
      );
    if (!req.user?.sub)
      throw new HttpError(401, "Register or sign in to save a payment method");
    const repo = AppDataSource.getRepository(SavedPaymentMethod);
    if (req.body.isDefault)
      await repo.update({ userId: req.user.sub }, { isDefault: false });
    const method = await repo.save(
      repo.create({
        ...req.body,
        userId: req.user.sub,
        provider: "opay",
        consentedAt: new Date(),
        isActive: true,
      }),
    );
    sendCreated(res, {
      id: method.id,
      provider: method.provider,
      brand: method.brand,
      last4: method.last4,
      expiryDisplay: method.expiryDisplay,
      isDefault: method.isDefault,
    });
  };

  removePaymentMethod = async (req: Request, res: Response) => {
    if (!req.user?.sub)
      throw new HttpError(
        401,
        "Register or sign in to remove a payment method",
      );
    const repo = AppDataSource.getRepository(SavedPaymentMethod);
    const method = await repo.findOne({
      where: { id: routeParam(req.params.id), userId: req.user.sub },
    });
    if (!method) throw new HttpError(404, "Payment method not found");
    await repo.update(method.id, {
      isActive: false,
      providerToken: `revoked:${method.id}`,
    });
    sendSuccess(res, { id: method.id, removed: true });
  };

  listNotifications = async (req: Request, res: Response) => {
    sendSuccess(res, await this.notificationService.list(owner(req), {
      limit: Number(req.query.limit || 30),
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
    }));
  };

  getNotification = async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await this.notificationService.detail(
        owner(req),
        routeParam(req.params.id),
      ),
    );
  };

  markNotificationRead = async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await this.notificationService.markRead(
        owner(req),
        routeParam(req.params.id),
      ),
    );
  };

  markAllNotificationsRead = async (req: Request, res: Response) => {
    sendSuccess(res, await this.notificationService.markAllRead(owner(req)));
  };

  deleteNotification = async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await this.notificationService.delete(
        owner(req),
        routeParam(req.params.id),
      ),
    );
  };

  clearNotifications = async (req: Request, res: Response) => {
    sendSuccess(res, await this.notificationService.clearAll(owner(req)));
  };

  requestRefund = async (req: Request, res: Response) => {
    const order = await this.orders.getCustomerOrder(
      owner(req),
      routeParam(req.params.id),
    );
    if (
      ![PaymentStatus.SUCCESSFUL, PaymentStatus.PARTIALLY_REFUNDED].includes(
        order.paymentStatus,
      )
    )
      throw new HttpError(
        409,
        "Only captured payments can be considered for a refund",
      );
    const refundable =
      Number(order.total) - Number(order.payment?.refundedAmount || 0);
    const amount = Math.min(Number(req.body.amount || refundable), refundable);
    if (amount <= 0)
      throw new HttpError(409, "This order has no refundable balance");
    if (order.status === OrderStatus.DELIVERED) {
      if (!["damaged", "wrong_item"].includes(req.body.reasonType))
        throw new HttpError(
          409,
          "Delivered orders are refundable only for damaged or wrong items",
        );
      if (
        !order.deliveredAt ||
        Date.now() - new Date(order.deliveredAt).getTime() > 48 * 60 * 60 * 1000
      )
        throw new HttpError(
          409,
          "The 48-hour delivery issue window has closed",
        );
    } else if (
      req.body.reasonType !== "not_delivered" &&
      order.status === OrderStatus.SHIPPED
    ) {
      throw new HttpError(
        409,
        "Use the non-delivery reason while this order is in transit",
      );
    }
    const existing = await RefundRequest.findOne({
      idempotencyKey: req.body.idempotencyKey,
    }).lean({ virtuals: true });
    if (existing) return sendSuccess(res, existing);
    const request = await RefundRequest.create({
      orderId: order.id,
      paymentId: order.payment?.id,
      requestedBy: ownerId(req),
      reasonType: req.body.reasonType,
      reason: req.body.reason,
      evidenceUrls: req.body.evidenceUrls,
      amount,
      status: "requested",
      idempotencyKey: req.body.idempotencyKey,
      auditHistory: [
        { action: "requested", actorId: ownerId(req), at: new Date() },
      ],
    });
    sendCreated(res, request);
  };

  requestDeletion = async (req: Request, res: Response) => {
    if (!req.user?.sub)
      throw new HttpError(401, "A registered account is required");
    const repo = AppDataSource.getRepository(AccountDeletionRequest);
    const existing = await repo.findOne({
      where: {
        userId: req.user.sub,
        status: { $nin: ["anonymized", "cancelled"] },
      },
    });
    if (existing) return sendSuccess(res, existing);
    const request = await repo.save(
      repo.create({
        userId: req.user.sub,
        reason: req.body.reason,
        status: "requested",
        coolingOffUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }),
    );
    await AppDataSource.getRepository(User).update(req.user.sub, {
      accountStatus: "deletion_requested",
    });
    sendCreated(res, request);
  };

  recordCheckoutEvent = async (req: Request, res: Response) => {
    const repo = AppDataSource.getRepository(CheckoutEvent);
    sendCreated(
      res,
      await repo.save(
        repo.create({
          ...req.body,
          userId: req.user?.sub,
          guestId: req.guestId,
        }),
      ),
    );
  };
}
