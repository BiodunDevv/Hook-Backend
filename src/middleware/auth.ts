import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@lib/constants';
import { HttpError } from '@utils/http';

interface TokenPayload {
  sub: string;
  email: string;
  role: UserRole;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization') || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new HttpError(401, 'Authentication token required'));
  }

  try {
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET || 'hook-dev-jwt-secret-change-in-production-12345',
    ) as TokenPayload;

    req.user = {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
    };
    return next();
  } catch {
    return next(new HttpError(401, 'Invalid or expired token'));
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next();

  try {
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET || 'hook-dev-jwt-secret-change-in-production-12345',
    ) as TokenPayload;
    req.user = {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
    };
  } catch {
    req.user = undefined;
  }

  next();
}
