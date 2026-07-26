import { Router } from 'express';
import { z } from 'zod';
import { createGuestSession, resolveGuestSession, revokeGuestSession } from '@services/guest-session.service';
import { asyncHandler, sendCreated, sendSuccess } from '@utils/http';
import { validateBody } from '@middleware/validate';

const schema = z.object({
  deviceId: z.string().max(200).optional(),
  deviceName: z.string().max(200).optional(),
  platform: z.enum(['ios', 'android', 'web', 'unknown']).default('unknown'),
});

export function createGuestSessionRouter() {
  const router = Router();
  router.post('/', validateBody(schema), asyncHandler(async (req, res) => {
    sendCreated(res, await createGuestSession({
      ...req.body,
      ipAddress: req.ip,
      userAgent: req.header('user-agent'),
    }));
  }));
  router.get('/current', asyncHandler(async (req, res) => {
    const token = req.header('x-guest-session');
    if (!token) return sendSuccess(res, null);
    sendSuccess(res, await resolveGuestSession(token));
  }));
  router.delete('/current', asyncHandler(async (req, res) => {
    const token = req.header('x-guest-session');
    if (token) await revokeGuestSession(token);
    sendSuccess(res, { revoked: true });
  }));
  return router;
}
