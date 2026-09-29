import type { Request, Response } from 'express';
import * as devices from '../services/device.service';
import { logsAfter, recordsAfter } from '../services/event.service';
import { bodyIds, idParam } from '../utils/http';

export const list = async (_req: Request, res: Response) => res.json(await devices.list());

/** Connection log and received records since the given ids (polled by the Machine List). */
export const events = (req: Request, res: Response) =>
  res.json({ logs: logsAfter(Number(req.query.log ?? 0)), records: recordsAfter(Number(req.query.rec ?? 0)) });

export const create = async (req: Request, res: Response) => res.json({ id: await devices.create(req.body) });

export async function update(req: Request, res: Response) {
  await devices.update(idParam(req), req.body);
  res.json({ ok: true });
}

export async function removeMany(req: Request, res: Response) {
  await devices.removeMany(bodyIds(req));
  res.json({ ok: true });
}

export const action = async (req: Request, res: Response) =>
  res.json({ message: await devices.action(idParam(req), String(req.body.action), req.user ?? '') });

export const commands = async (req: Request, res: Response) => res.json(await devices.commands(idParam(req)));
