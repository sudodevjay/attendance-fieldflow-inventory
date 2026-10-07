import type { Request, Response } from 'express';
import * as documents from '../services/document.service';
import * as requests from '../services/employeeRequest.service';
import * as portal from '../services/portal.service';
import * as portalAuth from '../services/portalAuth.service';
import * as sites from '../services/site.service';
import * as team from '../services/team.service';
import { UserError } from '../utils/errors';
import { bearer, idParam, sendDocument, sendFile, sendJpeg } from '../utils/http';
import { today, year } from '../utils/time';

const me = (req: Request) => req.employeeId!;
const yearOf = (req: Request) => Number(req.query.year ?? year(today()));

// ---- public
export const login = async (req: Request, res: Response) =>
  res.json(await portalAuth.login(String(req.body.enrollNo ?? ''), String(req.body.password ?? '')));
export const info = async (_req: Request, res: Response) => res.json(await portal.info());

// ---- logged in
export function logout(req: Request, res: Response) {
  portalAuth.logout(bearer(req));
  res.json({ ok: true });
}

export async function password(req: Request, res: Response) {
  await portalAuth.changePassword(me(req), String(req.body.current ?? ''), String(req.body.password ?? ''), String(req.body.confirm ?? ''));
  res.json({ message: 'Password changed.' });
}

export const profile = async (req: Request, res: Response) => res.json(await portal.profile(me(req)));
export const home = async (req: Request, res: Response) => res.json(await portal.home(me(req)));

export const checkIn = async (req: Request, res: Response) =>
  res.json({ message: await portal.checkIn(me(req), !!req.body.checkOut, String(req.body.source ?? 'web'), req.body) });
/** Work sites and GPS rules for the check-in screen. */
export const checkInInfo = async (req: Request, res: Response) => res.json(await sites.checkInInfo(me(req)));

export const attendance = async (req: Request, res: Response) => res.json(await portal.attendanceMonth(me(req), String(req.query.month ?? '')));

// ---- leave and holidays
export const leave = async (req: Request, res: Response) => res.json(await portal.leaveOverview(me(req), yearOf(req)));
export const applyLeave = async (req: Request, res: Response) => res.json({ message: await portal.applyLeave(me(req), req.body) });

export async function cancelLeave(req: Request, res: Response) {
  await portal.cancelLeave(me(req), idParam(req));
  res.json({ message: 'Leave request cancelled.' });
}

export const holidays = async (req: Request, res: Response) => res.json(await portal.holidays(yearOf(req)));

// ---- requests (regularisation, expense, advance)
export const requestList = async (req: Request, res: Response) => res.json(await requests.ofEmployee(me(req), String(req.query.type ?? '')));
export const requestCreate = async (req: Request, res: Response) => res.json({ message: await requests.create(me(req), req.body) });

export async function requestCancel(req: Request, res: Response) {
  await requests.cancel(me(req), idParam(req));
  res.json({ message: 'Request cancelled.' });
}

export async function requestAttachment(req: Request, res: Response) {
  const r = await requests.attachment(idParam(req));
  if (!r || !(await team.canSeeRequest(me(req), r.EmployeeId)) || !r.Attachment) throw new UserError('No receipt.', 404);
  sendJpeg(res, r.Attachment);
}

// ---- payroll
export async function payslip(req: Request, res: Response) {
  const f = await portal.payslip(me(req), String(req.query.month ?? ''));
  sendFile(res, f.buffer, f.name);
}

export const yearly = async (req: Request, res: Response) => res.json(await portal.yearly(me(req), yearOf(req)));
export const tax = async (req: Request, res: Response) =>
  res.json(await portal.tax(me(req), req.query.fy === undefined ? undefined : Number(req.query.fy)));

// ---- team (managers)
export const teamOverview = async (req: Request, res: Response) => res.json(await team.overview(me(req)));

export const teamDecide = async (req: Request, res: Response) =>
  res.json({ message: await team.decide(me(req), String(req.body.kind ?? ''), Number(req.body.id), req.body.decision === 'Approved',
    String(req.body.note ?? '').trim().slice(0, 200) || null) });

// ---- notifications, comp-off, documents
export const notifications = async (req: Request, res: Response) => res.json(await portal.notificationList(me(req)));

export async function notificationsRead(req: Request, res: Response) {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  await portal.notificationsRead(me(req), req.body.all ? 'all' : ids);
  res.json({ ok: true });
}

export const compOff = async (req: Request, res: Response) => res.json(await portal.compOffBalance(me(req)));
export const documentList = async (req: Request, res: Response) => res.json(await documents.list(me(req)));

export async function documentUpload(req: Request, res: Response) {
  if (!req.file) throw new UserError('Choose a file.');
  res.json({ id: await documents.add(me(req), String(req.body.title ?? ''), req.file, 'Employee (self)') });
}

export async function documentGet(req: Request, res: Response) {
  const d = await documents.get(idParam(req));
  if (d.employeeId !== me(req)) throw new UserError('Document not found.', 404);
  sendDocument(res, d.buffer, d.name, d.type, req.query.inline === '1');
}

export async function documentRemove(req: Request, res: Response) {
  await documents.remove(idParam(req), me(req));
  res.json({ message: 'Document deleted.' });
}
