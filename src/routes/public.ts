import { Router } from 'express';
import { PublicController } from '@controllers/public.controller';
import { asyncHandler } from '@utils/http';

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
  router.get('/booths', asyncHandler(controller.getBooths));
  router.get('/booths/nearby', asyncHandler(controller.getNearbyBooths));
  router.get('/booths/:id', asyncHandler(controller.getBooth));
  router.get('/search', asyncHandler(controller.search));
  router.get('/search/suggestions', asyncHandler(controller.suggestions));

  return router;
}
