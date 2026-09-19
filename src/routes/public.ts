import { Router } from 'express';
import { z } from 'zod';
import { PublicController } from '@controllers/public.controller';
import { asyncHandler } from '@utils/http';
import { validateBody } from '@middleware/validate';
import { MarketAssociateMarketVendorController } from '@controllers/market-vendor.controller';
import { PaymentLinkController } from '@controllers/payment-link.controller';
import { paymentLinkInitializeSchema } from '@validations/commerce.schemas';
import { AppReleasesController } from '@controllers/admin/app-releases.controller';
import { AccountDeletionController } from '@controllers/account-deletion.controller';
import { rateLimit } from '@middleware/security';
import { sha256 } from '@services/account-deletion.service';
import {
  publicDeletionCancelSchema,
  publicDeletionCodeSchema,
  publicDeletionProofSchema,
  publicDeletionRequestSchema,
} from '@validations/common.schemas';

// Deletion endpoints check passwords and are reachable without signing in, so
// they are throttled twice: per target email (stops guessing one account from
// many IPs) and per IP (stops sweeping many accounts from one).
const targetEmail = (req: { body?: { email?: unknown } }) => `email:${sha256(String(req.body?.email || '').toLowerCase().trim()).slice(0, 24)}`;
const deletionByEmail = rateLimit('deletion-email', { windowMs: 15 * 60_000, max: 8, key: targetEmail, message: 'Too many attempts for this account. Please try again in a few minutes.' });
const deletionByIp = rateLimit('deletion-ip', { windowMs: 15 * 60_000, max: 30, message: 'Too many attempts. Please try again in a few minutes.' });
const deletionCodeByEmail = rateLimit('deletion-code-email', { windowMs: 15 * 60_000, max: 3, key: targetEmail, message: 'A code was sent recently. Please check your email or wait a few minutes.' });

export function createPublicRouter() {
  const router = Router();
  const controller = new PublicController();
  const marketVendors = new MarketAssociateMarketVendorController();
  const paymentLinks = new PaymentLinkController();
  router.get('/public/app-release', asyncHandler(new AppReleasesController().publicPolicy));

  router.get('/public/legal/:type', asyncHandler(controller.getLegalContent));

  const accountDeletion = new AccountDeletionController();
  router.post('/public/account-deletion/code', deletionByIp, validateBody(publicDeletionCodeSchema), deletionCodeByEmail, asyncHandler(accountDeletion.sendCode));
  router.post('/public/account-deletion/request', deletionByIp, validateBody(publicDeletionRequestSchema), deletionByEmail, asyncHandler(accountDeletion.request));
  router.post('/public/account-deletion/status', deletionByIp, validateBody(publicDeletionProofSchema), deletionByEmail, asyncHandler(accountDeletion.status));
  router.post('/public/account-deletion/cancel', deletionByIp, validateBody(publicDeletionCancelSchema), deletionByEmail, asyncHandler(accountDeletion.cancel));

  router.get('/public/payment-links/:token', asyncHandler(paymentLinks.detail));
  router.post('/public/payment-links/:token/initialize', validateBody(paymentLinkInitializeSchema), asyncHandler(paymentLinks.initialize));
  router.get('/public/payment-links/:token/status', asyncHandler(paymentLinks.status));

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
