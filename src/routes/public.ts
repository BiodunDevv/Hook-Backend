import { Router } from 'express';
import { z } from 'zod';
import { PublicController } from '@controllers/public.controller';
import { asyncHandler } from '@utils/http';
import { validateBody } from '@middleware/validate';
import { RunnerMarketVendorController } from '@controllers/market-vendor.controller';
import { PaymentLinkController } from '@controllers/payment-link.controller';
import { paymentLinkInitializeSchema } from '@validations/commerce.schemas';

export function createPublicRouter() {
  const router = Router();
  const controller = new PublicController();
  const marketVendors = new RunnerMarketVendorController();
  const paymentLinks = new PaymentLinkController();

  router.get('/payment-links/:token', asyncHandler(paymentLinks.detail));
  router.post('/payment-links/:token/initialize', validateBody(paymentLinkInitializeSchema), asyncHandler(paymentLinks.initialize));
  router.get('/payment-links/:token/status', asyncHandler(paymentLinks.status));

  router.get('/products', asyncHandler(controller.getProducts));
  router.get('/products/:id', asyncHandler(controller.getProduct));
  router.get('/feed', asyncHandler(controller.homeFeed));
  router.get('/categories', asyncHandler(controller.getCategories));
  router.get('/categories/tree', asyncHandler(controller.getCategoryTree));
  router.get('/categories/:id', asyncHandler(controller.getCategory));
  router.get('/operating-states', asyncHandler(controller.getOperatingStates));
  router.get('/search', asyncHandler(controller.search));
  router.get('/search/suggestions', asyncHandler(controller.suggestions));
  router.post('/vendor-invitations/:token/accept', validateBody(z.object({
    contactName: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().min(7).max(30).optional(),
    email: z.string().email().optional(),
  }).strict()), asyncHandler(marketVendors.acceptInvitation));

  return router;
}
