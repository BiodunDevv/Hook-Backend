import { describe, expect, it } from '@jest/globals';
import { NextFunction, Request, Response } from 'express';
import { errorHandler, HttpError, requestContext, sendSuccess } from './http';

function responseMock() {
  const response = {
    req: { requestId: 'request-123' },
    statusCode: 200,
    headers: {} as Record<string, string>,
    payload: undefined as unknown,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.payload = payload; return this; },
  };
  return response as unknown as Response & typeof response;
}

describe('Phase 2 API envelope', () => {
  it('returns success data with request metadata', () => {
    const res = responseMock();
    sendSuccess(res, { ready: true });
    expect(res.payload).toMatchObject({
      success: true,
      data: { ready: true },
      meta: { requestId: 'request-123' },
    });
    expect(res.payload).not.toHaveProperty('message');
  });

  it('returns stable error codes without a legacy top-level message', () => {
    const res = responseMock();
    errorHandler(
      new HttpError(403, 'Outside scope', undefined, 'SCOPE_DENIED'),
      { requestId: 'request-123' } as Request,
      res,
      (() => undefined) as NextFunction,
    );
    expect(res.statusCode).toBe(403);
    expect(res.payload).toMatchObject({
      success: false,
      error: { code: 'SCOPE_DENIED', message: 'Outside scope' },
      meta: { requestId: 'request-123' },
    });
    expect(res.payload).not.toHaveProperty('message');
  });

  it('accepts a caller request ID and returns it in the response header', () => {
    const req = { header: () => 'caller-request-id' } as unknown as Request;
    const res = responseMock();
    requestContext(req, res, (() => undefined) as NextFunction);
    expect(req.requestId).toBe('caller-request-id');
    expect(res.headers['X-Request-Id']).toBe('caller-request-id');
  });
});
