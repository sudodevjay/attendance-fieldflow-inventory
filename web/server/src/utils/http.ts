/** Small helpers for controllers. */
import type { Request, Response } from 'express';

/** Sends an Excel / PDF / JPEG file as a download. */
export function sendFile(res: Response, buf: Buffer, name: string) {
  const type = name.endsWith('.pdf') ? 'application/pdf'
    : name.endsWith('.jpg') ? 'image/jpeg' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/[^\w.\-]/g, '_')}"`);
  res.send(buf);
}

/** Sends a stored file (employee documents) with its own content type; `inline` opens it in the browser. */
export function sendDocument(res: Response, buf: Buffer, name: string, type: string, inline = false) {
  res.setHeader('Content-Type', type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\w.\-]/g, '_')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(buf);
}

/** Sends a picture stored as base64 JPEG (receipts). */
export function sendJpeg(res: Response, base64: string) {
  res.setHeader('Content-Type', 'image/jpeg');
  res.send(Buffer.from(base64, 'base64'));
}

/** Integer ids from `req.body.ids` (anything else is dropped). */
export const bodyIds = (req: Request): number[] => (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger);

/** Route parameter as a number. */
export const idParam = (req: Request, name = 'id') => parseInt(String(req.params[name]), 10);

/** Optional numeric query value (empty = null). */
export const numQuery = (v: unknown): number | null => (v === undefined || v === '' ? null : Number(v));

/** Bearer token of the request (header, or ?token= for links that open in a browser). */
export const bearer = (req: Request) => (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || String(req.query.token ?? '');
