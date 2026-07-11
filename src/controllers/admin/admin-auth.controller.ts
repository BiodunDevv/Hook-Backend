import { Router } from 'express';
import { z } from 'zod';
import { AuthController } from '@controllers/auth.controller';
import { authLimiter } from '@middleware/security';
import { validateBody } from '@middleware/validate';
import { asyncHandler } from '@utils/http';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
const passwordResetRequestSchema = z.object({ email: z.string().email() });
const passwordResetSchema = z.object({
  email: z.string().email(),
  code: z.string().min(4),
  password: z.string().min(6),
});

export function createAdminAuthRouter() {
  const router = Router();
  const controller = new AuthController();

  router.post('/login', authLimiter, validateBody(loginSchema), asyncHandler(controller.adminLogin));
  router.post('/logout', validateBody(z.object({ refreshToken: z.string().min(1).optional() })), asyncHandler(controller.logout));
  router.post('/password/forgot', authLimiter, validateBody(passwordResetRequestSchema), asyncHandler(controller.requestAdminPasswordReset));
  router.post('/password/reset', authLimiter, validateBody(passwordResetSchema), asyncHandler(controller.resetAdminPassword));

  return router;
}
