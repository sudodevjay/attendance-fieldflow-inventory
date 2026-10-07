import type { Request, Response } from 'express';
import * as requests from '../services/employeeRequest.service';
import * as accounts from '../services/portalAccount.service';
import { UserError } from '../utils/errors';
import { assertInScope } from '../utils/scope';
import { bodyIds, idParam, sendJpeg } from '../utils/http';

export const accountList = async (_req: Request, res: Response) => res.json(await accounts.list());
export const accountCreate = async (req: Request, res: Response) =>
  res.json({ accounts: await accounts.createOrReset(bodyIds(req), String(req.body.password ?? '')) });

export async function accountUpdate(req: Request, res: Response) {
  // Older clients send isManager: true / false.
  const role = req.body.role ?? (req.body.isManager === undefined ? undefined : req.body.isManager ? 'Manager' : 'Employee');
  await accounts.setRole(idParam(req), role);
  res.json({ ok: true });
}

export async function accountRemove(req: Request, res: Response) {
  await accounts.removeMany(bodyIds(req));
  res.json({ ok: true });
}

export const requestList = async (req: Request, res: Response) =>
  res.json(await requests.adminList(String(req.query.status ?? ''), String(req.query.type ?? '')));

export async function requestAttachment(req: Request, res: Response) {
  const r = await requests.attachment(idParam(req));
  if (!r?.Attachment) throw new UserError('No receipt.', 404);
  assertInScope(r.EmployeeId);
  sendJpeg(res, r.Attachment);
}

export const requestDecide = async (req: Request, res: Response) =>
  res.json({ message: await requests.decideMany(bodyIds(req), req.body.decision === 'Approved', String(req.body.by ?? ''), String(req.body.note ?? '')) });

export const settings = async (_req: Request, res: Response) => res.json(await accounts.settings());

export async function saveSettings(req: Request, res: Response) {
  await accounts.saveSettings(!!req.body.allowCheckIn, String(req.body.officeName ?? ''),
    req.body.checkInAtSite === undefined ? undefined : !!req.body.checkInAtSite, Number(req.body.maxGpsAccuracy) || undefined);
  res.json({ message: 'Saved.' });
}
