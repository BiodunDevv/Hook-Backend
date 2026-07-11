import { Router } from 'express';
import { z } from 'zod';
import { CustomerController } from '@controllers/customer.controller';
import { requireCustomerIdentity } from '@middleware/auth';
import { validateBody } from '@middleware/validate';
import {
  cartItemSchema,
  cartQuantitySchema,
  checkoutSchema,
  negotiationSchema,
  paymentInitializeSchema,
} from '@validations/common.schemas';
import { asyncHandler } from '@utils/http';

export function createCustomerRouter() {
  const router = Router();
  const controller = new CustomerController();

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

  router.get('/negotiations', asyncHandler(controller.listNegotiations));
  router.post('/negotiations', validateBody(negotiationSchema), asyncHandler(controller.startNegotiation));
  router.get('/negotiations/:id', asyncHandler(controller.getNegotiation));
  router.post('/negotiations/:id/counter', validateBody(negotiationSchema.omit({ productId: true })), asyncHandler(controller.counterNegotiation));
  router.post('/negotiations/:id/accept', asyncHandler(controller.acceptNegotiation));

  router.post('/payments/initialize', validateBody(paymentInitializeSchema), asyncHandler(controller.initializePayment));
  router.post('/payments/verify/:reference', asyncHandler(controller.verifyPayment));
  router.get('/payments/orders/:orderId/status', asyncHandler(controller.paymentStatus));

  router.get('/notifications', asyncHandler(controller.notifications));
  router.patch('/notifications/:id/read', asyncHandler(controller.notifications));
  router.delete('/notifications/:id', asyncHandler(controller.notifications));

  return router;
}
