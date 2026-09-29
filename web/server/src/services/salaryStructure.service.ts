/**
 * Salary structure: the components the monthly salary (gross) is split into (Basic, HRA, allowances …) and fixed
 * deductions, with per-employee amounts that replace a component's rule; and the statutory deductions (PF, ESI,
 * Professional Tax) plus advance recovery. Company rules are in AppSettings (Salary.*).
 */
import type * as MSSQL from 'mssql';
import { exec, one, query } from '../config/db';
import { UserError } from '../utils/errors';
import { round2 } from '../utils/format';
import { getSettings, setSetting } from './settings.service';

export type Calc = 'PctGross' | 'PctBasic' | 'Fixed' | 'Balance';
export interface Component { Id: number; Name: string; Kind: 'Earning' | 'Deduction'; Calc: Calc; Value: number; IsBasic: boolean; SortOrder: number; IsActive: boolean }

export async function loadComponents(activeOnly = true): Promise<Component[]> {
  const rows = await query(`SELECT Id, Name, Kind, Calc, CAST(Value AS float) Value, IsBasic, SortOrder, IsActive FROM SalaryComponents
    ${activeOnly ? 'WHERE IsActive = 1' : ''} ORDER BY SortOrder, Id`);
  return rows.map((r) => ({ ...r, IsBasic: !!r.IsBasic, IsActive: !!r.IsActive }));
}

export interface ComponentInput { Id?: unknown; Name?: unknown; Kind?: unknown; Calc?: unknown; Value?: unknown; IsBasic?: unknown; SortOrder?: unknown; IsActive?: unknown }

export async function saveComponent(b: ComponentInput) {
  const id = b.Id ? Number(b.Id) : null;
  const name = String(b.Name ?? '').trim();
  if (!name) throw new UserError('Enter the component name.');
  const kind = b.Kind === 'Deduction' ? 'Deduction' : 'Earning';
  const calc = String(b.Calc);
  if (!['PctGross', 'PctBasic', 'Fixed', 'Balance'].includes(calc)) throw new UserError('Choose how it is calculated.');
  if (calc === 'Balance' && kind === 'Deduction') throw new UserError('Only an earning can take the balance of the salary.');
  const value = Number(b.Value ?? 0);
  if (!isFinite(value) || value < 0 || (calc.startsWith('Pct') && value > 100) || value > 10_000_000)
    throw new UserError(calc.startsWith('Pct') ? 'Percent must be 0 to 100.' : 'Amount is not valid.');
  const isBasic = !!b.IsBasic && kind === 'Earning';
  if (isBasic && calc === 'PctBasic') throw new UserError('The Basic cannot be a percent of itself.');
  const all = await loadComponents(false);
  if (calc === 'Balance' && all.some((c) => c.Calc === 'Balance' && c.Id !== id && c.IsActive))
    throw new UserError('Only one earning can take the balance.');
  const p = { id, n: name.slice(0, 60), k: kind, c: calc, v: value, b: isBasic, s: Number(b.SortOrder ?? 5) || 0, a: b.IsActive !== false };
  if (isBasic) await exec('UPDATE SalaryComponents SET IsBasic = 0 WHERE Id <> ISNULL(@id, 0)', p);
  if (id) await exec(`UPDATE SalaryComponents SET Name = @n, Kind = @k, Calc = @c, Value = CAST(@v AS decimal(18,2)), IsBasic = @b,
    SortOrder = @s, IsActive = @a WHERE Id = @id`, p);
  else await exec(`INSERT INTO SalaryComponents (Name, Kind, Calc, Value, IsBasic, SortOrder, IsActive)
    VALUES (@n, @k, @c, CAST(@v AS decimal(18,2)), @b, @s, @a)`, p);
}

export async function removeComponent(id: number) {
  await exec('DELETE FROM EmployeeSalaryComponents WHERE ComponentId = @id; DELETE FROM SalaryComponents WHERE Id = @id', { id });
}

/** Per-employee amounts, keyed employee id → component id → monthly amount. */
export async function loadOverrides(employeeIds: number[]): Promise<Map<number, Map<number, number>>> {
  const out = new Map<number, Map<number, number>>();
  if (!employeeIds.length) return out;
  const rows = await query(`SELECT EmployeeId, ComponentId, CAST(Amount AS float) Amount FROM EmployeeSalaryComponents
    WHERE EmployeeId IN (SELECT value FROM OPENJSON(@ids))`, { ids: employeeIds });
  for (const r of rows) {
    const m = out.get(r.EmployeeId) ?? new Map<number, number>();
    m.set(r.ComponentId, r.Amount);
    out.set(r.EmployeeId, m);
  }
  return out;
}

/** Replaces an employee's own amounts: [{ ComponentId, Amount }], Amount '' / null = use the component's rule. */
export async function saveOverrides(employeeId: number, list: unknown, tx?: MSSQL.Transaction) {
  if (!Array.isArray(list)) return;
  await exec('DELETE FROM EmployeeSalaryComponents WHERE EmployeeId = @e', { e: employeeId }, tx);
  for (const x of list) {
    if (x?.Amount === '' || x?.Amount === null || x?.Amount === undefined) continue;
    const amount = Number(x.Amount), comp = Number(x.ComponentId);
    if (!Number.isInteger(comp)) continue;
    if (!isFinite(amount) || amount < 0 || amount > 100_000_000) throw new UserError('A salary component amount is not valid.');
    await exec(`INSERT INTO EmployeeSalaryComponents (EmployeeId, ComponentId, Amount) VALUES (@e, @c, CAST(@a AS decimal(18,2)))`,
      { e: employeeId, c: comp, a: round2(amount) }, tx);
  }
}

export interface Line { id: number; name: string; amount: number }

