import { Router } from 'express';
import { z } from 'zod';
import { AuthController } from '@controllers/auth.controller';
import { validateBody } from '@middleware/validate';
import { asyncHandler } from '@utils/http';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function createAdminAuthRouter() {
  const router = Router();
  const controller = new AuthController();

  router.post('/login', validateBody(loginSchema), asyncHandler(controller.adminLogin));

  return router;
}
