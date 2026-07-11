import { Router } from 'express';
import { z } from 'zod';
import { DeviceController } from '@controllers/device.controller';
import { requireCustomerIdentity } from '@middleware/auth';
import { validateBody } from '@middleware/validate';
import { asyncHandler } from '@utils/http';

const deviceSchema = z.object({
  expoPushToken: z.string().min(10),
  platform: z.enum(['ios', 'android', 'web', 'unknown']).default('unknown'),
  deviceName: z.string().optional(),
  sendWelcome: z.boolean().optional(),
});

export function createDeviceRouter() {
  const router = Router();
  const controller = new DeviceController();

  router.use(requireCustomerIdentity);
  router.post('/register', validateBody(deviceSchema), asyncHandler(controller.register));
  router.post('/unregister', validateBody(z.object({ expoPushToken: z.string().min(10).optional() })), asyncHandler(controller.unregister));

  return router;
}
