/** ShiftRoster table (web only): the shift of an employee on a date, for rotating shifts. Overrides Employees.ShiftId. */
import { query } from '../config/db';
import { parse, sqlD, type DT } from '../utils/time';

export interface RosterDay { ShiftId: number | null; IsOff: boolean }

/** Roster days of these employees in [from, to], keyed `${employeeId}|${date}`. */
export async function loadRoster(from: DT, to: DT, employeeIds: number[]): Promise<Map<string, RosterDay>> {
  if (!employeeIds.length) return new Map();
  const rows = await query(`SELECT EmployeeId, to_char(Date, 'YYYY-MM-DD') AS d, ShiftId, IsOff FROM ShiftRoster
    WHERE Date >= @f AND Date <= @t AND EmployeeId = ANY(@ids)`,
  { f: sqlD(from), t: sqlD(to), ids: employeeIds });
  return new Map(rows.map((r) => [rosterKey(r.EmployeeId, parse(r.d)!), { ShiftId: r.ShiftId ?? null, IsOff: !!r.IsOff }]));
}

export const rosterKey = (employeeId: number, date: DT) => `${employeeId}|${date}`;
