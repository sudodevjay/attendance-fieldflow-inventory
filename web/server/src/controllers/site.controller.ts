import type { Request, Response } from 'express';
import * as sites from '../services/site.service';
import { UserError } from '../utils/errors';
import { idParam, numQuery, sendJpeg } from '../utils/http';
import { assertInScope } from '../utils/scope';

export const list = async (_req: Request, res: Response) => res.json(await sites.list());
export const create = async (req: Request, res: Response) => res.json({ id: await sites.save(null, req.body) });
export const update = async (req: Request, res: Response) => res.json({ id: await sites.save(idParam(req), req.body) });

export async function remove(req: Request, res: Response) {
  await sites.remove(idParam(req));
  res.json({ ok: true });
}

export const punches = async (req: Request, res: Response) =>
  res.json(await sites.punches(String(req.query.from ?? ''), String(req.query.to ?? ''), numQuery(req.query.site)));

/** Selfie of a site punch (?who=employee: the employee's own photo, to compare). */
export async function photo(req: Request, res: Response) {
  const p = await sites.photo(idParam(req));
  if (!p) throw new UserError('Not found.', 404);
  assertInScope(p.EmployeeId);
  const r = req.query.who === 'employee' ? await sites.employeePhoto(p.EmployeeId) : p;
  if (!r?.Photo) throw new UserError('No photo.', 404);
  sendJpeg(res, r.Photo);
}
