import { Router } from 'express';
import { PublicController } from '@controllers/public.controller';
import { asyncHandler } from '@utils/http';
import { validateBody } from '@middleware/validate';
import { z } from 'zod';
import { rateLimit } from '@middleware/security';

export function createPublicRouter() {
  const router = Router();
  const controller = new PublicController();

  router.get('/products', asyncHandler(controller.getProducts));
  router.get('/products/:id', asyncHandler(controller.getProduct));
  router.get('/feed', asyncHandler(controller.homeFeed));
  router.get('/categories', asyncHandler(controller.getCategories));
  router.get('/categories/tree', asyncHandler(controller.getCategoryTree));
  router.get('/categories/:id', asyncHandler(controller.getCategory));
  router.get('/vendors', asyncHandler(controller.getVendors));
  router.get('/vendors/:id', asyncHandler(controller.getVendor));
  router.get('/operating-states', asyncHandler(controller.getOperatingStates));
  router.get('/booths', asyncHandler(controller.getBooths));
  router.get('/booths/nearby', asyncHandler(controller.getNearbyBooths));
  router.post('/booths/resolve', rateLimit('booth-code', { windowMs: 60_000, max: 6, message: 'Too many booth code attempts. Please wait and try again.' }), validateBody(z.object({ code: z.string().regex(/^\d{6}$/) })), asyncHandler(controller.resolveBooth));
  router.post('/booths/scan-session', validateBody(z.object({ boothSessionToken: z.string().min(20) })), asyncHandler(controller.boothSession));
  router.post('/booths/scan-session/products/:productId', validateBody(z.object({ boothSessionToken: z.string().min(20) })), asyncHandler(controller.boothProduct));
  router.get('/booths/scan/:publicId', asyncHandler(controller.scanBooth));
  router.get('/booths/:id', asyncHandler(controller.getBooth));
  router.get('/search', asyncHandler(controller.search));
  router.get('/search/suggestions', asyncHandler(controller.suggestions));

  return router;
}
