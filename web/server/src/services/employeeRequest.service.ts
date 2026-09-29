/**
 * Employee requests besides leave (EmployeeRequests table): attendance regularisation (an approved one adds the punch to
 * AttendanceLogs, source Manual), expense claims with a receipt photo, advances / loans, overtime (approved hours are paid
 * when overtime needs approval), comp-off credits for work on a holiday / weekly off, and profile changes (applied to the
 * employee record when HR approves). The approvers and HR get a notification; the employee gets the decision.
 */
import { exec, one, query } from '../config/db';
import { LEAVE_STATUS } from '../models';
import { UserError } from '../utils/errors';
import { money } from '../utils/format';
import { dateOf, fmt, mustParse, now, parse, sqlD, sqlDT, today } from '../utils/time';
import * as compoff from './compoff.service';
import { dateText } from './employeeView.service';
import { approversOf } from './hierarchy.service';
import { notify } from './notification.service';
import { checkProfileFields, saveProfile, TEXT_FIELDS } from './profile.service';
import { PunchSource } from './sync.service';

export const REQUEST_TYPES = ['Regularisation', 'Expense', 'Advance', 'Overtime', 'CompOff', 'Profile'] as const;

const TYPE_NAMES: Record<string, string> = {
  Regularisation: 'Attendance regularisation', Expense: 'Expense claim', Advance: 'Advance request', Overtime: 'Overtime request',
  CompOff: 'Comp-off request', Profile: 'Profile change',
};

/** Fields of the Employees table the employee may ask to change (the rest are in EmployeeProfiles). */
const EMPLOYEE_FIELDS: Record<string, number> = { Phone: 20, Email: 100, HomeAddress: 250 };
/** HR-only fields an employee cannot ask to change. */
const HR_ONLY = ['PfNo', 'EsiNo'];
export const SELF_FIELDS = [...Object.keys(EMPLOYEE_FIELDS), ...Object.keys(TEXT_FIELDS).filter((k) => !HR_ONLY.includes(k))];

async function rows(where: string, params: Record<string, unknown>) {
  const list = await query(`SELECT r.Id, r.EmployeeId, e.EnrollNo, e.Name, r.Type, CONVERT(varchar(10), r.RequestDate, 120) RequestDate,
      CONVERT(varchar(19), r.PunchTime, 120) PunchTime, r.Category, CAST(r.Amount AS float) Amount, r.Installments, r.Details,
      CASE WHEN r.Attachment IS NULL THEN 0 ELSE 1 END HasAttachment, r.Payload, r.Status, r.DecidedBy, CONVERT(varchar(10), r.DecidedOn, 120) DecidedOn,
      r.DecisionNote, CONVERT(varchar(19), r.CreatedAt, 120) CreatedAt
    FROM EmployeeRequests r JOIN Employees e ON e.Id = r.EmployeeId WHERE ${where} ORDER BY r.CreatedAt DESC`, params);
  return list.map(({ Payload, ...r }) => ({
    ...r, Changes: Payload ? JSON.parse(Payload) as Record<string, string> : null, TypeName: TYPE_NAMES[r.Type] ?? r.Type,
    Status: LEAVE_STATUS[r.Status] ?? '', HasAttachment: !!r.HasAttachment, Date: dateText(parse(r.RequestDate)),
    Time: r.PunchTime ? fmt(parse(r.PunchTime)!, 'HH:mm') : '', AmountText: r.Amount !== null ? money(r.Amount) : '',
    Applied: dateText(parse(r.CreatedAt)), DecidedOn: dateText(parse(r.DecidedOn)),
  }));
}

export type RequestRow = Awaited<ReturnType<typeof rows>>[number];

/** Own requests, optionally one type. */
export const ofEmployee = (employeeId: number, type = '') =>
  rows(`r.EmployeeId = @id${type ? ' AND r.Type = @t' : ''}`, { id: employeeId, t: type });

/** Requests of a team: pending ones, or all of the last 60 days. */
export const ofEmployees = (ids: number[], mode: 'pending' | 'recent') => (ids.length
  ? rows(`r.EmployeeId IN (SELECT value FROM OPENJSON(@ids)) AND ${mode === 'pending' ? 'r.Status = 0' : 'r.CreatedAt >= DATEADD(day, -60, SYSDATETIME())'}`, { ids })
  : Promise.resolve([] as RequestRow[]));

/** Employee Portal → Employee Requests: filter by status (Pending / Approved / Rejected, '' = all) and type. */
export function adminList(status: string, type: string) {
  const st = status === '' ? null : LEAVE_STATUS.indexOf(status as any);
  return rows(`(@st IS NULL OR r.Status = @st) AND (@t = '' OR r.Type = @t)`, { st, t: type });
}

export interface RequestInput {
  Type?: unknown; Date?: unknown; Time?: unknown; CheckOut?: unknown; Category?: unknown; Amount?: unknown; Installments?: unknown;
  Details?: unknown; Attachment?: unknown; Hours?: unknown; Changes?: unknown;
}

