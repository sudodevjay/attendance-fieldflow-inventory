import type { Request, Response } from 'express';
import * as punches from '../services/punch.service';
import { UserError } from '../utils/errors';
import { bodyIds, numQuery, sendFile } from '../utils/http';

const filter = (req: Request): punches.PunchFilter => ({
  from: String(req.query.from ?? ''), to: String(req.query.to ?? ''), employeeId: numQuery(req.query.emp),
});

export const list = async (req: Request, res: Response) => res.json(await punches.list(filter(req)));

export async function exportExcel(req: Request, res: Response) {
  const f = await punches.exportExcel(filter(req));
  sendFile(res, f.buffer, f.name);
}

export async function addManual(req: Request, res: Response) {
  await punches.addManual(Number(req.body.employeeId), String(req.body.time ?? ''), !!req.body.checkOut, String(req.body.remark ?? ''));
  res.json({ ok: true });
}

export const removeMany = async (req: Request, res: Response) => res.json({ deleted: await punches.removeMany(bodyIds(req)) });

export async function importFile(req: Request, res: Response) {
  if (!req.file) throw new UserError('Choose a file.');
  res.json({ message: await punches.importFile(req.file.buffer.toString('utf8')) });
}
