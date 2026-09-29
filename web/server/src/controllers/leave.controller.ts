import type { Request, Response } from 'express';
import * as holidays from '../services/holiday.service';
import * as leave from '../services/leave.service';
import * as leaveTypes from '../services/leaveType.service';
import { bodyIds, sendFile } from '../utils/http';
import { today, year } from '../utils/time';

const yearOf = (req: Request) => Number(req.query.year ?? year(today()));

export const entries = async (req: Request, res: Response) => res.json(await leave.list(yearOf(req)));
export const lastApprover = async (_req: Request, res: Response) => res.json({ name: await leave.lastApprover() });
export const save = async (req: Request, res: Response) => res.json(await leave.save(req.body));

export const decide = async (req: Request, res: Response) =>
  res.json(await leave.decide(bodyIds(req), req.body.decision === 'Approved', String(req.body.by ?? ''),
    (Array.isArray(req.body.confirmed) ? req.body.confirmed : []).map(Number)));

export async function removeMany(req: Request, res: Response) {
  await leave.removeMany(bodyIds(req));
  res.json({ ok: true });
}

export const balance = async (req: Request, res: Response) => res.json(await leave.balance(yearOf(req)));

export async function balanceExcel(req: Request, res: Response) {
  const f = await leave.balanceExcel(yearOf(req));
  sendFile(res, f.buffer, f.name);
}

export const holidayList = async (req: Request, res: Response) => res.json(await holidays.list(yearOf(req)));

export async function holidaySave(req: Request, res: Response) {
  await holidays.save(req.body.Id ? Number(req.body.Id) : null, String(req.body.Date ?? ''), String(req.body.Name ?? ''));
  res.json({ ok: true });
}

export async function holidayRemove(req: Request, res: Response) {
  await holidays.removeMany(bodyIds(req));
  res.json({ ok: true });
}

export const typeList = async (_req: Request, res: Response) => res.json(await leaveTypes.list());

export async function typeSave(req: Request, res: Response) {
  await leaveTypes.save(req.body);
  res.json({ ok: true });
}
