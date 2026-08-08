import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_REQUIRED'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_INVALID'
  | 'ACCESS_DENIED'
  | 'SCOPE_DENIED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATE_TRANSITION'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'RUNNER_MARKET_ASSIGNMENT_REQUIRED'
  | 'MARKET_INACTIVE'
  | 'SUBMISSION_STATE_CONFLICT'
  | 'SUBMISSION_VALIDATION_FAILED'
  | 'SUBMISSION_REVIEW_CONFLICT'
  | 'PRODUCT_PUBLICATION_REQUIREMENTS_NOT_MET'
  | 'PRODUCT_PRICING_INVALID'
  | 'NEGOTIATION_DISABLED'
  | 'NEGOTIATION_OFFER_LIMIT_REACHED'
  | 'NEGOTIATION_QUOTE_EXPIRED'
  | 'NEGOTIATION_OWNERSHIP_REQUIRED'
  | 'OPENAI_PROVIDER_UNAVAILABLE'
  | 'MEDIA_PROVIDER_UNAVAILABLE'
  | 'PRICING_BOUNDARY_VIOLATION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'STATE_SCOPE_DENIED'
  | 'STALE_VERSION'
  | 'PRODUCT_NOT_AVAILABLE'
  | 'PRODUCT_VARIANT_UNAVAILABLE'
  | 'EMAIL_VERIFICATION_REQUIRED'
  | 'ADDRESS_OUTSIDE_COVERAGE'
  | 'ADDRESS_STATE_MISMATCH'
  | 'ADDRESS_LGA_MISMATCH'
  | 'CHECKOUT_STATE_UNAVAILABLE'
  | 'CHECKOUT_PREVIEW_INVALID'
  | 'CHECKOUT_PREVIEW_EXPIRED'
  | 'CHECKOUT_REVALIDATION_REQUIRED'
  | 'CART_EMPTY'
  | 'CART_VERSION_CHANGED'
  | 'POLICY_ACCEPTANCE_REQUIRED'
  | 'POD_NOT_ELIGIBLE'
  | 'PAYMENT_METHOD_NOT_ALLOWED'
  | 'DELIVERY_METHOD_NOT_ALLOWED'
  | 'PAYMENT_INITIALIZATION_NOT_ALLOWED'
  | 'PAYMENT_PROVIDER_UNAVAILABLE'
  | 'PAYMENT_PROVIDER_ERROR'
  | 'PAYMENT_RECORD_MISSING'
  | 'PAYMENT_EVIDENCE_MISMATCH'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'POD_CONFIRMATION_REQUIRED'
  | 'POD_OVERRIDE_REQUIRED'
  | 'ORDER_NOT_COMPLETE'
  | 'HUB_MISMATCH'
  | 'PAYMENT_REQUIRED'
  | 'PAYMENT_NOT_CAPTURED'
  | 'PROVIDER_NOT_READY'
  | 'CUSTODY_EXPIRED'
  | 'RETURN_WINDOW_CLOSED'
  | 'REFUND_LIMIT_EXCEEDED'
  | 'MARKET_VENDOR_INVALID'
  | 'MARKET_VENDOR_REQUIRED'
  | 'MARKET_VENDOR_DUPLICATE'
  | 'VENDOR_COLLECTION_EXISTS'
  | 'VENDOR_PAYMENT_MISSING'
  | 'AVAILABILITY_CHECK_NOT_PENDING'

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
    public code: ErrorCode = statusCode === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR',
  ) {
    super(message);
  }
}

function responseMeta(requestId: string, pagination?: Record<string, number>) {
  return {
    requestId,
    timestamp: new Date().toISOString(),
    ...(pagination ? { pagination } : {}),
  };
}

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const requestId = req.header('x-request-id')?.trim() || randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

function extractPagination(data: unknown) {
  if (!data || typeof data !== 'object') return undefined;
  const value = data as Record<string, unknown>;
  if (![value.page, value.limit, value.total, value.totalPages].every((item) => typeof item === 'number')) {
    return undefined;
  }
  return {
    page: value.page as number,
    limit: value.limit as number,
    total: value.total as number,
    totalPages: value.totalPages as number,
  };
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function sendSuccess<T>(res: Response, data: T, message?: string) {
  const req = res.req;
  res.json({
    success: true,
    ...(message ? { message } : {}),
    data,
    meta: responseMeta(req.requestId || randomUUID(), extractPagination(data)),
  });
}

export function sendCreated<T>(res: Response, data: T, message?: string) {
  const req = res.req;
  res.status(201).json({
    success: true,
    ...(message ? { message } : {}),
    data,
    meta: responseMeta(req.requestId || randomUUID(), extractPagination(data)),
  });
}

export function sendError(
  res: Response,
  statusCode: number,
  code: ErrorCode,
  message: string,
  details?: unknown,
) {
  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
    meta: responseMeta(res.req.requestId || randomUUID()),
  });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  const httpError = err instanceof HttpError ? err : null;
  const statusCode = httpError?.statusCode || 500;
  const message = httpError?.message || 'Internal server error';

  if (statusCode >= 500) {
    console.error(err);
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code: httpError?.code || 'INTERNAL_ERROR',
      message,
      ...(httpError?.details === undefined ? {} : { details: httpError.details }),
    },
    meta: responseMeta(_req.requestId || randomUUID()),
  });
}
