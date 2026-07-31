import { createHash, randomBytes } from 'crypto';
import { GuestSession } from '@models/platform/session.model';
import { HttpError } from '@utils/http';

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export async function createGuestSession(input: {
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const token = randomBytes(48).toString('base64url');
  const publicId = `GST-${randomBytes(8).toString('hex').toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await GuestSession.create({
    publicId,
    tokenHash: hash(token),
    ...input,
    expiresAt,
    lastSeenAt: new Date(),
  });
  return { token, guest: { publicId, expiresAt } };
}

export async function resolveGuestSession(token: string) {
  const session = await GuestSession.findOne({
    tokenHash: hash(token),
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  }).lean({ virtuals: true });
  if (!session) throw new HttpError(401, 'Guest session is invalid or expired', undefined, 'TOKEN_INVALID');
  await GuestSession.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } });
  return session;
}

export async function revokeGuestSession(token: string) {
  await GuestSession.updateOne(
    { tokenHash: hash(token), revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
}
