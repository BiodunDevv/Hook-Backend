import jwt, { SignOptions } from 'jsonwebtoken';
import { UserRole } from '@lib/constants';

export interface AuthUserPayload {
  sub: string;
  email: string;
  role: UserRole;
}

export function signAccessToken(payload: AuthUserPayload) {
  const options: SignOptions = {
    expiresIn: (process.env.JWT_EXPIRY || '7d') as SignOptions['expiresIn'],
  };

  return jwt.sign(
    payload,
    process.env.JWT_SECRET || 'hook-dev-jwt-secret-change-in-production-12345',
    options,
  );
}

export function signRefreshToken(payload: AuthUserPayload) {
  const options: SignOptions = {
    expiresIn: (process.env.JWT_REFRESH_EXPIRY || '30d') as SignOptions['expiresIn'],
  };

  return jwt.sign(
    payload,
    process.env.JWT_SECRET || 'hook-dev-jwt-secret-change-in-production-12345',
    options,
  );
}
