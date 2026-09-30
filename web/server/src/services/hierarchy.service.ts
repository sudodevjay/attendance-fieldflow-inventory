/**
 * Who sees and approves whom in the portal. Every employee login has a role (PortalAccounts.Role): Employee, TeamLead or
 * Manager. The tree comes from the Reporting Manager of the HR profile.
 *  - Team of a team lead / manager: everybody below them in the tree (direct reports, their reports, ...). A manager
 *    nobody reports to gets their department and its sub-departments instead (as before).
 *  - Approval chain of an employee: going up the tree, the first team lead approves first (step 1), the first manager
 *    decides (final). Without a manager above, the team lead's approval is final; without anybody, the department
 *    managers decide. HR / Admin / HOD in the administrator program can always decide.
 */
import { one, query } from '../config/db';
import type { PortalRole } from '../utils/permissions';
import { withChildren } from './department.service';

interface Tree { parentOf: Map<number, number>; childrenOf: Map<number, number[]>; active: Set<number> }

async function tree(): Promise<Tree> {
  const rows = await query(`SELECT p.EmployeeId, p.ReportingManagerId FROM EmployeeProfiles p JOIN Employees e ON e.Id = p.EmployeeId
    WHERE p.ReportingManagerId IS NOT NULL`);
  const active = new Set((await query('SELECT Id FROM Employees WHERE IsActive = TRUE')).map((r) => r.Id as number));
  const parentOf = new Map<number, number>();
  const childrenOf = new Map<number, number[]>();
  for (const r of rows) {
    parentOf.set(r.EmployeeId, r.ReportingManagerId);
    childrenOf.set(r.ReportingManagerId, [...(childrenOf.get(r.ReportingManagerId) ?? []), r.EmployeeId]);
  }
  return { parentOf, childrenOf, active };
}

/** Role of an employee's login (null = no login). An 'Employee' with people reporting to them acts as a manager. */
export async function portalRole(employeeId: number): Promise<PortalRole | null> {
  const a = await one('SELECT Role, IsManager FROM PortalAccounts WHERE EmployeeId = @id', { id: employeeId });
  if (!a) return null;
  if (a.Role === 'TeamLead' || a.Role === 'Manager') return a.Role;
  return a.IsManager ? 'Manager' : 'Employee';
}

/** Everybody below this employee in the reporting tree (active only). */
function below(t: Tree, id: number): number[] {
  const out: number[] = [];
  const seen = new Set([id]);
  const stack = [...(t.childrenOf.get(id) ?? [])];
  while (stack.length) {
    const x = stack.pop()!;
    if (seen.has(x)) continue;
    seen.add(x);
    if (t.active.has(x)) out.push(x);
    stack.push(...(t.childrenOf.get(x) ?? []));
  }
  return out;
}

/** Ids of the employees a team lead / manager looks after. */
export async function teamIds(managerId: number): Promise<number[]> {
  const t = await tree();
  const reports = below(t, managerId);
  if (reports.length) return reports;
  if ((await portalRole(managerId)) !== 'Manager') return [];
  // A manager without reports: their department (everyone active if they have none), minus people with their own manager.
  const m = await one('SELECT DepartmentId FROM Employees WHERE Id = @id', { id: managerId });
  const depts = m?.DepartmentId ? await withChildren(m.DepartmentId) : null;
  const rows = await query('SELECT Id, DepartmentId FROM Employees WHERE IsActive = TRUE AND Id <> @id', { id: managerId });
  return rows.filter((r) => !t.parentOf.has(r.Id) && (!depts || (r.DepartmentId !== null && depts.includes(r.DepartmentId)))).map((r) => r.Id);
}

/** Team lead or manager = has a team role, or people reporting to them. */
export async function isManager(employeeId: number) {
  const role = await portalRole(employeeId);
  if (role === 'TeamLead' || role === 'Manager') return true;
  return below(await tree(), employeeId).length > 0;
}

export interface Chain { teamLead: number | null; managers: number[] }

/** The team lead (step 1) and the managers (final decision) of an employee's requests. */
export async function approvalChain(employeeId: number): Promise<Chain> {
  const t = await tree();
  let teamLead: number | null = null;
  let managers: number[] = [];
  const seen = new Set([employeeId]);
  for (let cur = t.parentOf.get(employeeId); cur !== undefined && !seen.has(cur) && seen.size < 50; cur = t.parentOf.get(cur)) {
    seen.add(cur);
    const role = await portalRole(cur);
    if (role === null) continue; // no login: cannot approve, look further up
    if (role === 'TeamLead') {
      if (teamLead === null) teamLead = cur;
      continue;
    }
    managers = [cur]; // Manager, or an Employee someone reports to (older data)
    break;
  }
  if (!managers.length) {
    const candidates = await query("SELECT EmployeeId FROM PortalAccounts WHERE (Role = 'Manager' OR IsManager) AND EmployeeId <> @id", { id: employeeId });
    for (const m of candidates)
      if (m.EmployeeId !== teamLead && !below(t, m.EmployeeId).length && (await teamIds(m.EmployeeId)).includes(employeeId)) managers.push(m.EmployeeId);
  }
  return { teamLead, managers };
}

/** Who is asked first about a new request (the team lead, else the managers). */
export async function approversOf(employeeId: number): Promise<number[]> {
  const c = await approvalChain(employeeId);
  return c.teamLead !== null ? [c.teamLead] : c.managers;
}

/**
 * What this team lead / manager may do with a pending item of this employee: 'first' (team lead's approval, the manager
 * decides later), 'final', or null (only view).
 */
export async function stageFor(actorId: number, employeeId: number, firstApprovedBy: string | null, chain?: Chain): Promise<'first' | 'final' | null> {
  if (actorId === employeeId) return null;
  const c = chain ?? await approvalChain(employeeId);
  if (c.managers.includes(actorId)) return 'final';
  if (c.teamLead === actorId) return c.managers.length ? (firstApprovedBy ? null : 'first') : 'final';
  // A manager higher up (the employee is in their team) may also decide.
  if ((await portalRole(actorId)) === 'Manager' && (await teamIds(actorId)).includes(employeeId)) return 'final';
  return null;
}
