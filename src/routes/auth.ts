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
const logoutSchema = z.object({ refreshToken: z.string().min(1).optional() });
const lookupSchema = z.object({ email: z.string().email() });
const signupStartSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  guestId: z.string().min(12).optional(),
});
const signupVerifySchema = z.object({
  signupSessionToken: z.string().min(32),
  code: z.string().min(4),
});
const signupCompleteSchema = z.object({
  signupSessionToken: z.string().min(32),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().min(6).optional(),
  avatarUrl: z.string().url().optional(),
  address: z.record(z.string(), z.unknown()).optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
  guestId: z.string().min(12).optional(),
});
const passwordVerifySchema = z.object({ email: z.string().email(), code: z.string().min(4) });

export function createAuthRouter() {
  const router = Router();
  const controller = new AuthController();

  router.post('/lookup', validateBody(lookupSchema), asyncHandler(controller.lookup));
  router.post('/signup/start', validateBody(signupStartSchema), asyncHandler(controller.startSignup));
  router.post('/signup/verify', validateBody(signupVerifySchema), asyncHandler(controller.verifySignup));
  router.post('/signup/resend', validateBody(z.object({ signupSessionToken: z.string().min(32) })), asyncHandler(controller.resendSignupCode));
  router.post('/signup/complete', validateBody(signupCompleteSchema), asyncHandler(controller.completeSignup));
  router.post('/register', validateBody(registerSchema), asyncHandler(controller.register));
  router.post('/login', validateBody(loginSchema), asyncHandler(controller.login));
  router.post('/verify-otp', validateBody(otpSchema), asyncHandler(controller.verifyOtp));
  router.post('/refresh', validateBody(refreshSchema), asyncHandler(controller.refresh));
  router.post('/logout', validateBody(logoutSchema), asyncHandler(controller.logout));
  router.post('/password/forgot', validateBody(passwordResetRequestSchema), asyncHandler(controller.requestPasswordReset));
  router.post('/password/verify', validateBody(passwordVerifySchema), asyncHandler(controller.verifyPasswordReset));
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
