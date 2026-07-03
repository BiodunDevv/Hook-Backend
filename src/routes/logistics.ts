import { Router } from 'express';
import { z } from 'zod';
import { LogisticsController } from '@controllers/logistics.controller';
import { LogisticsStatus, UserRole } from '@lib/constants';
import { requireAuth } from '@middleware/auth';
import { requireRoles } from '@middleware/roles';
import { validateBody } from '@middleware/validate';
import { asyncHandler } from '@utils/http';

export function createLogisticsRouter() {
  const router = Router();
  const controller = new LogisticsController();

  router.use(requireAuth);
  router.post('/assign-driver', requireRoles(UserRole.ADMIN, UserRole.SUPER_ADMIN), validateBody(z.object({
    orderId: z.string().uuid(),
    driverId: z.string().uuid(),
  })), asyncHandler(controller.assignDriver));

  router.get('/driver/jobs', requireRoles(UserRole.EV_DRIVER, UserRole.ADMIN, UserRole.SUPER_ADMIN), asyncHandler(controller.jobs));
  router.patch('/driver/jobs/:id', requireRoles(UserRole.EV_DRIVER, UserRole.ADMIN, UserRole.SUPER_ADMIN), validateBody(z.object({
    status: z.nativeEnum(LogisticsStatus),
    deliveryProof: z.string().optional(),
    trackingPath: z.array(z.object({ lat: z.number(), lng: z.number(), timestamp: z.string() })).optional(),
  })), asyncHandler(controller.updateJob));
  router.post('/driver/jobs/:id/verify-otp', requireRoles(UserRole.EV_DRIVER, UserRole.ADMIN, UserRole.SUPER_ADMIN), validateBody(z.object({
    otp: z.string().min(4),
  })), asyncHandler(controller.verifyOtp));

  router.get('/field-agent/profile', requireRoles(UserRole.FIELD_AGENT, UserRole.ADMIN, UserRole.SUPER_ADMIN), asyncHandler(controller.fieldProfile));

  return router;
}
