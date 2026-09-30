/**
 * HR profile of an employee (EmployeeProfiles, web only): reporting manager, emergency contact, personal details, bank
 * account, statutory numbers (PAN, Aadhaar, UAN, PF, ESI) and which statutory deductions apply (PF / ESI / PT, monthly TDS).
 */
import { exec, one, query, type Tx } from '../config/db';
import { UserError } from '../utils/errors';

export interface Profile {
  ReportingManagerId: number | null;
  ReportingManager: string;
  EmergencyName: string; EmergencyRelation: string; EmergencyPhone: string;
  BloodGroup: string; MaritalStatus: string; PersonalEmail: string;
  Pan: string; Aadhaar: string; Uan: string; PfNo: string; EsiNo: string;
  BankName: string; BankAccount: string; BankIfsc: string; AccountHolder: string;
  PfApplicable: boolean; EsiApplicable: boolean; PtApplicable: boolean; TdsMonthly: number;
}

/** Text fields and their lengths (the employee may ask to change the ones in SELF_FIELDS). */
export const TEXT_FIELDS: Record<string, number> = {
  EmergencyName: 100, EmergencyRelation: 50, EmergencyPhone: 20, BloodGroup: 5, MaritalStatus: 20, PersonalEmail: 100,
  Pan: 10, Aadhaar: 12, Uan: 12, PfNo: 30, EsiNo: 20, BankName: 100, BankAccount: 30, BankIfsc: 11, AccountHolder: 100,
};

export const EMPTY_PROFILE: Profile = {
  ReportingManagerId: null, ReportingManager: '', EmergencyName: '', EmergencyRelation: '', EmergencyPhone: '', BloodGroup: '',
  MaritalStatus: '', PersonalEmail: '', Pan: '', Aadhaar: '', Uan: '', PfNo: '', EsiNo: '', BankName: '', BankAccount: '',
  BankIfsc: '', AccountHolder: '', PfApplicable: false, EsiApplicable: false, PtApplicable: false, TdsMonthly: 0,
};

const COLUMNS = `p.ReportingManagerId, m.Name ReportingManager, ${Object.keys(TEXT_FIELDS).map((k) => `p.${k}`).join(', ')},
  p.PfApplicable, p.EsiApplicable, p.PtApplicable, CAST(p.TdsMonthly AS float) TdsMonthly`;

function toProfile(r: any): Profile {
  const p: any = { ...EMPTY_PROFILE };
  for (const k of Object.keys(EMPTY_PROFILE)) if (r[k] !== null && r[k] !== undefined) p[k] = r[k];
  p.PfApplicable = !!r.PfApplicable; p.EsiApplicable = !!r.EsiApplicable; p.PtApplicable = !!r.PtApplicable;
  return p;
}

export async function getProfile(employeeId: number): Promise<Profile> {
  const r = await one(`SELECT ${COLUMNS} FROM EmployeeProfiles p LEFT JOIN Employees m ON m.Id = p.ReportingManagerId
    WHERE p.EmployeeId = @id`, { id: employeeId });
  return r ? toProfile(r) : { ...EMPTY_PROFILE };
}

/** Profiles of many employees (payroll, bank transfer report). */
export async function getProfiles(employeeIds: number[]): Promise<Map<number, Profile>> {
  if (!employeeIds.length) return new Map();
  const rows = await query(`SELECT p.EmployeeId, ${COLUMNS} FROM EmployeeProfiles p LEFT JOIN Employees m ON m.Id = p.ReportingManagerId
    WHERE p.EmployeeId = ANY(@ids)`, { ids: employeeIds });
  return new Map(rows.map((r) => [r.EmployeeId as number, toProfile(r)]));
}

const clean = (v: unknown, max: number) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

function validate(field: string, v: string | null) {
  if (v === null) return;
  if (field === 'Pan' && !/^[A-Z]{5}\d{4}[A-Z]$/i.test(v)) throw new UserError('PAN must look like ABCDE1234F.');
  if (field === 'Aadhaar' && !/^\d{12}$/.test(v)) throw new UserError('Aadhaar must be 12 digits.');
  if (field === 'Uan' && !/^\d{12}$/.test(v)) throw new UserError('UAN must be 12 digits.');
  if (field === 'BankIfsc' && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(v)) throw new UserError('IFSC must look like SBIN0001234.');
  if (field === 'BankAccount' && !/^\d{6,20}$/.test(v)) throw new UserError('Bank account number must be 6 to 20 digits.');
}

