import type { Request, Response } from 'express';
import * as shifts from '../services/shift.service';
import { bodyIds, idParam, numQuery } from '../utils/http';

export const list = async (_req: Request, res: Response) => res.json(await shifts.list());
export const create = async (req: Request, res: Response) => res.json({ id: await shifts.create(req.body) });

export async function update(req: Request, res: Response) {
  await shifts.update(idParam(req), req.body);
  res.json({ ok: true });
}

export async function remove(req: Request, res: Response) {
  await shifts.remove(idParam(req));
  res.json({ ok: true });
}

export const schedule = async (req: Request, res: Response) => res.json(await shifts.schedule(numQuery(req.query.dept)));

export const assign = async (req: Request, res: Response) =>
  res.json({ message: await shifts.assign(bodyIds(req), req.body.shiftId ?? null) });
