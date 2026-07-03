import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';
import { HttpError } from '@utils/http';

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return next(new HttpError(400, 'Invalid request body', parsed.error.flatten()));
    }
    req.body = parsed.data;
    return next();
  };
}
