/**
 * Administrator program, web-only HR screens: dashboard, employee documents, shift roster, salary structure / statutory
 * rules, notifications and announcements, users with roles, audit log, company logo.
 */
import type { Request, Response } from 'express';
import * as users from '../services/adminUser.service';
import * as audit from '../services/audit.service';
import * as compoff from '../services/compoff.service';
import { dashboard } from '../services/dashboard.service';
import * as documents from '../services/document.service';
import { excel } from '../services/export.service';
import * as notifications from '../services/notification.service';
import * as roster from '../services/roster.service';
import * as salary from '../services/salaryStructure.service';
import * as settings from '../services/settings.service';
import { UserError } from '../utils/errors';
import { bodyIds, idParam, numQuery, sendDocument, sendFile } from '../utils/http';
import { permissions } from '../utils/permissions';
import { fmt, mustParse, today } from '../utils/time';

export const me = (req: Request, res: Response) => res.json({ user: req.user, role: req.role, permissions: permissions(req.role ?? 'Viewer') });

export const dashboardData = async (_req: Request, res: Response) => res.json(await dashboard());

// ---- documents
export async function documentUpload(req: Request, res: Response) {
  if (!req.file) throw new UserError('Choose a file.');
  res.json({ id: await documents.add(idParam(req), String(req.body.title ?? ''), req.file, req.user ?? 'HR') });
}
export const documentList = async (req: Request, res: Response) => res.json(await documents.list(idParam(req)));
export async function documentGet(req: Request, res: Response) {
  const d = await documents.get(idParam(req));
  sendDocument(res, d.buffer, d.name, d.type, req.query.inline === '1');
}
export async function documentRemove(req: Request, res: Response) {
  await documents.remove(idParam(req));
  res.json({ ok: true });
}

// ---- roster (rotating shifts)
export const rosterGrid = async (req: Request, res: Response) =>
  res.json(await roster.grid(mustParse(String(req.query.from)), mustParse(String(req.query.to)), numQuery(req.query.dept)));
export const rosterSave = async (req: Request, res: Response) =>
  res.json({ message: await roster.setCells(Array.isArray(req.body.cells) ? req.body.cells : []) });
export const rosterRotate = async (req: Request, res: Response) => res.json({ message: await roster.rotate(req.body) });
export const rosterClear = async (req: Request, res: Response) =>
  res.json({ message: await roster.clear(bodyIds(req), mustParse(String(req.body.from)), mustParse(String(req.body.to))) });

// ---- salary structure and statutory rules
export const components = async (_req: Request, res: Response) => res.json(await salary.loadComponents(false));
export async function componentSave(req: Request, res: Response) {
  await salary.saveComponent(req.body);
  res.json({ ok: true });
}
export async function componentRemove(req: Request, res: Response) {
  await salary.removeComponent(idParam(req));
  res.json({ ok: true });
}
export const statutory = async (_req: Request, res: Response) => res.json(await salary.loadStatutory());
export async function statutorySave(req: Request, res: Response) {
  await salary.saveStatutory(req.body);
  res.json({ message: 'Statutory rules saved.' });
}
export const structureOf = async (req: Request, res: Response) => res.json(await salary.employeeStructure(idParam(req)));

// ---- comp-off
export const compOffSettings = async (_req: Request, res: Response) => res.json({ expiryDays: await compoff.expiryDays() });
export async function compOffSettingsSave(req: Request, res: Response) {
  const d = Number(req.body.expiryDays);
  if (!Number.isInteger(d) || d < 1 || d > 730) throw new UserError('Comp-off validity must be 1 to 730 days.');
  await settings.setSetting('Leave.CompOffExpiryDays', String(d));
  res.json({ message: 'Saved.' });
}
export const compOffBalance = async (req: Request, res: Response) => res.json(await compoff.balance(idParam(req)));

// ---- notifications (HR) and announcements
export const notificationList = async (_req: Request, res: Response) => res.json(await notifications.list(null));
export async function notificationRead(req: Request, res: Response) {
  await notifications.markRead(null, req.body.all ? 'all' : bodyIds(req));
  res.json({ ok: true });
}
export const broadcast = async (req: Request, res: Response) =>
  res.json({ message: await notifications.broadcast(String(req.body.title ?? ''), String(req.body.body ?? ''), numQuery(req.body.departmentId)) });

// ---- users with roles
export const userList = async (_req: Request, res: Response) => res.json(await users.list());
export const userCreate = async (req: Request, res: Response) => res.json({ id: await users.save(null, req.body) });
export const userUpdate = async (req: Request, res: Response) => res.json({ id: await users.save(idParam(req), req.body) });
export async function userRemove(req: Request, res: Response) {
  await users.remove(idParam(req));
  res.json({ ok: true });
}

// ---- audit log
const auditArgs = (req: Request) => {
  const t = fmt(today(), 'yyyy-MM-dd');
  return [String(req.query.from || t), String(req.query.to || t), String(req.query.user ?? ''), String(req.query.q ?? '')] as const;
};
export const auditList = async (req: Request, res: Response) => res.json(await audit.list(...auditArgs(req)));
export async function auditExport(req: Request, res: Response) {
  const a = auditArgs(req);
  const rows = await audit.list(...a);
  const buffer = await excel({
    title: 'Audit Log', subtitle: `${a[0]} to ${a[1]}`, statusColumns: [],
    columns: ['When', 'User', 'Role', 'Action', 'Path', 'Details', 'IP'],
    rows: rows.map((r) => [r.When, r.UserName, r.Role, r.Action, r.Path, r.Details, r.Ip ?? '']),
  });
  sendFile(res, buffer, `Audit_Log_${a[0]}_${a[1]}.xlsx`);
}

// ---- company logo
export const logo = async (_req: Request, res: Response) => res.json({ logo: await settings.companyLogo() });
export async function logoSave(req: Request, res: Response) {
  await settings.saveCompanyLogo(String(req.body.logo ?? ''));
  res.json({ message: req.body.logo ? 'Logo saved.' : 'Logo removed.' });
}
