import type { Request, Response } from 'express';
import * as departments from '../services/department.service';
import { idParam } from '../utils/http';

export const list = async (_req: Request, res: Response) => res.json(await departments.list());

export const create = async (req: Request, res: Response) =>
  res.json({ id: await departments.create(String(req.body.name ?? ''), req.body.parentId ?? null) });

/** Rename (`name`) and / or move (`parentId`). */
export async function update(req: Request, res: Response) {
  const id = idParam(req);
  if (req.body.name !== undefined) await departments.rename(id, String(req.body.name));
  if (req.body.parentId !== undefined) await departments.move(id, req.body.parentId === null ? null : Number(req.body.parentId));
  res.json({ ok: true });
}

export async function remove(req: Request, res: Response) {
  await departments.remove(idParam(req));
  res.json({ ok: true });
}
