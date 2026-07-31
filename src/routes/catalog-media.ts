import { Router } from 'express';
import { CatalogMediaController } from '@controllers/catalog-media.controller';
import { requireAuth, requireAccountType } from '@middleware/auth';
import { AccountType } from '@lib/constants';
import { validateBody } from '@middleware/validate';
import { uploadFinalizeSchema, uploadIntentSchema } from '@validations/catalog.schemas';
import { asyncHandler } from '@utils/http';

export function createCatalogMediaRouter() {
  const router = Router();
  const controller = new CatalogMediaController();
  router.use(requireAuth, requireAccountType(AccountType.RUNNER, AccountType.STAFF));
  router.get('/readiness', asyncHandler(controller.readiness));
  router.post('/upload-intents', validateBody(uploadIntentSchema), asyncHandler(controller.intent));
  router.post('/finalize', validateBody(uploadFinalizeSchema), asyncHandler(controller.finalize));
  return router;
}
