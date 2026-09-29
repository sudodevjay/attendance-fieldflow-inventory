/** AppSettings table (key / value), shared with the Windows program. */
import { exec, one, query } from '../config/db';
import { UserError } from '../utils/errors';

export async function getSetting(key: string, fallback = ''): Promise<string> {
  const r = await one<{ Value: string }>('SELECT [Value] FROM AppSettings WHERE [Key] = @k', { k: key });
  return r?.Value ?? fallback;
}

export async function getSettings(prefix: string): Promise<Record<string, string>> {
  const rows = await query<{ Key: string; Value: string }>(
    "SELECT [Key], [Value] FROM AppSettings WHERE [Key] LIKE @p + '%'", { p: prefix });
  return Object.fromEntries(rows.map((r) => [r.Key, r.Value]));
}

export async function setSetting(key: string, value: string) {
  await exec(
    `IF EXISTS (SELECT 1 FROM AppSettings WHERE [Key] = @k) UPDATE AppSettings SET [Value] = @v WHERE [Key] = @k
     ELSE INSERT INTO AppSettings ([Key], [Value]) VALUES (@k, @v)`, { k: key, v: value.slice(0, 500) });
}

export const companyName = () => getSetting('CompanyName', 'My Company');
export const companyAddress = () => getSetting('CompanyAddress', '');

/** Company profile fields besides name / address (AppSettings Company.*). */
export const COMPANY_FIELDS = ['Phone', 'Email', 'Website', 'Gstin', 'Pan', 'Tan', 'PfCode', 'EsiCode'] as const;

export async function companyProfile(): Promise<Record<(typeof COMPANY_FIELDS)[number], string>> {
  const s = await getSettings('Company.');
  return Object.fromEntries(COMPANY_FIELDS.map((k) => [k, s[`Company.${k}`] ?? ''])) as any;
}

/** Logo as a data URL (WebBlobs), '' when none. */
export async function companyLogo(): Promise<string> {
  return (await one<{ Value: string }>("SELECT Value FROM WebBlobs WHERE [Key] = 'CompanyLogo'"))?.Value ?? '';
}

export async function saveCompanyLogo(dataUrl: string) {
  if (!dataUrl) return void (await exec("DELETE FROM WebBlobs WHERE [Key] = 'CompanyLogo'"));
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw new UserError('The logo must be a PNG or JPG picture.');
  if (dataUrl.length > 700_000) throw new UserError('The logo is too large (max. about 500 KB).');
  await exec(`MERGE WebBlobs AS t USING (SELECT 'CompanyLogo' k) AS s ON t.[Key] = s.k
    WHEN MATCHED THEN UPDATE SET Value = @v WHEN NOT MATCHED THEN INSERT ([Key], Value) VALUES ('CompanyLogo', @v);`, { v: dataUrl });
}

/** Company-wide attendance rules (Attendance Rule dialog). */
export interface AttendanceRules { windowBeforeHours: number; duplicateMinutes: number; singlePunch: string }

export async function loadAttendanceRules(): Promise<AttendanceRules> {
  const s = await getSettings('Rule.');
  const i = (k: string, d: number) => (s[k] !== undefined && /^-?\d+$/.test(s[k]) ? parseInt(s[k], 10) : d);
  return {
    windowBeforeHours: i('Rule.WindowBeforeHours', 4),
    duplicateMinutes: i('Rule.DuplicateMinutes', 1),
    singlePunch: s['Rule.SinglePunch'] ?? 'Present',
  };
}

/** Company-wide salary rules (Salary Rule dialog). */
export interface PayrollRules { lateCountForHalfDay: number; otMultiplier: number; otRequiresApproval: boolean }

export async function loadPayrollRules(): Promise<PayrollRules> {
  const late = await getSetting('Payroll.LateCountForHalfDay');
  const mult = await getSetting('Payroll.OtMultiplier');
  return {
    lateCountForHalfDay: /^\d+$/.test(late) ? parseInt(late, 10) : 3,
    otMultiplier: mult !== '' && !isNaN(Number(mult)) ? Number(mult) : 1,
    otRequiresApproval: (await getSetting('Payroll.OtRequiresApproval')) === '1',
  };
}

