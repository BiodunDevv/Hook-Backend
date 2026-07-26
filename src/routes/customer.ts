import { Router } from 'express';
import { z } from 'zod';
import { CustomerController } from '@controllers/customer.controller';
import { NegotiationController } from '@controllers/negotiation.controller';
import { requireCustomerIdentity } from '@middleware/auth';
import { validateBody } from '@middleware/validate';
import {
  cartItemSchema,
  cartQuantitySchema,
  checkoutSchema,
  paymentInitializeSchema,
  customerRefundRequestSchema,
  deletionRequestSchema,
  checkoutEventSchema,
} from '@validations/common.schemas';
import { negotiationCreateSchema, negotiationOfferSchema } from '@validations/catalog.schemas';
import { asyncHandler } from '@utils/http';

export function createCustomerRouter() {
  const router = Router();
  const controller = new CustomerController();
  const negotiations = new NegotiationController();

  router.use(requireCustomerIdentity);

  router.get('/cart', asyncHandler(controller.getCart));
  router.post('/cart/items', validateBody(cartItemSchema), asyncHandler(controller.addCartItem));
  router.patch('/cart/items/:itemId', validateBody(cartQuantitySchema), asyncHandler(controller.updateCartItem));
  router.delete('/cart/items/:itemId', asyncHandler(controller.removeCartItem));
  router.delete('/cart', asyncHandler(controller.clearCart));

  router.post('/checkout', validateBody(checkoutSchema), asyncHandler(controller.checkout));
  router.get('/orders', asyncHandler(controller.listOrders));
  router.get('/orders/:id', asyncHandler(controller.getOrder));
  router.post('/orders/:id/cancel', validateBody(z.object({ reason: z.string().optional() })), asyncHandler(controller.cancelOrder));
  router.post('/orders/:id/refunds', validateBody(customerRefundRequestSchema), asyncHandler(controller.requestRefund));

  router.get('/negotiations', asyncHandler(negotiations.list));
  router.post('/negotiations', validateBody(negotiationCreateSchema), asyncHandler(negotiations.create));
  router.get('/negotiations/:id', asyncHandler(negotiations.detail));
  router.post('/negotiations/:id/offers', validateBody(negotiationOfferSchema), asyncHandler(negotiations.offer));
  router.post('/negotiations/:id/accept', asyncHandler(negotiations.accept));
  router.post('/negotiations/:id/close', asyncHandler(negotiations.close));

  router.post('/payments/initialize', validateBody(paymentInitializeSchema), asyncHandler(controller.initializePayment));
  router.post('/payments/verify/:reference', asyncHandler(controller.verifyPayment));
  router.get('/payments/orders/:orderId/status', asyncHandler(controller.paymentStatus));
  router.get('/payment-methods/capability', asyncHandler(controller.paymentMethodCapability));
  router.get('/payment-methods', asyncHandler(controller.listPaymentMethods));
  router.post('/payment-methods', validateBody(z.object({ providerToken: z.string().min(16).max(512), brand: z.string().max(30).optional(), last4: z.string().regex(/^\d{4}$/), expiryDisplay: z.string().max(10).optional(), isDefault: z.boolean().default(false) }).strict()), asyncHandler(controller.savePaymentMethod));
  router.delete('/payment-methods/:id', asyncHandler(controller.removePaymentMethod));

  router.post('/support/account-deletion', validateBody(deletionRequestSchema), asyncHandler(controller.requestDeletion));
  router.post('/analytics/checkout-events', validateBody(checkoutEventSchema), asyncHandler(controller.recordCheckoutEvent));

  router.get('/notifications', asyncHandler(controller.listNotifications));
  router.patch('/notifications/read-all', asyncHandler(controller.markAllNotificationsRead));
  router.delete('/notifications/clear', asyncHandler(controller.clearNotifications));
  router.get('/notifications/:id', asyncHandler(controller.getNotification));
  router.patch('/notifications/:id/read', asyncHandler(controller.markNotificationRead));
  router.delete('/notifications/:id', asyncHandler(controller.deleteNotification));

  return router;
}
