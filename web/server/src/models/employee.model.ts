/** Employees table — see Employee in src/ZkAttendance/Data/Entities.cs. */
import { query } from '../config/db';
import { parse, type DT } from '../utils/time';

export interface Employee {
  Id: number;
  EnrollNo: string;
  Name: string;
  Designation: string | null;
  Phone: string | null;
  JoinDate: DT | null;
  BirthDate: DT | null;
  BadgeNo: string | null;
  Gender: string | null;
  Nationality: string | null;
  OfficeTel: string | null;
  HomeAddress: string | null;
  Email: string | null;
  DepartmentId: number | null;
  DepartmentName: string | null;
  ShiftId: number | null;
  Privilege: number;
  DevicePassword: string | null;
  CardNo: string | null;
  MonthlySalary: number;
  OtRatePerHour: number;
  IsActive: boolean;
}

/** SELECT list for `Employees e LEFT JOIN Departments d`. */
export const EMPLOYEE_COLUMNS = `e.Id, e.EnrollNo, e.Name, e.Designation, e.Phone, CONVERT(varchar(10), e.JoinDate, 120) JoinDate,
  CONVERT(varchar(10), e.BirthDate, 120) BirthDate, e.BadgeNo, e.Gender, e.Nationality, e.OfficeTel, e.HomeAddress, e.Email,
  e.DepartmentId, d.Name DepartmentName, e.ShiftId, e.Privilege, e.DevicePassword, e.CardNo,
  CAST(e.MonthlySalary AS float) MonthlySalary, CAST(e.OtRatePerHour AS float) OtRatePerHour, e.IsActive`;

export function toEmployee(r: any): Employee {
  return { ...r, JoinDate: parse(r.JoinDate), BirthDate: parse(r.BirthDate), IsActive: !!r.IsActive };
}

/** Sorts numeric enroll numbers numerically ("2" before "10"). */
export const sortKey = (enroll: string) => enroll.padStart(12, '0');
export const byEnroll = <T extends { EnrollNo: string }>(a: T, b: T) =>
  (sortKey(a.EnrollNo) < sortKey(b.EnrollNo) ? -1 : sortKey(a.EnrollNo) > sortKey(b.EnrollNo) ? 1 : 0);

/** Active employees, optionally one department (exactly that one, as the reports do) or one employee. */
export async function loadEmployees(opts: { departmentId?: number | null; employeeId?: number | null; activeOnly?: boolean } = {}) {
  const where = [opts.activeOnly === false ? '1=1' : 'e.IsActive = 1'];
  if (opts.departmentId) where.push('e.DepartmentId = @dept');
  if (opts.employeeId) where.push('e.Id = @emp');
  const rows = await query(`SELECT ${EMPLOYEE_COLUMNS} FROM Employees e LEFT JOIN Departments d ON d.Id = e.DepartmentId
    WHERE ${where.join(' AND ')}`, { dept: opts.departmentId ?? null, emp: opts.employeeId ?? null });
  return rows.map(toEmployee).sort(byEnroll);
}