export async function create(employeeId: number, b: RequestInput) {
  const type = String(b.Type);
  if (!(REQUEST_TYPES as readonly string[]).includes(type)) throw new UserError('Unknown request type.');
  const details = String(b.Details ?? '').trim().slice(0, 500);
  const p: Record<string, unknown> = { id: employeeId, type, date: sqlD(today()), pt: null, cat: null, amt: null, inst: null, det: details, att: null, pl: null };

  if (type === 'Overtime') {
    const day = mustParse(String(b.Date), 'date');
    if (day > today() + 30 * 86_400_000) throw new UserError('Overtime can be asked for at most 30 days ahead.');
    const hours = Number(b.Hours ?? b.Amount);
    if (!(hours >= 0.5 && hours <= 16)) throw new UserError('Overtime hours must be 0.5 to 16.');
    if (!details) throw new UserError('Please write what the overtime is for.');
    if (await one("SELECT TOP 1 Id FROM EmployeeRequests WHERE EmployeeId = @id AND Type = 'Overtime' AND RequestDate = @d AND Status IN (0, 1)", { id: employeeId, d: sqlD(day) }))
      throw new UserError('You already asked for overtime on this day.');
    p.date = sqlD(day); p.amt = Math.round(hours * 100) / 100;
  } else if (type === 'CompOff') {
    const day = mustParse(String(b.Date), 'date');
    const c = await compoff.claimable(employeeId, day);
    if (await one("SELECT TOP 1 Id FROM EmployeeRequests WHERE EmployeeId = @id AND Type = 'CompOff' AND RequestDate = @d AND Status IN (0, 1)", { id: employeeId, d: sqlD(day) }))
      throw new UserError('A comp-off for this day was already asked for.');
    p.date = sqlD(day); p.amt = Number(b.Amount) === 0.5 ? 0.5 : c.days; p.det = details || 'Worked on holiday / weekly off';
  } else if (type === 'Profile') {
    const changes = profileChanges(b.Changes);
    if (!Object.keys(changes).length) throw new UserError('Nothing was changed.');
    // Same checks as when HR saves it (PAN, IFSC … formats), without saving.
    checkProfileFields(changes);
    p.pl = JSON.stringify(changes); p.det = (details || 'Change: ' + Object.keys(changes).join(', ')).slice(0, 500);
  } else if (type === 'Regularisation') {
    const t = mustParse(`${b.Date} ${b.Time}`, 'date / time');
    if (t > now()) throw new UserError('The punch time cannot be in the future.');
    if (!details) throw new UserError('Please write the reason (e.g. forgot to punch, was at a client site).');
    p.date = sqlD(dateOf(t)); p.pt = sqlDT(t); p.cat = b.CheckOut ? 'Check-Out' : 'Check-In';
  } else {
    const amount = Number(b.Amount);
    if (!(amount > 0 && amount <= 10_000_000)) throw new UserError('Enter the amount.');
    p.amt = Math.round(amount * 100) / 100;
    if (type === 'Expense') {
      const day = mustParse(String(b.Date), 'expense date');
      if (day > today()) throw new UserError('The expense date cannot be in the future.');
      p.date = sqlD(day);
      p.cat = String(b.Category ?? 'Other').trim().slice(0, 50) || 'Other';
      if (b.Attachment) {
        const att = String(b.Attachment);
        if (att.length > 3_000_000) throw new UserError('The receipt photo is too large.');
        p.att = att;
      }
    } else {
      const inst = Number(b.Installments ?? 1);
      if (!Number.isInteger(inst) || inst < 1 || inst > 36) throw new UserError('Installments must be 1 to 36 months.');
      p.inst = inst;
      p.cat = String(b.Category ?? 'Salary Advance').slice(0, 50);
    }
    if (!details) throw new UserError('Please write what it is for.');
  }
  await exec(`INSERT INTO EmployeeRequests (EmployeeId, Type, RequestDate, PunchTime, Category, Amount, Installments, Details, Attachment, Payload)
    VALUES (@id, @type, CONVERT(date, @date, 120), CONVERT(datetime2, @pt, 120), @cat, CAST(@amt AS decimal(18,2)), @inst, @det, @att, @pl)`, p);
  await notifyNewRequest(employeeId, TYPE_NAMES[type], type === 'Profile' ? [] : undefined);
  return `${TYPE_NAMES[type]} sent. Status: Pending.`;
}

/** Only the allowed fields, trimmed; unknown fields are dropped. */
function profileChanges(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!SELF_FIELDS.includes(k)) continue;
    out[k] = String(x ?? '').trim().slice(0, EMPLOYEE_FIELDS[k] ?? TEXT_FIELDS[k]);
  }
  return out;
}

/** Applies an approved profile change to Employees / EmployeeProfiles. */
async function applyProfile(employeeId: number, changes: Record<string, string>) {
  const emp = Object.entries(changes).filter(([k]) => k in EMPLOYEE_FIELDS);
  if (emp.length)
    await exec(`UPDATE Employees SET ${emp.map(([k]) => `${k} = @${k}`).join(', ')} WHERE Id = @id`,
      { id: employeeId, ...Object.fromEntries(emp.map(([k, v]) => [k, v || null])) });
  await saveProfile(employeeId, Object.fromEntries(Object.entries(changes).filter(([k]) => k in TEXT_FIELDS)));
}

