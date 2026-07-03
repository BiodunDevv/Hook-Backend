import { Router } from 'express';
import { WebhookController } from '@controllers/webhook.controller';
import { asyncHandler } from '@utils/http';

export function createWebhookRouter() {
  const router = Router();
  const controller = new WebhookController();

  router.post('/payments/:gateway', asyncHandler(controller.payment));

  return router;
}