/** The text fields present in `b`, trimmed, upper-cased where needed and checked (PAN, IFSC … formats). */
export function checkProfileFields(b: Record<string, unknown>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [k, max] of Object.entries(TEXT_FIELDS)) {
    if (!(k in b)) continue;
    let v = clean(b[k], max);
    if (v && ['Pan', 'BankIfsc'].includes(k)) v = v.toUpperCase();
    validate(k, v);
    out[k] = v;
  }
  return out;
}

/**
 * Saves the given fields of the profile (fields left out keep their value). `ReportingManagerId` must be another active
 * employee and must not make a circle (A reports to B, B reports to A).
 */
export async function saveProfile(employeeId: number, b: Record<string, unknown>, tx?: Tx) {
  const set: string[] = [];
  const p: Record<string, unknown> = { id: employeeId };
  for (const [k, v] of Object.entries(checkProfileFields(b))) {
    set.push(`${k} = @${k}`);
    p[k] = v;
  }
  for (const k of ['PfApplicable', 'EsiApplicable', 'PtApplicable']) if (k in b) { set.push(`${k} = @${k}`); p[k] = !!b[k]; }
  if ('TdsMonthly' in b) {
    const n = Number(b.TdsMonthly ?? 0);
    if (!isFinite(n) || n < 0 || n > 10_000_000) throw new UserError('Monthly TDS is not a valid amount.');
    set.push('TdsMonthly = CAST(@TdsMonthly AS decimal(18,2))');
    p.TdsMonthly = Math.round(n * 100) / 100;
  }
  if ('ReportingManagerId' in b) {
    const m = b.ReportingManagerId ? Number(b.ReportingManagerId) : null;
    if (m !== null) {
      if (m === employeeId) throw new UserError('An employee cannot be their own reporting manager.');
      if (!(await one('SELECT Id FROM Employees WHERE Id = @m', { m }, tx))) throw new UserError('Reporting manager not found.');
      // Walk up from the new manager: reaching this employee would be a circle.
      let cur: number | null = m;
      for (let i = 0; cur !== null && i < 50; i++) {
        if (cur === employeeId) throw new UserError('This reporting manager reports (directly or indirectly) to this employee.');
        cur = (await one('SELECT ReportingManagerId r FROM EmployeeProfiles WHERE EmployeeId = @c', { c: cur }, tx))?.r ?? null;
      }
    }
    set.push('ReportingManagerId = @ReportingManagerId');
    p.ReportingManagerId = m;
  }
  if (!set.length) return;
  await exec(`INSERT INTO EmployeeProfiles (EmployeeId) VALUES (@id) ON CONFLICT (EmployeeId) DO NOTHING;
    UPDATE EmployeeProfiles SET ${set.join(', ')}, UpdatedAt = LOCALTIMESTAMP WHERE EmployeeId = @id`, p, tx);
}

/** Employees who report directly to this one (active only). */
export async function directReports(managerId: number): Promise<number[]> {
  const rows = await query(`SELECT p.EmployeeId FROM EmployeeProfiles p JOIN Employees e ON e.Id = p.EmployeeId
    WHERE p.ReportingManagerId = @m AND e.IsActive = TRUE`, { m: managerId });
  return rows.map((r) => r.EmployeeId);
}

/** Bank account for display to the employee: only the last 4 digits. */
export const maskAccount = (a: string) => (a.length > 4 ? '•'.repeat(Math.min(8, a.length - 4)) + a.slice(-4) : a);

export async function removeProfiles(ids: number[], tx?: Tx) {
  await exec(`DELETE FROM EmployeeProfiles WHERE EmployeeId = ANY(@ids);
    UPDATE EmployeeProfiles SET ReportingManagerId = NULL WHERE ReportingManagerId = ANY(@ids);
    DELETE FROM EmployeeDocuments WHERE EmployeeId = ANY(@ids);
    DELETE FROM EmployeeSalaryComponents WHERE EmployeeId = ANY(@ids);
    DELETE FROM ShiftRoster WHERE EmployeeId = ANY(@ids);
    DELETE FROM Notifications WHERE EmployeeId = ANY(@ids)`, { ids }, tx);
}
