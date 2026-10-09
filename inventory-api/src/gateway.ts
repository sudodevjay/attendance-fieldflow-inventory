/**
 * Who is calling. Only the attendance server calls this service (it holds the login): it checks the user, the role and
 * the HOD's departments, writes the audit log, and forwards the request with X-Service-Token and the identity headers
 *   X-User, X-Role, X-User-Id            administrator program
 *   X-Scope-Departments                  HOD: the departments they may see (comma separated; absent = all)
 *   X-Employee-Id                        employee portal / app
 *   X-Directory-Version                  attendance's data version (employees, departments, sites)
 */
import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { ensureDirectory } from './attendance';
import { config } from './config';
import { runInScope } from './utils/scope';

declare module 'express-serve-static-core' {
  interface Request {
    user?: string;
    role?: string;
    userId?: number | null;
    employeeId?: number;
  }
}

function trusted(req: Request) {
  const got = String(req.headers['x-service-token'] ?? '');
  const want = config.serviceToken;
  return !!want && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export function fromGateway(kind: 'admin' | 'employee') {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!trusted(req)) return void res.status(401).json({ error: 'Open the inventory through the attendance app.' });
    try {
      await ensureDirectory(String(req.headers['x-directory-version'] ?? '') || null);
    } catch {
      return void res.status(503).json({ error: 'The attendance server cannot be reached (employees, departments).' });
    }
    if (kind === 'employee') {
      const id = Number(req.headers['x-employee-id']);
      if (!id) return void res.status(401).json({ error: 'Please log in.' });
      req.employeeId = id;
      return next();
    }
    const role = String(req.headers['x-role'] ?? '');
    if (!role) return void res.status(401).json({ error: 'Please log in.' });
    req.user = decodeURIComponent(String(req.headers['x-user'] ?? '')) || 'Store';
    req.role = role;
    req.userId = Number(req.headers['x-user-id']) || null;
    const sc = req.headers['x-scope-departments'];
    if (sc === undefined) return next();
    const ids = String(sc).split(',').map(Number).filter((n) => n > 0);
    runInScope({ departmentIds: new Set(ids), employeeIds: null, enrollNos: null }, next);
  };
}
