/** Employee List: list, detail, save, delete (EmployeeWindow.cs); plus the web HR profile, salary structure and documents. */
import { exec, one, query, transaction } from '../config/db';
import { byEnroll, EMPLOYEE_COLUMNS, toEmployee } from '../models';
import { UserError } from '../utils/errors';
import { assertInScope, filterScope } from '../utils/scope';
import { withChildren } from './department.service';
import * as documents from './document.service';
import { getProfile, removeProfiles, saveProfile } from './profile.service';
import { employeeStructure, saveOverrides } from './salaryStructure.service';

/** Grid rows: a department (with or without its sub-departments) and / or a search text. */
export async function list(departmentId: number | null, includeSub: boolean, search: string) {
  const ids = departmentId ? (includeSub ? await withChildren(departmentId) : [departmentId]) : null;
  const rows = await query(`SELECT e.Id, e.EnrollNo, e.BadgeNo, e.Name, e.Gender, e.Designation, e.Phone, e.DepartmentId,
      d.Name Department, e.IsActive FROM Employees e LEFT JOIN Departments d ON d.Id = e.DepartmentId
    WHERE (@q = '' OR e.EnrollNo ILIKE '%' || @q || '%' OR e.Name ILIKE '%' || @q || '%' OR e.BadgeNo ILIKE '%' || @q || '%')`, { q: search.trim() });
  return filterScope(rows, (r) => r.Id).filter((r) => !ids || (r.DepartmentId !== null && ids.includes(r.DepartmentId)))
    .map((r) => ({ ...r, IsActive: !!r.IsActive })).sort(byEnroll);
}

/** Id / AC No / name of every (or every active) employee, for pickers. */
export async function options(activeOnly: boolean) {
  const rows = await query(`SELECT Id, EnrollNo, Name, IsActive FROM Employees ${activeOnly ? 'WHERE IsActive = TRUE' : ''}`);
  return filterScope(rows, (r) => r.Id).map((r) => ({ ...r, IsActive: !!r.IsActive })).sort(byEnroll);
}

/** Highest numeric AC No + 1 (for a new employee). */
export async function nextEnrollNo() {
  const rows = await query<{ EnrollNo: string }>('SELECT EnrollNo FROM Employees');
  return String(rows.reduce((m, r) => Math.max(m, /^\d+$/.test(r.EnrollNo) ? parseInt(r.EnrollNo, 10) : 0), 0) + 1);
}

export async function detail(id: number) {
  assertInScope(id);
  const r = await one(`SELECT ${EMPLOYEE_COLUMNS}, e.PhotoBase64 FROM Employees e LEFT JOIN Departments d ON d.Id = e.DepartmentId WHERE e.Id = @id`, { id });
  if (!r) throw new UserError('Employee not found.', 404);
  const fingers = (await query('SELECT FingerIndex FROM FingerTemplates WHERE EmployeeId = @id', { id })).map((f) => f.FingerIndex);
  return {
    ...r, IsActive: toEmployee(r).IsActive, fingers, Profile: await getProfile(id), Salary: await employeeStructure(id),
    Documents: await documents.list(id),
  };
}

const text = (v: unknown, max: number) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const date = (v: unknown) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new UserError(`Invalid date: ${s}`);
  return s;
};
const amount = (v: unknown, what: string) => {
  const n = Number(v ?? 0);
  if (!isFinite(n) || n < 0 || n > 100_000_000) throw new UserError(`${what} is not a valid amount.`);
  return Math.round(n * 100) / 100;
};

