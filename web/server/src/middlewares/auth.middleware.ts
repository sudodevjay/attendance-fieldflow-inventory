/** Who may call which API: the administrator (Supervisor), an employee (portal / app) or a Raspberry Pi. */
import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import * as audit from '../services/audit.service';
import { hasPassword, NO_PASSWORD_REMOTE, sessionUser } from '../services/auth.service';
import { piToken } from '../services/pi.service';
import { sessionEmployee } from '../services/portalAuth.service';
import { bearer } from '../utils/http';
import { allowed, type Role } from '../utils/permissions';

declare module 'express-serve-static-core' {
  interface Request {
    /** Administrator user name and role (requireAdmin). */
    user?: string;
    role?: Role;
    /** Logged-in employee (requireEmployee). */
    employeeId?: number;
  }
}

/** Requests from the server PC itself. */
export const isLocal = (req: Request) => /^(::1|127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+)$/.test(req.socket.remoteAddress ?? '');

/** Administrator program. Without a Supervisor password it is open on the server PC only. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const s = sessionUser(bearer(req));
  if (s) {
    req.user = s.user;
    req.role = s.role;
    return next();
  }
  try {
    if (!(await hasPassword())) {
      if (isLocal(req)) { req.user = 'Supervisor'; req.role = 'Admin'; return next(); }
      return void res.status(403).json({ error: NO_PASSWORD_REMOTE });
    }
  } catch (e) { return next(e); }
  res.status(401).json({ error: 'Please log in.' });
}

/** The role of the logged-in user must allow this call (utils/permissions). */
export function authorize(req: Request, res: Response, next: NextFunction) {
  const role = req.role ?? 'Viewer';
  if (allowed(role, req.method, req.path)) return next();
  res.status(403).json({ error: `Your role (${role}) cannot ${req.method === 'GET' ? 'open' : 'change'} this. Ask an Admin.` });
}

/**
 * Writes changes (anything but GET) to the audit log after the response is sent: those that succeeded, and with
 * `failures` also refused ones (failed logins).
 */
export function auditTrail(who: (req: Request) => string | Promise<string>, role: (req: Request) => string | null, failures = false) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      const details = audit.summarize(req.body);
      res.on('finish', async () => {
        if (res.statusCode >= 400 && !failures) return;
        const note = res.statusCode >= 400 ? `FAILED (${res.statusCode})${details ? ' ' + details : ''}` : details;
        try {
          await audit.write(await who(req), role(req), req.method, req.originalUrl, note, req.socket.remoteAddress ?? '');
        } catch (e) { console.error('audit log not written:', e); }
      });
    }
    next();
  };
}

/** Employee portal and mobile app. */
export function requireEmployee(req: Request, res: Response, next: NextFunction) {
  const id = sessionEmployee(bearer(req));
  if (id === null) return void res.status(401).json({ error: 'Please log in.' });
  req.employeeId = id;
  next();
}

/** Raspberry Pi API: Bearer <Pi.Token>. */
export async function requirePiToken(req: Request, res: Response, next: NextFunction) {
  try {
    const got = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const want = await piToken();
    if (got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return next();
    res.status(401).json({ error: 'wrong token' });
  } catch (e) { next(e); }
}