/**
 * Full-month amounts of the components for a gross salary: earnings (the Balance earning takes what is left of the gross,
 * so the earnings add up to the gross) and fixed deductions. Without any earning component the gross is one line.
 */
export function breakdown(gross: number, comps: Component[], own: Map<number, number> | undefined) {
  const earningsDef = comps.filter((c) => c.Kind === 'Earning');
  const basicDef = earningsDef.find((c) => c.IsBasic);
  const amountOf = (c: Component, basic: number) => {
    if (own?.has(c.Id)) return own.get(c.Id)!;
    switch (c.Calc) {
      case 'PctGross': return round2((gross * c.Value) / 100);
      case 'PctBasic': return round2((basic * c.Value) / 100);
      case 'Fixed': return c.Value;
      default: return 0;
    }
  };
  const basic = basicDef ? amountOf(basicDef, 0) : 0;
  const earnings: Line[] = [];
  for (const c of earningsDef) if (c.Calc !== 'Balance') earnings.push({ id: c.Id, name: c.Name, amount: c.IsBasic ? basic : amountOf(c, basic) });
  const balance = earningsDef.find((c) => c.Calc === 'Balance');
  if (balance) {
    const used = earnings.reduce((a, l) => a + l.amount, 0);
    earnings.push({ id: balance.Id, name: balance.Name, amount: own?.has(balance.Id) ? own.get(balance.Id)! : round2(Math.max(0, gross - used)) });
  }
  if (!earnings.length) earnings.push({ id: 0, name: 'Monthly Salary', amount: gross });
  const deductions: Line[] = comps.filter((c) => c.Kind === 'Deduction').map((c) => ({ id: c.Id, name: c.Name, amount: amountOf(c, basic) }))
    .filter((l) => l.amount > 0);
  return { earnings, deductions, basic, total: earnings.reduce((a, l) => a + l.amount, 0) };
}

// ------------------------------------------------------------------ statutory rules

export interface Statutory {
  pfEnabled: boolean; pfPct: number; pfEmployerPct: number; pfWageCap: number;
  esiEnabled: boolean; esiPct: number; esiEmployerPct: number; esiCeiling: number;
  ptEnabled: boolean; ptAmount: number; ptThreshold: number;
  advanceRecovery: boolean;
}

export const STATUTORY_DEFAULTS: Statutory = {
  pfEnabled: false, pfPct: 12, pfEmployerPct: 12, pfWageCap: 15000,
  esiEnabled: false, esiPct: 0.75, esiEmployerPct: 3.25, esiCeiling: 21000,
  ptEnabled: false, ptAmount: 200, ptThreshold: 15000,
  advanceRecovery: false,
};

export async function loadStatutory(): Promise<Statutory> {
  const s = await getSettings('Salary.');
  const out: any = { ...STATUTORY_DEFAULTS };
  for (const [k, d] of Object.entries(STATUTORY_DEFAULTS)) {
    const v = s[`Salary.${k}`];
    if (v === undefined) continue;
    out[k] = typeof d === 'boolean' ? v === '1' : Number(v) >= 0 ? Number(v) : d;
  }
  return out;
}

export async function saveStatutory(b: Record<string, unknown>) {
  const limits: Record<string, number> = {
    pfPct: 100, pfEmployerPct: 100, pfWageCap: 10_000_000, esiPct: 100, esiEmployerPct: 100, esiCeiling: 10_000_000,
    ptAmount: 100_000, ptThreshold: 10_000_000,
  };
  for (const [k, d] of Object.entries(STATUTORY_DEFAULTS)) {
    if (!(k in b)) continue;
    if (typeof d === 'boolean') { await setSetting(`Salary.${k}`, b[k] ? '1' : '0'); continue; }
    const n = Number(b[k]);
    if (!isFinite(n) || n < 0 || n > limits[k]) throw new UserError(`${k}: enter 0 to ${limits[k]}.`);
    await setSetting(`Salary.${k}`, String(Math.round(n * 100) / 100));
  }
}

/** Monthly installment of each approved advance that falls in the month (starts the month after approval). */
export async function advanceInstallments(employeeIds: number[], year: number, month: number): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!employeeIds.length) return out;
  const rows = await query(`SELECT EmployeeId, CAST(Amount AS float) Amount, ISNULL(Installments, 1) Installments,
      YEAR(DecidedOn) y, MONTH(DecidedOn) m FROM EmployeeRequests
    WHERE Type = 'Advance' AND Status = 1 AND DecidedOn IS NOT NULL AND EmployeeId IN (SELECT value FROM OPENJSON(@ids))`, { ids: employeeIds });
  for (const r of rows) {
    const k = year * 12 + month - (r.y * 12 + r.m); // 1 = first month after approval
    if (k < 1 || k > r.Installments) continue;
    const each = round2(r.Amount / r.Installments);
    const amount = k === r.Installments ? round2(r.Amount - each * (r.Installments - 1)) : each;
    out.set(r.EmployeeId, round2((out.get(r.EmployeeId) ?? 0) + amount));
  }
  return out;
}

/** Salary tab of the employee window: the components with the employee's own amounts. */
export async function employeeStructure(employeeId: number) {
  const comps = await loadComponents();
  const own = (await loadOverrides([employeeId])).get(employeeId);
  const e = await one('SELECT CAST(MonthlySalary AS float) s FROM Employees WHERE Id = @id', { id: employeeId });
  const b = breakdown(e?.s ?? 0, comps, own);
  const calc = new Map([...b.earnings, ...b.deductions].map((l) => [l.id, l.amount]));
  return comps.map((c) => ({ ComponentId: c.Id, Name: c.Name, Kind: c.Kind, Calc: c.Calc, Value: c.Value, Amount: own?.get(c.Id) ?? null, Calculated: calc.get(c.Id) ?? 0 }));
}
