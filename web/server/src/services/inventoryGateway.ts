/**
 * The inventory is its own service with its own database (inventory-api/). This server stays the one door of the app:
 * it checks the login, the role and the HOD's departments, writes the audit log and forwards /api/inventory/* and
 * /api/portal/store/* to the inventory service with the caller's identity. The two talk only over HTTP:
 *   this → inventory   forwarded requests (X-Service-Token, X-User, X-Role, X-User-Id, X-Scope-Departments, X-Employee-Id,
 *                      X-Directory-Version)
 *   inventory → this   /api/internal/directory (employees, departments, work sites, company) and /api/internal/notifications
 * INVENTORY_URL (default http://localhost:4100) and SERVICE_TOKEN (the same secret on both) come from the environment.
 */
import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { scopeDepartments } from '../utils/scope';

export const INVENTORY_URL = (process.env.INVENTORY_URL || 'http://localhost:4100').replace(/\/+$/, '');
const TOKEN = process.env.SERVICE_TOKEN || '';

// Version of the data the inventory copies (employees, departments, sites): a change in this server makes it fetch again.
let version = `${Date.now()}`;
let n = 0;
export const directoryVersion = () => version;
const bump = () => { version = `${Date.now()}-${++n}`; };

/** Any successful change in this server (not the forwarded inventory calls) may touch employees / departments / sites. */
export function trackChanges(req: Request, res: Response, next: NextFunction) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && !/^\/(inventory|portal\/store|internal)(\/|$)/.test(req.path))
    res.on('finish', () => { if (res.statusCode < 400) bump(); });
  next();
}

/** The inventory service calling this server's /api/internal. */
export function requireService(req: Request, res: Response, next: NextFunction) {
  const got = String(req.headers['x-service-token'] ?? '');
  if (TOKEN && got.length === TOKEN.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(TOKEN))) return next();
  res.status(401).json({ error: 'service token needed' });
}

/** Forwards the request to the inventory service as the logged-in administrator user / employee. */
export function forward(kind: 'admin' | 'employee') {
  return async (req: Request, res: Response) => {
    if (!TOKEN) return void res.status(503).json({ error: 'The inventory service is not set up on this server (SERVICE_TOKEN, INVENTORY_URL).' });
    const headers: Record<string, string> = { 'X-Service-Token': TOKEN, 'X-Directory-Version': version, 'X-Forwarded-For': req.ip ?? '' };
    if (kind === 'admin') {
      headers['X-User'] = encodeURIComponent(req.user ?? '');
      headers['X-Role'] = req.role ?? 'Viewer';
      if (req.userId) headers['X-User-Id'] = String(req.userId);
      const sc = scopeDepartments();
      if (sc) headers['X-Scope-Departments'] = [...sc].join(',');
    } else headers['X-Employee-Id'] = String(req.employeeId ?? '');
    let body: any;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.is('application/json') || req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(req.body ?? {});
      } else {
        // multipart (Excel import): the raw request goes on as it came
        if (req.headers['content-type']) headers['Content-Type'] = String(req.headers['content-type']);
        if (req.headers['content-length']) headers['Content-Length'] = String(req.headers['content-length']);
        body = req;
      }
    }
    try {
      const r = await fetch(INVENTORY_URL + req.originalUrl, {
        method: req.method, headers, body, signal: AbortSignal.timeout(120_000), ...(body === req ? { duplex: 'half' } : {}),
      } as RequestInit);
      res.status(r.status);
      for (const h of ['content-type', 'content-disposition', 'cache-control']) { const v = r.headers.get(h); if (v) res.setHeader(h, v); }
      res.send(Buffer.from(await r.arrayBuffer()));
    } catch (e: any) {
      console.error('inventory service:', e.message ?? e);
      res.status(502).json({ error: 'The inventory service cannot be reached. If it was asleep (free plan) it starts within a minute: try again.' });
    }
  };
}
