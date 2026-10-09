/**
 * Data scope of the logged-in administrator user. An HOD only sees the employees of their department and its
 * sub-departments; everybody else sees everything. The scope is set per request (middlewares/auth: withScope) and read
 * by the services, so a service does not need an extra parameter: loadEmployees (and with it attendance, reports and the
 * dashboard), the employee list, AC Log, leave, requests, departments and the portal logins filter by it.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { UserError } from './errors';

export interface Scope {
  /** Employees the user may see; null = all. */
  employeeIds: Set<number> | null;
  /** Departments the user may see; null = all. */
  departmentIds: Set<number> | null;
  enrollNos: Set<string> | null;
}

const store = new AsyncLocalStorage<Scope>();

export const runInScope = <T>(scope: Scope, fn: () => T) => store.run(scope, fn);

const current = () => store.getStore();

/** Employee ids of the scope, null = everybody. */
export const scopeIds = (): Set<number> | null => current()?.employeeIds ?? null;
export const scopeDepartments = (): Set<number> | null => current()?.departmentIds ?? null;
export const scopeEnrollNos = (): Set<string> | null => current()?.enrollNos ?? null;
export const scoped = () => scopeIds() !== null;

export const inScope = (employeeId: number | null | undefined) => {
  const ids = scopeIds();
  return !ids || (employeeId !== null && employeeId !== undefined && ids.has(employeeId));
};

/** Keeps the rows whose employee is in the scope. */
export function filterScope<T>(rows: T[], idOf: (r: T) => number | null | undefined): T[] {
  const ids = scopeIds();
  return ids ? rows.filter((r) => { const id = idOf(r); return id !== null && id !== undefined && ids.has(id); }) : rows;
}

export function assertInScope(employeeId: number | null | undefined) {
  if (!inScope(employeeId)) throw new UserError('This employee is not in your department.', 403);
}
