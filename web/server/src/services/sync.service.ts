/** Saving punches and device users in the database (SyncService.cs of the Windows program). */
import { exec, one, query, transaction } from '../config/db';
import { fmt, parse, sqlDT, type DT } from '../utils/time';

export const PunchSource = { Device: 0, UsbFile: 1, Manual: 2 } as const;

export interface DevicePunch { enrollNo: string; time: DT; verifyMode: number; inOutMode: number; workCode: number }
export interface SaveResult { added: number; duplicates: number; newEmployees: number }

async function defaults() {
  const s = await one<{ Id: number }>('SELECT TOP 1 Id FROM Shifts ORDER BY Id');
  const d = await one<{ Id: number }>('SELECT TOP 1 Id FROM Departments ORDER BY Id');
  return { shift: s?.Id ?? null, dept: d?.Id ?? null };
}

/** Inserts new punches (same enroll number + second = already there) and adds a placeholder employee for unknown ids. */
export async function savePunches(punches: DevicePunch[], source: number): Promise<SaveResult> {
  const seen = new Set<string>();
  const list = punches
    .filter((p) => p.enrollNo.trim() !== '' && Number.isFinite(p.time))
    .map((p) => ({ ...p, enrollNo: p.enrollNo.trim(), time: Math.floor(p.time / 1000) * 1000 }))
    .filter((p) => {
      const k = `${p.enrollNo}|${p.time}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  if (!list.length) return { added: 0, duplicates: 0, newEmployees: 0 };

  const min = Math.min(...list.map((p) => p.time)), max = Math.max(...list.map((p) => p.time));
  const existing = new Set((await query<{ e: string; t: string }>(
    `SELECT EnrollNo e, CONVERT(varchar(19), PunchTime, 120) t FROM AttendanceLogs
     WHERE PunchTime >= CONVERT(datetime2, @a, 120) AND PunchTime <= CONVERT(datetime2, @b, 120)`,
    { a: sqlDT(min), b: sqlDT(max) })).map((r) => `${r.e}|${parse(r.t)}`));
  const fresh = list.filter((p) => !existing.has(`${p.enrollNo}|${p.time}`));

  const known = new Set((await query<{ EnrollNo: string }>('SELECT EnrollNo FROM Employees')).map((r) => r.EnrollNo));
  const newIds = [...new Set(list.map((p) => p.enrollNo))].filter((id) => !known.has(id));
  const d = await defaults();

  await transaction(async (tx) => {
    for (let i = 0; i < fresh.length; i += 200) {
      const batch = fresh.slice(i, i + 200).map((p) => ({ e: p.enrollNo, t: sqlDT(p.time), v: p.verifyMode, io: p.inOutMode, w: p.workCode }));
      await exec(`INSERT INTO AttendanceLogs (EnrollNo, PunchTime, VerifyMode, InOutMode, WorkCode, Source)
        SELECT j.e, CONVERT(datetime2, j.t, 120), j.v, j.io, j.w, @src
        FROM OPENJSON(@rows) WITH (e nvarchar(24), t varchar(19), v int, io int, w int) j`, { rows: batch, src: source }, tx);
    }
    for (const id of newIds)
      await exec(`INSERT INTO Employees (EnrollNo, Name, ShiftId, DepartmentId, Privilege, IsActive, MonthlySalary, OtRatePerHour)
        VALUES (@e, @n, @s, @d, 0, 1, 0, 0)`, { e: id, n: `User ${id}`, s: d.shift, d: d.dept }, tx);
  });
  return { added: fresh.length, duplicates: list.length - fresh.length, newEmployees: newIds.length };
}

export interface DeviceUser { enrollNo: string; name: string; privilege: number; password?: string; cardNo?: string }

/** Insert / update employees from device users (Download user info). Names are kept unless `overwriteNames`. */
export async function saveUsers(users: DeviceUser[], overwriteNames: boolean) {
  const d = await defaults();
  const emps = new Map((await query<{ Id: number; EnrollNo: string; Name: string }>('SELECT Id, EnrollNo, Name FROM Employees'))
    .map((e) => [e.EnrollNo, e]));
  let added = 0, updated = 0;
  await transaction(async (tx) => {
    for (const u of users) {
      const e = emps.get(u.enrollNo);
      if (!e) {
        await exec(`INSERT INTO Employees (EnrollNo, Name, ShiftId, DepartmentId, Privilege, IsActive, MonthlySalary, OtRatePerHour, DevicePassword, CardNo)
          VALUES (@e, @n, @s, @d, @p, 1, 0, 0, @pw, @c)`, {
          e: u.enrollNo, n: u.name.trim() || `User ${u.enrollNo}`, s: d.shift, d: d.dept, p: u.privilege,
          pw: u.password || null, c: u.cardNo && u.cardNo !== '0' ? u.cardNo : null,
        }, tx);
        added++;
        continue;
      }
      updated++;
      const placeholder = !e.Name.trim() || e.Name === `User ${u.enrollNo}`;
      const name = u.name.trim() && (overwriteNames || placeholder) ? u.name.trim() : e.Name.trim() || `User ${u.enrollNo}`;
      await exec(`UPDATE Employees SET Name = @n, Privilege = @p,
          DevicePassword = CASE WHEN @pwset = 1 THEN @pw ELSE DevicePassword END,
          CardNo = CASE WHEN @c IS NOT NULL THEN @c ELSE CardNo END WHERE Id = @id`, {
        n: name, p: u.privilege, pwset: u.password !== undefined ? 1 : 0, pw: u.password || null,
        c: u.cardNo && u.cardNo !== '0' ? u.cardNo : null, id: e.Id,
      }, tx);
    }
  });
  return { added, updated };
}

export const punchTimeText = (t: DT) => fmt(t, 'dd-MM-yyyy HH:mm:ss');
