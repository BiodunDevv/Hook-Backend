import { Router } from 'express';
import { VendorController } from '@controllers/vendor.controller';
import { requireAuth } from '@middleware/auth';
import { validateBody } from '@middleware/validate';
import {
  productSchema,
  vendorBankSchema,
  vendorRegistrationSchema,
  fulfilmentDecisionSchema,
} from '@validations/common.schemas';
import { asyncHandler } from '@utils/http';

export function createVendorRouter() {
  const router = Router();
  const controller = new VendorController();

  router.use(requireAuth);
  router.post('/register', validateBody(vendorRegistrationSchema), asyncHandler(controller.register));
  router.get('/profile', asyncHandler(controller.profile));
  router.patch('/profile', asyncHandler(controller.updateProfile));
  router.get('/products', asyncHandler(controller.products));
  router.post('/products', validateBody(productSchema), asyncHandler(controller.createProduct));
  router.patch('/products/:id', asyncHandler(controller.updateProduct));
  router.get('/orders', asyncHandler(controller.orders));
  router.post('/orders/:orderId/fulfilment/:decision', validateBody(fulfilmentDecisionSchema), asyncHandler(controller.decideFulfilment));
  router.get('/settlements', asyncHandler(controller.settlements));
  router.patch('/bank-details', validateBody(vendorBankSchema), asyncHandler(controller.bankDetails));

  return router;
}
