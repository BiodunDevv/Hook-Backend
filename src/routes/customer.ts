import { Router } from "express";
import { z } from "zod";
import { CustomerController } from "@controllers/customer.controller";
import { NegotiationController } from "@controllers/negotiation.controller";
import { requireCustomerIdentity } from "@middleware/auth";
import { validateBody } from "@middleware/validate";
import {
  cartQuantitySchema,
  customerRefundRequestSchema,
  deletionRequestSchema,
  checkoutEventSchema,
} from "@validations/common.schemas";
import {
  negotiationCreateSchema,
  negotiationOfferSchema,
} from "@validations/catalog.schemas";
import {
  addressCreateSchema,
  addressUpdateSchema,
  checkoutConfirmSchema,
  checkoutPreviewSchema,
  commerceCartItemSchema,
  paymentInitializeV4Schema,
} from "@validations/commerce.schemas";
import { requireAuth, requireAccountType } from "@middleware/auth";
import { AccountType } from "@lib/constants";
import { asyncHandler } from "@utils/http";

export function createCustomerRouter() {
  const router = Router();
  const controller = new CustomerController();
  const negotiations = new NegotiationController();

  router.use(requireCustomerIdentity);

  router.get("/cart", asyncHandler(controller.getCart));
  router.post(
    "/cart/items",
    validateBody(commerceCartItemSchema),
    asyncHandler(controller.addCartItem),
  );
  router.patch(
    "/cart/items/:itemId",
    validateBody(cartQuantitySchema),
    asyncHandler(controller.updateCartItem),
  );
  router.delete("/cart/items/:itemId", asyncHandler(controller.removeCartItem));
  router.delete("/cart", asyncHandler(controller.clearCart));
  router.delete(
    "/cart/states/:stateId",
    asyncHandler(controller.clearCartState),
  );
  router.get("/commerce/config", asyncHandler(controller.commerceConfig));

  router.get(
    "/addresses",
    requireAuth,
    requireAccountType(AccountType.CUSTOMER),
    asyncHandler(controller.listAddresses),
  );
  router.post(
    "/addresses",
    requireAuth,
    requireAccountType(AccountType.CUSTOMER),
    validateBody(addressCreateSchema),
    asyncHandler(controller.createAddress),
  );
  router.patch(
    "/addresses/:id",
    requireAuth,
    requireAccountType(AccountType.CUSTOMER),
    validateBody(addressUpdateSchema),
    asyncHandler(controller.updateAddress),
  );
  router.delete(
    "/addresses/:id",
    requireAuth,
    requireAccountType(AccountType.CUSTOMER),
    asyncHandler(controller.deleteAddress),
  );
  router.post(
    "/addresses/:id/default",
    requireAuth,
    requireAccountType(AccountType.CUSTOMER),
    asyncHandler(controller.defaultAddress),
  );
  router.post(
    "/checkout/states/:stateId/preview",
    requireAuth,
    requireAccountType(AccountType.CUSTOMER),
    validateBody(checkoutPreviewSchema),
    asyncHandler(controller.checkoutPreview),
  );
  router.post(
    "/checkout/states/:stateId/confirm",
    requireAuth,
    requireAccountType(AccountType.CUSTOMER),
    validateBody(checkoutConfirmSchema),
    asyncHandler(controller.checkoutConfirm),
  );
  router.get("/orders", asyncHandler(controller.listOrders));
  router.get("/orders/:id", asyncHandler(controller.getOrder));
  router.post(
    "/orders/:id/cancel",
    validateBody(z.object({ reason: z.string().optional() })),
    asyncHandler(controller.cancelOrder),
  );
  router.post(
    "/orders/:id/refunds",
    validateBody(customerRefundRequestSchema),
    asyncHandler(controller.requestRefund),
  );

  router.get("/negotiations", asyncHandler(negotiations.list));
  router.post(
    "/negotiations",
    validateBody(negotiationCreateSchema),
    asyncHandler(negotiations.create),
  );
  router.get("/negotiations/:id", asyncHandler(negotiations.detail));
  router.post(
    "/negotiations/:id/offers",
    validateBody(negotiationOfferSchema),
    asyncHandler(negotiations.offer),
  );
  router.post("/negotiations/:id/accept", asyncHandler(negotiations.accept));
  router.post("/negotiations/:id/close", asyncHandler(negotiations.close));

  router.post(
    "/payments/initialize",
    requireAuth,
    requireAccountType(AccountType.CUSTOMER),
    validateBody(paymentInitializeV4Schema),
    asyncHandler(controller.initializePayment),
  );
  router.get(
    "/payments/:orderId",
    requireAuth,
    requireAccountType(AccountType.CUSTOMER),
    asyncHandler(controller.paymentStatus),
  );
  router.get(
    "/payments/orders/:orderId/status",
    asyncHandler(controller.paymentStatus),
  );
  router.post(
    "/support/account-deletion",
    validateBody(deletionRequestSchema),
    asyncHandler(controller.requestDeletion),
  );
  router.post(
    "/analytics/checkout-events",
    validateBody(checkoutEventSchema),
    asyncHandler(controller.recordCheckoutEvent),
  );

  router.get("/notifications", asyncHandler(controller.listNotifications));
  router.patch(
    "/notifications/read-all",
    asyncHandler(controller.markAllNotificationsRead),
  );
  router.delete(
    "/notifications/clear",
    asyncHandler(controller.clearNotifications),
  );
  router.get("/notifications/:id", asyncHandler(controller.getNotification));
  router.patch(
    "/notifications/:id/read",
    asyncHandler(controller.markNotificationRead),
  );
  router.delete(
    "/notifications/:id",
    asyncHandler(controller.deleteNotification),
  );

  return router;
}
