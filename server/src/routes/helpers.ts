import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../core/util.js';

/** Wrap async handlers so rejections reach the error middleware. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export const actor = (req: Request): string => req.user?.username ?? 'unknown';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', code: 'validation_error', details: err.issues });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    return;
  }
  const e = err as any;
  if (e?.type === 'entity.too.large' || e?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'Payload too large', code: 'too_large' });
    return;
  }
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON body', code: 'bad_json' });
    return;
  }
  console.error('[api] unhandled error', err);
  res.status(500).json({ error: e?.message ?? 'Internal error', code: 'internal' });
}

export const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
