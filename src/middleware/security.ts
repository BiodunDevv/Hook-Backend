import { NextFunction, Request, Response } from 'express';
import { HttpError } from '@utils/http';

type RateLimitOptions = {
  windowMs: number;
  max: number;
  message?: string;
};

const stores = new Map<string, Map<string, { count: number; resetAt: number }>>();

function clientKey(req: Request) {
  return `${req.ip || req.socket.remoteAddress || 'unknown'}:${req.user?.sub || 'anonymous'}`;
}

export function rateLimit(name: string, options: RateLimitOptions) {
  const bucket = stores.get(name) || new Map<string, { count: number; resetAt: number }>();
  stores.set(name, bucket);

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = clientKey(req);
    const entry = bucket.get(key);
    if (!entry || entry.resetAt <= now) {
      bucket.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }
    entry.count += 1;
    const remaining = Math.max(options.max - entry.count, 0);
    res.setHeader('X-RateLimit-Limit', String(options.max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
    if (entry.count > options.max) {
      return next(new HttpError(429, options.message || 'Too many requests. Please try again later.'));
    }
    return next();
  };
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== 'object') return value;
  const safe: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith('$') || key.includes('.')) continue;
    if (['__proto__', 'prototype', 'constructor'].includes(key)) continue;
    safe[key] = sanitizeValue(item);
  }
  return safe;
}

export function sanitizeRequest(req: Request, _res: Response, next: NextFunction) {
  if (req.body) req.body = sanitizeValue(req.body);
  if (req.query) {
    for (const key of Object.keys(req.query)) {
      if (key.startsWith('$') || key.includes('.') || ['__proto__', 'prototype', 'constructor'].includes(key)) {
        delete req.query[key];
      } else {
        (req.query as Record<string, unknown>)[key] = sanitizeValue(req.query[key]);
      }
    }
  }
  if (req.params) {
    for (const key of Object.keys(req.params)) {
      if (key.startsWith('$') || key.includes('.') || ['__proto__', 'prototype', 'constructor'].includes(key)) {
        delete req.params[key];
      }
    }
  }
  next();
}

export const generalLimiter = rateLimit('general', {
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_LIMIT_MAX || 600),
});

export const authLimiter = rateLimit('auth', {
  windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60_000),
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
  message: 'Too many authentication attempts. Please try again later.',
});

export const uploadLimiter = rateLimit('upload', {
  windowMs: Number(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS || 10 * 60_000),
  max: Number(process.env.UPLOAD_RATE_LIMIT_MAX || 40),
  message: 'Too many upload attempts. Please try again later.',
});
