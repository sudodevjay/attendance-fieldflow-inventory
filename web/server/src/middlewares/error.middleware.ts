import type { NextFunction, Request, Response } from 'express';
import { UserError } from '../utils/errors';

/** Unknown /api path. */
export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Not found' });
}

/** UserError = message for the user (4xx); anything else is logged and returned as 500. */
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof UserError) return void res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.too.large') return void res.status(413).json({ error: 'The data is too large.' });
  console.error(err);
  res.status(500).json({ error: err?.message ?? String(err) });
}
