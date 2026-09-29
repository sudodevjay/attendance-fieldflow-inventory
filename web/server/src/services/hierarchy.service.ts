/**
 * Who approves whom. A manager's team = the employees who report to them (Reporting Manager in the HR profile), or — when
 * nobody reports to them — the manager's department and its sub-departments (managers ticked in Employee Portal Logins).
 * An employee's approvers = their reporting manager, or else the managers whose team they are in.
 */
import { one, query } from '../config/db';
import { withChildren } from './department.service';
import { directReports } from './profile.service';

/** Ids of the employees a manager looks after (everyone active if a department manager has no department). */
export async function teamIds(managerId: number): Promise<number[]> {
  const direct = await directReports(managerId);
  if (direct.length) return direct;
  const acc = await one('SELECT IsManager FROM PortalAccounts WHERE EmployeeId = @id', { id: managerId });
  if (!acc?.IsManager) return [];
  const m = await one('SELECT DepartmentId FROM Employees WHERE Id = @id', { id: managerId });
  const depts = m?.DepartmentId ? await withChildren(m.DepartmentId) : null;
  const rows = await query('SELECT Id, DepartmentId FROM Employees WHERE IsActive = 1 AND Id <> @id', { id: managerId });
  // Employees with their own reporting manager are that manager's, not the department's.
  const reporting = new Set((await query('SELECT EmployeeId FROM EmployeeProfiles WHERE ReportingManagerId IS NOT NULL')).map((r) => r.EmployeeId));
  return rows.filter((r) => !reporting.has(r.Id) && (!depts || (r.DepartmentId !== null && depts.includes(r.DepartmentId)))).map((r) => r.Id);
}

/** Manager = ticked as manager, or has people reporting to them. */
export async function isManager(employeeId: number) {
  const acc = await one('SELECT IsManager FROM PortalAccounts WHERE EmployeeId = @id', { id: employeeId });
  return !!acc?.IsManager || (await directReports(employeeId)).length > 0;
}

/** Employees (with a portal login) who may approve this employee's requests. */
export async function approversOf(employeeId: number): Promise<number[]> {
  const p = await one(`SELECT p.ReportingManagerId m FROM EmployeeProfiles p JOIN PortalAccounts a ON a.EmployeeId = p.ReportingManagerId
    WHERE p.EmployeeId = @id`, { id: employeeId });
  if (p?.m) return [p.m];
  const managers = await query('SELECT EmployeeId FROM PortalAccounts WHERE IsManager = 1 AND EmployeeId <> @id', { id: employeeId });
  const out: number[] = [];
  for (const m of managers) if ((await teamIds(m.EmployeeId)).includes(employeeId)) out.push(m.EmployeeId);
  return out;
}