/** Salary days cut for late arrivals: every N late days = half a day. */
export const lateCutDays = (r: PayrollRules, lateDays: number) =>
  r.lateCountForHalfDay > 0 ? Math.floor(lateDays / r.lateCountForHalfDay) * 0.5 : 0;

// ------------------------------------------------------------------ Database Option / rule dialogs

/** Company, auto-sync and ADMS settings (Database Option). */
export async function companySettings() {
  return {
    companyName: await getSetting('CompanyName', 'My Company'),
    companyAddress: await getSetting('CompanyAddress'),
    autoDownload: (await getSetting('AutoDownload')) === '1',
    autoSyncMinutes: Number(await getSetting('AutoSync.Minutes', '5')) || 0,
    admsEnabled: (await getSetting('Adms.Enabled')) === '1',
    admsPort: Number(await getSetting('Adms.Port', '8081')) || 8081,
    profile: await companyProfile(),
    hasLogo: (await companyLogo()) !== '',
  };
}

export async function saveCompany(b: { companyName?: unknown; companyAddress?: unknown; autoDownload?: unknown; autoSyncMinutes?: unknown; profile?: unknown }) {
  const m = Number(b.autoSyncMinutes);
  if (!Number.isInteger(m) || m < 0 || m > 1440) throw new UserError('Auto-sync minutes must be 0 to 1440.');
  await setSetting('CompanyName', String(b.companyName ?? '').trim());
  await setSetting('CompanyAddress', String(b.companyAddress ?? '').trim());
  await setSetting('AutoDownload', b.autoDownload ? '1' : '0');
  await setSetting('AutoSync.Minutes', String(m));
  if (b.profile && typeof b.profile === 'object') {
    const p = b.profile as Record<string, unknown>;
    for (const k of COMPANY_FIELDS) if (k in p) await setSetting(`Company.${k}`, String(p[k] ?? '').trim().slice(0, 200));
  }
}

/** ADMS runs inside the Windows program; the web version only stores its settings. */
export async function saveAdms(enabled: boolean, port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UserError('Port must be 1 to 65535.');
  await setSetting('Adms.Enabled', enabled ? '1' : '0');
  await setSetting('Adms.Port', String(port));
}

export async function saveAttendanceRules(b: { windowBeforeHours?: unknown; duplicateMinutes?: unknown; singlePunch?: unknown }) {
  const w = Number(b.windowBeforeHours), d = Number(b.duplicateMinutes);
  const single = String(b.singlePunch);
  if (!Number.isInteger(w) || w < 0 || w > 12) throw new UserError('Punch window must be 0 to 12 hours.');
  if (!Number.isInteger(d) || d < 0 || d > 120) throw new UserError('Repeat punch minutes must be 0 to 120.');
  if (!['Present', 'Half Day', 'Absent'].includes(single)) throw new UserError('Choose Present, Half Day or Absent.');
  await setSetting('Rule.WindowBeforeHours', String(w));
  await setSetting('Rule.DuplicateMinutes', String(d));
  await setSetting('Rule.SinglePunch', single);
}

export async function savePayrollRules(b: { lateCountForHalfDay?: unknown; otMultiplier?: unknown; otRequiresApproval?: unknown }) {
  const late = Number(b.lateCountForHalfDay), mult = Number(b.otMultiplier);
  if (!Number.isInteger(late) || late < 0 || late > 31) throw new UserError('Late arrivals must be 0 to 31.');
  if (!(mult >= 0 && mult <= 5)) throw new UserError('OT multiplier must be 0 to 5.');
  await setSetting('Payroll.LateCountForHalfDay', String(late));
  await setSetting('Payroll.OtMultiplier', String(Math.round(mult * 100) / 100));
  if (b.otRequiresApproval !== undefined) await setSetting('Payroll.OtRequiresApproval', b.otRequiresApproval ? '1' : '0');
}
