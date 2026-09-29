/** Raspberry Pi API (pi/lx50pi uploads punches and the user list, fetches commands, reports results). */
import type { Request, Response } from 'express';
import * as pi from '../services/pi.service';
import { UserError } from '../utils/errors';
import { idParam } from '../utils/http';

function serialOf(req: Request) {
  const serial = String(req.body?.device?.serial ?? '').trim();
  if (!serial) throw new UserError('device.serial missing');
  return serial;
}

export async function punches(req: Request, res: Response) {
  const r = await pi.receivePunches(serialOf(req), String(req.body.device?.name ?? ''), Array.isArray(req.body.punches) ? req.body.punches : []);
  res.json({ ok: true, ...r });
}

export async function users(req: Request, res: Response) {
  await pi.receiveUsers(serialOf(req), String(req.body.device?.name ?? ''), Array.isArray(req.body.users) ? req.body.users : []);
  res.json({ ok: true });
}

export async function commands(req: Request, res: Response) {
  const serial = String(req.query.device ?? '').trim();
  if (!serial) throw new UserError('device missing');
  res.json({ commands: await pi.pendingCommands(serial) });
}

export async function result(req: Request, res: Response) {
  await pi.saveResult(idParam(req), req.body ?? {});
  res.json({ ok: true });
}
