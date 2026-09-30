/** AC Log: raw punches (newest first, IN / OUT), manual punches, delete, pendrive import (AttendanceLogsPage.cs). */
import { exec, one, query } from '../config/db';
import { scopeEnrollNos } from '../utils/scope';
import { UserError } from '../utils/errors';
import { addDays, dateOf, fmt, mustParse, parse, sqlDT, today, type DT } from '../utils/time';
import { process, Status } from './attendance.service';
import { addRecords, verifyName } from './event.service';
import { excel } from './export.service';
import { parseAttendanceFile } from './import.service';
import { PunchSource, savePunches } from './sync.service';

const SOURCES = ['Device', 'USB Drive', 'Manual'];

export interface PunchFilter { from: string; to: string; employeeId: number | null }

async function load(f: PunchFilter) {
  const from = dateOf(mustParse(f.from));
  const to = addDays(dateOf(mustParse(f.to)), 1);
  const emp = f.employeeId ? await one('SELECT EnrollNo FROM Employees WHERE Id = @id', { id: f.employeeId }) : null;
  const rows = await query(`SELECT a.Id, a.EnrollNo, to_char(a.PunchTime, 'YYYY-MM-DD HH24:MI:SS') AS t, a.VerifyMode, a.Source, a.Remark,
      e.Name, e.Id EmployeeId FROM AttendanceLogs a
    LEFT JOIN LATERAL (SELECT x.Name, x.Id FROM Employees x WHERE x.EnrollNo = a.EnrollNo ORDER BY x.Id LIMIT 1) e ON TRUE
    WHERE a.PunchTime >= CAST(@f AS timestamp) AND a.PunchTime < CAST(@t AS timestamp) AND (CAST(@e AS text) IS NULL OR a.EnrollNo = @e)
    ORDER BY a.PunchTime DESC, a.Id DESC LIMIT 20000`, { f: sqlDT(from), t: sqlDT(to), e: emp?.EnrollNo ?? null })
    .then((list) => { const s = scopeEnrollNos(); return s ? list.filter((r) => s.has(r.EnrollNo)) : list; });

  // First punch of an employee on a day = IN, later ones = OUT (same rule as the attendance calculation).
  const first = new Map<string, { id: number; t: DT }>();
  for (const r of rows) {
    const t = parse(r.t)!;
    const k = `${r.EnrollNo}|${dateOf(t)}`;
    const cur = first.get(k);
    if (!cur || t < cur.t || (t === cur.t && r.Id < cur.id)) first.set(k, { id: r.Id, t });
  }
  const firsts = new Set([...first.values()].map((x) => x.id));
  return {
    rows: rows.map((r) => {
      const t = parse(r.t)!;
      return {
        Id: r.Id as number, Date: fmt(t, 'dd-MM-yyyy ddd'), Time: fmt(t, 'HH:mm:ss'), EnrollNo: r.EnrollNo as string,
        Name: (r.Name ?? '(not in software)') as string, InOut: firsts.has(r.Id) ? 'IN' : 'OUT',
        Verify: verifyName(r.VerifyMode).replace('FP', 'Finger'), Source: SOURCES[r.Source] ?? 'Manual', Remark: (r.Remark ?? '') as string,
      };
    }),
    from, to: addDays(to, -1), filtered: !!emp,
  };
}

/** Punches of the period; when today alone is shown for everybody, also "Present / Late / Absent" of today. */
export async function list(f: PunchFilter) {
  const { rows, from, to, filtered } = await load(f);
  let summary = '';
  const t = today();
  if (from === t && to === t && !filtered) {
    const days = await process(t, t);
    const came = days.filter((d) => d.PunchCount > 0).length;
    const late = days.filter((d) => d.LateMinutes > 0).length;
    const absent = days.filter((d) => d.PunchCount === 0 && d.Status === Status.Absent).length;
    summary = `Present: ${came}   Late: ${late}   Absent: ${absent}`;
  }
  return { rows, summary, lastId: rows.reduce((m, r) => Math.max(m, r.Id), 0) };
}

export async function exportExcel(f: PunchFilter) {
  const { rows, from, to } = await load(f);
  const buffer = await excel({
    title: 'Attendance Punches', subtitle: `${fmt(from, 'dd-MM-yyyy')} to ${fmt(to, 'dd-MM-yyyy')}`, statusColumns: [],
    columns: ['Date', 'Time', 'Emp ID', 'Name', 'IN / OUT', 'Verify', 'Source', 'Remark'],
    rows: rows.map((r) => [r.Date, r.Time, r.EnrollNo, r.Name, r.InOut, r.Verify, r.Source, r.Remark]),
  });
  return { buffer, name: `Punches_${fmt(from, 'yyyyMMdd')}_${fmt(to, 'yyyyMMdd')}.xlsx` };
}

export async function addManual(employeeId: number, time: string, checkOut: boolean, remark: string) {
  const emp = await one('SELECT EnrollNo FROM Employees WHERE Id = @id', { id: employeeId });
  if (!emp) throw new UserError('Select an employee.');
  const t = mustParse(time, 'punch time');
  if (await one(`SELECT Id FROM AttendanceLogs WHERE EnrollNo = @e AND PunchTime = CAST(@t AS timestamp) LIMIT 1`, { e: emp.EnrollNo, t: sqlDT(t) }))
    throw new UserError('A punch already exists at this time.');
  await exec(`INSERT INTO AttendanceLogs (EnrollNo, PunchTime, VerifyMode, InOutMode, WorkCode, Source, Remark)
    VALUES (@e, CAST(@t AS timestamp), -1, @io, 0, @src, @r)`,
  { e: emp.EnrollNo, t: sqlDT(t), io: checkOut ? 1 : 0, src: PunchSource.Manual, r: remark.trim().slice(0, 200) });
}

export async function removeMany(ids: number[]) {
  if (!ids.length) throw new UserError('Select punches first.');
  return exec('DELETE FROM AttendanceLogs WHERE Id = ANY(@ids)', { ids });
}

/** Import Attendance Checking Data: 1_attlog.dat / GLG_001.TXT / CSV from the pendrive. */
export async function importFile(content: string) {
  const punches = parseAttendanceFile(content);
  if (!punches.length) throw new UserError('No attendance records found in the file. Check the file format.');
  const r = await savePunches(punches, PunchSource.UsbFile);
  const names = new Map((await query('SELECT EnrollNo, Name FROM Employees')).map((e) => [e.EnrollNo, e.Name]));
  addRecords(punches, names, 'USB');
  return `Import complete.\nRecords: ${punches.length}\nNew: ${r.added}\nDuplicates: ${r.duplicates}\nNew AC No.: ${r.newEmployees}`;
}
