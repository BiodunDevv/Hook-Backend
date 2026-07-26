import { createHash, randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { AccountStatus, AccountType } from '@lib/constants';
import { jwtSecret } from '@config/env';
import { AccountSession } from '@models/platform/session.model';
import { User } from '@models/users/user.model';
import { HttpError } from '@utils/http';
import { AuthUserPayload, signAccessToken, signRefreshToken } from './token.service';

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function refreshExpiry() {
  const raw = process.env.JWT_REFRESH_EXPIRY || '30d';
  const match = /^(\d+)([dhm])$/.exec(raw);
  if (!match) return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const amount = Number(match[1]);
  const unit = match[2] === 'd' ? 86400000 : match[2] === 'h' ? 3600000 : 60000;
  return new Date(Date.now() + amount * unit);
}

function safeUser(user: User) {
  return {
    id: user.id,
    publicId: user.publicId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    accountType: user.accountType,
    accountStatus: user.accountStatus,
    avatarUrl: user.avatarUrl,
    isEmailVerified: user.isEmailVerified,
  };
}

export async function issueAccountSession(
  user: User,
  metadata: { deviceId?: string; deviceName?: string; platform?: string; ipAddress?: string; userAgent?: string } = {},
) {
  const familyId = randomUUID();
  const session = new AccountSession({
    accountId: user.id,
    accountType: user.accountType || AccountType.CUSTOMER,
    familyId,
    refreshTokenHash: 'pending',
    ...metadata,
    expiresAt: refreshExpiry(),
    lastUsedAt: new Date(),
  });
  const payload: AuthUserPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    accountType: user.accountType || AccountType.CUSTOMER,
    sid: session.id,
    familyId,
  };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  session.refreshTokenHash = hash(refreshToken);
  await session.save();
  return { accessToken, refreshToken, user: safeUser(user) };
}

export async function rotateAccountSession(refreshToken: string) {
  let payload: AuthUserPayload;
  try {
    payload = jwt.verify(refreshToken, jwtSecret()) as AuthUserPayload;
  } catch {
    throw new HttpError(401, 'Invalid refresh token', undefined, 'TOKEN_INVALID');
  }
  if (!payload.sid || !payload.familyId) {
    throw new HttpError(401, 'Legacy session expired. Please sign in again.', undefined, 'TOKEN_INVALID');
  }
  const session = await AccountSession.findById(payload.sid);
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    throw new HttpError(401, 'Invalid refresh token', undefined, 'TOKEN_INVALID');
  }
  if (session.refreshTokenHash !== hash(refreshToken)) {
    await AccountSession.updateMany(
      { familyId: session.familyId, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date(), revocationReason: 'refresh_token_replay' } },
    );
    throw new HttpError(401, 'Session has been revoked', undefined, 'TOKEN_INVALID');
  }
  const user = await User.findById(session.accountId).lean({ virtuals: true }) as User | null;
  if (!user || !user.isActive || user.accountStatus !== AccountStatus.ACTIVE) {
    await revokeAccountSessions(session.accountId, 'account_inactive');
    throw new HttpError(401, 'Account is not active', undefined, 'TOKEN_INVALID');
  }
  const nextPayload = { ...payload, role: user.role, accountType: user.accountType };
  const nextRefresh = signRefreshToken(nextPayload);
  session.refreshTokenHash = hash(nextRefresh);
  session.lastUsedAt = new Date();
  await session.save();
  return {
    accessToken: signAccessToken(nextPayload),
    refreshToken: nextRefresh,
    user: safeUser(user),
  };
}

export async function revokeAccountSession(refreshToken?: string, sessionId?: string, reason = 'logout') {
  let id = sessionId;
  if (!id && refreshToken) {
    try {
      id = (jwt.verify(refreshToken, jwtSecret()) as AuthUserPayload).sid;
    } catch {
      return;
    }
  }
  if (id) {
    await AccountSession.updateOne(
      { _id: id, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date(), revocationReason: reason } },
    );
  }
}

export async function revokeAccountSessions(accountId: string, reason: string, actorId?: string) {
  await AccountSession.updateMany(
    { accountId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date(), revocationReason: reason, revokedBy: actorId } },
  );
}
