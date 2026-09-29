import type { Request, Response } from 'express';
import { isLocal } from '../middlewares/auth.middleware';
import * as auth from '../services/auth.service';
import { companyName } from '../services/settings.service';
import { bearer } from '../utils/http';
import { fmt, today } from '../utils/time';

export const status = async (_req: Request, res: Response) =>
  res.json({ passwordRequired: await auth.hasPassword(), company: await companyName(), today: fmt(today(), 'd/M/yyyy') });

export const login = async (req: Request, res: Response) =>
  res.json(await auth.login(String(req.body.user ?? ''), String(req.body.password ?? ''), isLocal(req)));

export function logout(req: Request, res: Response) {
  auth.logout(bearer(req));
  res.json({ ok: true });
}

