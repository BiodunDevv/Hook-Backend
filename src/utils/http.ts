import { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function success<T>(data: T, message = 'Success') {
  return {
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  };
}

export function created<T>(data: T, message = 'Created successfully') {
  return {
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
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
  res.json(success(data, message));
}

export function sendCreated<T>(res: Response, data: T, message?: string) {
  res.status(201).json(created(data, message));
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  const httpError = err instanceof HttpError ? err : null;
  const statusCode = httpError?.statusCode || 500;
  const message =
    httpError?.message ||
    (err instanceof Error ? err.message : 'Internal server error');

  if (statusCode >= 500) {
    console.error(err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    errors: httpError?.details,
    timestamp: new Date().toISOString(),
  });
}