/** Add (id = null) or save an employee. Changing the AC No moves the employee's punches along. Returns the id. */
export async function save(id: number | null, b: Record<string, any>): Promise<number> {
  const enroll = String(b.EnrollNo ?? '').trim();
  const name = String(b.Name ?? '').trim();
  if (!enroll || !name) throw new UserError('AC No and Name are required.');
  if (!/^\d{1,9}$/.test(enroll)) throw new UserError('AC No must be numeric (max. 9 digits) — the LX50 uses numeric user IDs.');
  if (await one('SELECT Id FROM Employees WHERE EnrollNo = @e AND Id <> @id LIMIT 1', { e: enroll, id: id ?? 0 }))
    throw new UserError(`AC No ${enroll} is already assigned to another employee.`);

  const old = id ? await one('SELECT EnrollNo, Privilege FROM Employees WHERE Id = @id', { id }) : null;
  if (id && !old) throw new UserError('Employee not found.', 404);
  // Keep the device's own admin level; a new admin gets 3 (super admin), as the Windows program does.
  const privilege = b.Admin ? (old?.Privilege > 0 ? old.Privilege : 3) : 0;
  const p = {
    e: enroll, n: name.slice(0, 100), badge: text(b.BadgeNo, 30), nat: text(b.Nationality, 50), otel: text(b.OfficeTel, 20),
    des: text(b.Designation, 100), card: text(b.CardNo, 20), ph: text(b.Phone, 20), home: text(b.HomeAddress, 250), mail: text(b.Email, 100),
    pwd: text(b.DevicePassword, 20), g: text(b.Gender, 10), pr: privilege, bd: date(b.BirthDate), jd: date(b.JoinDate),
    act: b.IsActive !== false, dep: b.DepartmentId || null, sh: b.ShiftId || null,
    sal: amount(b.MonthlySalary, 'Monthly salary'), ot: amount(b.OtRatePerHour, 'OT rate'),
    photo: b.PhotoBase64 ? String(b.PhotoBase64) : null,
  };
  const set = `EnrollNo = @e, Name = @n, BadgeNo = @badge, Nationality = @nat, OfficeTel = @otel, Designation = @des, CardNo = @card,
    Phone = @ph, HomeAddress = @home, Email = @mail, DevicePassword = @pwd, Gender = @g, Privilege = @pr,
    BirthDate = CAST(@bd AS timestamp), JoinDate = CAST(@jd AS timestamp), IsActive = @act, DepartmentId = @dep,
    ShiftId = @sh, MonthlySalary = CAST(@sal AS decimal(18,2)), OtRatePerHour = CAST(@ot AS decimal(18,2)), PhotoBase64 = @photo`;

  return transaction(async (tx) => {
    let employeeId = id;
    if (!employeeId) {
      const r = await one(`INSERT INTO Employees (EnrollNo, Name, Privilege, IsActive, MonthlySalary, OtRatePerHour)
        VALUES (@e, @n, 0, TRUE, 0, 0) RETURNING Id`, { e: enroll, n: name }, tx);
      employeeId = r!.Id as number;
    } else if (old.EnrollNo !== enroll) {
      await exec('UPDATE AttendanceLogs SET EnrollNo = @e WHERE EnrollNo = @o', { e: enroll, o: old.EnrollNo }, tx);
    }
    await exec(`UPDATE Employees SET ${set} WHERE Id = @id`, { ...p, id: employeeId }, tx);
    if (b.Profile && typeof b.Profile === 'object') await saveProfile(employeeId, b.Profile, tx);
    if (Array.isArray(b.SalaryComponents)) await saveOverrides(employeeId, b.SalaryComponents, tx);
    return employeeId;
  });
}

/** Deletes employees with their leave and fingerprints; their punches stay. */
export async function removeMany(ids: number[]) {
  if (!ids.length) throw new UserError('Select an employee first.');
  await transaction(async (tx) => {
    await removeProfiles(ids, tx);
    await exec(`DELETE FROM LeaveEntries WHERE EmployeeId = ANY(@ids);
      DELETE FROM FingerTemplates WHERE EmployeeId = ANY(@ids);
      DELETE FROM Employees WHERE Id = ANY(@ids)`, { ids }, tx);
  });
}

export async function deleteFinger(id: number, finger: number) {
  const n = await exec('DELETE FROM FingerTemplates WHERE EmployeeId = @id AND FingerIndex = @f', { id, f: finger });
  if (!n) throw new UserError('No template is saved for this finger.');
  return 'Fingerprint deleted from the software. The finger is still on the device: delete it from the device menu ' +
    '(Menu → User Mgt → user → Fingerprint).';
}

/** Photos (base64 JPEG as stored) of these AC Nos, for the AC Log. */
export async function photos(enrollNos: string[]): Promise<Record<string, string>> {
  if (!enrollNos.length) return {};
  const rows = await query(`SELECT EnrollNo, PhotoBase64 FROM Employees WHERE PhotoBase64 IS NOT NULL AND EnrollNo = ANY(@n)`, { n: enrollNos });
  return Object.fromEntries(rows.map((r) => [r.EnrollNo, r.PhotoBase64]));
}