/** Tells the approvers (reporting manager / department managers; `[]` = HR only) and HR about a new request. */
export async function notifyNewRequest(employeeId: number, what: string, approvers?: number[]) {
  const e = await one('SELECT EnrollNo, Name FROM Employees WHERE Id = @id', { id: employeeId });
  const who = e ? `${e.Name} (${e.EnrollNo})` : `Employee ${employeeId}`;
  for (const m of approvers ?? await approversOf(employeeId)) await notify(m, `${what} from ${who}`, 'Waiting for your approval.', 'team');
  await notify(null, `${what} from ${who}`, 'Pending approval.', what.includes('leave') ? 'leave' : 'requests');
}

/** Tells the employee about the decision. */
export async function notifyDecision(employeeId: number, what: string, approved: boolean, by: string, note: string | null, link = 'requests') {
  await notify(employeeId, `${what} ${approved ? 'approved' : 'rejected'}`, `By ${by}${note ? ': ' + note : ''}`, link);
}

export async function typeOf(id: number): Promise<string | null> {
  return (await one('SELECT Type FROM EmployeeRequests WHERE Id = @id', { id }))?.Type ?? null;
}

/** Only the employee's own pending requests can be cancelled. */
export async function cancel(employeeId: number, id: number) {
  const n = await exec('DELETE FROM EmployeeRequests WHERE Id = @id AND EmployeeId = @e AND Status = 0', { id, e: employeeId });
  if (!n) throw new UserError('Only your own pending requests can be cancelled.');
}

/** Owner and receipt photo of a request. */
export async function attachment(id: number): Promise<{ EmployeeId: number; Attachment: string | null } | undefined> {
  return one('SELECT EmployeeId, Attachment FROM EmployeeRequests WHERE Id = @id', { id });
}

export async function pendingOwner(id: number): Promise<number | null> {
  return (await one('SELECT EmployeeId FROM EmployeeRequests WHERE Id = @id AND Status = 0', { id }))?.EmployeeId ?? null;
}

/** Sets the decision; an approved regularisation adds its punch (unless the employee already has one at that time). */
export async function decide(id: number, approve: boolean, by: string, note: string | null) {
  const r = await one(`SELECT r.Id, r.EmployeeId, r.Type, CONVERT(varchar(19), r.PunchTime, 120) PunchTime, r.Category, r.Details, r.Payload,
      e.EnrollNo FROM EmployeeRequests r JOIN Employees e ON e.Id = r.EmployeeId WHERE r.Id = @id AND r.Status = 0`, { id });
  if (!r) return false;
  if (approve && r.Type === 'Profile' && r.Payload) await applyProfile(r.EmployeeId, JSON.parse(r.Payload));
  await exec(`UPDATE EmployeeRequests SET Status = @st, DecidedBy = @by, DecidedOn = SYSDATETIME(), DecisionNote = @note WHERE Id = @id`,
    { st: approve ? 1 : 2, by: by.slice(0, 100), note, id });
  if (approve && r.Type === 'Regularisation' && r.PunchTime) {
    const exists = await one('SELECT TOP 1 Id FROM AttendanceLogs WHERE EnrollNo = @e AND PunchTime = CONVERT(datetime2, @t, 120)', { e: r.EnrollNo, t: r.PunchTime });
    if (!exists)
      await exec(`INSERT INTO AttendanceLogs (EnrollNo, PunchTime, VerifyMode, InOutMode, WorkCode, Source, Remark)
        VALUES (@e, CONVERT(datetime2, @t, 120), -1, @io, 0, @src, @rem)`, {
        e: r.EnrollNo, t: r.PunchTime, io: r.Category === 'Check-Out' ? 1 : 0, src: PunchSource.Manual,
        rem: `Regularisation #${r.Id}: ${String(r.Details ?? '').slice(0, 150)}`,
      });
  }
  await notifyDecision(r.EmployeeId, TYPE_NAMES[r.Type] ?? r.Type, approve, by, note);
  return true;
}

/** HR decides several requests at once. */
export async function decideMany(ids: number[], approve: boolean, by: string, note: string) {
  if (!ids.length) throw new UserError('Select requests first.');
  by = by.trim();
  if (!by) throw new UserError(`Enter who ${approve ? 'approved' : 'rejected'} it.`);
  let n = 0;
  for (const id of ids) if (await decide(id, approve, by, note.trim().slice(0, 200) || null)) n++;
  return `${n} request(s) ${approve ? 'approved' : 'rejected'}.` + (ids.length > n ? ` ${ids.length - n} were already decided.` : '');
}

/** Approved expense claims of an employee in [from, to) (dates yyyy-MM-dd). */
export async function reimbursedBetween(employeeId: number, from: string, to: string): Promise<number> {
  const r = await one(`SELECT CAST(ISNULL(SUM(Amount), 0) AS float) s FROM EmployeeRequests WHERE EmployeeId = @id AND Type = 'Expense'
    AND Status = 1 AND RequestDate >= @f AND RequestDate < @t`, { id: employeeId, f: from, t: to });
  return r?.s ?? 0;
}
