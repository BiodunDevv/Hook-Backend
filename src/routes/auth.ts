import { Router } from 'express';
import { z } from 'zod';
import { AuthController } from '@controllers/auth.controller';
import { requireAuth } from '@middleware/auth';
import { validateBody } from '@middleware/validate';
import {
  changePasswordSchema,
  loginSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  profileSchema,
  registerSchema,
} from '@validations/common.schemas';
import { asyncHandler } from '@utils/http';

const otpSchema = z.object({ email: z.string().email(), code: z.string().min(4) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });

export function createAuthRouter() {
  const router = Router();
  const controller = new AuthController();

  router.post('/register', validateBody(registerSchema), asyncHandler(controller.register));
  router.post('/login', validateBody(loginSchema), asyncHandler(controller.login));
  router.post('/verify-otp', validateBody(otpSchema), asyncHandler(controller.verifyOtp));
  router.post('/refresh', validateBody(refreshSchema), asyncHandler(controller.refresh));
  router.post('/password/forgot', validateBody(passwordResetRequestSchema), asyncHandler(controller.requestPasswordReset));
  router.post('/password/reset', validateBody(passwordResetSchema), asyncHandler(controller.resetPassword));
  router.get('/profile', requireAuth, asyncHandler(controller.profile));
  router.patch('/profile', requireAuth, validateBody(profileSchema), asyncHandler(controller.updateProfile));
  router.post('/complete-profile', requireAuth, validateBody(profileSchema), asyncHandler(controller.completeProfile));
  router.post('/password/change', requireAuth, validateBody(changePasswordSchema), asyncHandler(controller.changePassword));
  router.post('/social', asyncHandler(async (_req, res) => {
    res.status(501).json({
      success: false,
      message: 'Social login is not configured yet.',
      timestamp: new Date().toISOString(),
    });
  }));

  return router;
}
