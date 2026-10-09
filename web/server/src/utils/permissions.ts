/**
 * User roles of the administrator program. Every /api path belongs to an area; GET = read, anything else = write
 * (except the few POSTs that only read). The Supervisor password logs in as SuperAdmin.
 *   SuperAdmin  everything, also users & roles, audit log and the system (database, backup, Raspberry Pi, Supervisor
 *               password)
 *   Admin       everything else: employees, attendance, leave, payroll, devices, portal, company settings
 *   HOD         head of department: only their department and its sub-departments (see utils/scope); reads employees,
 *               attendance and reports, decides leave and requests; no salaries
 *   HR          employees, holidays, shifts, attendance, leave, portal requests, reports, announcements; reads the rest
 *   Payroll     salary structure / rules and reports; reads the rest
 *   Viewer      reads everything except users, audit log and system
 *   StoreKeeper the inventory only (items, stock, purchase, requisitions / issues, its reports); no attendance screens
 * Inventory (the module in modules/inventory): SuperAdmin / Admin / StoreKeeper manage it; an HOD reads it for their
 * departments and approves their requisitions; Viewer reads it; HR and Payroll do not see it (attendance only).
 * Team leads and managers are employees: they work in the employee portal (/me) and the app, not here.
 */
export const ROLES = ['SuperAdmin', 'Admin', 'HOD', 'HR', 'Payroll', 'Viewer', 'StoreKeeper'] as const;
export type Role = (typeof ROLES)[number];

export type Area =
  | 'dashboard' | 'employees' | 'attendance' | 'leave' | 'reports' | 'payroll' | 'devices' | 'portal' | 'settings' | 'users' | 'audit'
  | 'system' | 'inventory';

const ALL: Area[] = ['dashboard', 'employees', 'attendance', 'leave', 'reports', 'payroll', 'devices', 'portal', 'settings', 'users', 'audit', 'system', 'inventory'];
/** Everything but the inventory. */
const ATTENDANCE: Area[] = ALL.filter((a) => a !== 'inventory');

const AREAS: [RegExp, Area][] = [
  [/^\/inventory/, 'inventory'],
  [/^\/dashboard/, 'dashboard'],
  [/^\/(departments|employees|documents)/, 'employees'],
  [/^\/(shifts|schedule|roster|logs|sites)/, 'attendance'],
  [/^\/leave/, 'leave'],
  [/^\/reports\/salary-slip/, 'payroll'],
  [/^\/reports/, 'reports'],
  [/^\/(payroll|settings\/salary-rule)/, 'payroll'],
  [/^\/devices/, 'devices'],
  [/^\/(portal-admin|notifications)/, 'portal'],
  [/^\/users/, 'users'],
  [/^\/audit/, 'audit'],
  [/^\/settings\/(test-connection|connection|backup|pi|admin-password)/, 'system'],
  [/^\/settings/, 'settings'],
];

/** What an HOD may change: leave of their department and the decisions on its requests (not holidays, types, settings). */
const HOD_WRITES = [/^\/leave\/(entries|entries\/delete|decide)$/, /^\/portal-admin\/requests\/decide$/, /^\/notifications\/read$/,
  /^\/inventory\/requisitions\/\d+\/(decide|cancel)$/];

/** POSTs that only read data. */
const READ_POSTS = [/^\/employees\/(photos|export)$/, /^\/notifications\/read$/, /^\/logs\/export$/];

const WRITE: Record<Role, Area[]> = {
  SuperAdmin: ALL,
  Admin: ALL.filter((a) => !['users', 'audit', 'system'].includes(a)),
  HOD: [], // only HOD_WRITES
  HR: ['employees', 'attendance', 'leave', 'portal', 'reports', 'dashboard'],
  Payroll: ['payroll', 'reports', 'dashboard'],
  Viewer: [],
  StoreKeeper: ['inventory'],
};
const NO_READ: Record<Role, Area[]> = {
  SuperAdmin: [],
  Admin: ['users', 'audit', 'system'],
  HOD: ['payroll', 'devices', 'users', 'audit', 'system'],
  HR: ['users', 'system', 'inventory'],
  Payroll: ['users', 'system', 'inventory'],
  Viewer: ['users', 'audit', 'system'],
  StoreKeeper: ATTENDANCE,
};

/** Reports with salaries: only for roles that may read payroll. */
export const PAYROLL_REPORTS = ['SalarySheet', 'PayrollRegister', 'BankTransfer', 'Statutory'];

export const areaOf = (path: string): Area => AREAS.find(([re]) => re.test(path))?.[1] ?? 'settings';

export function allowed(role: Role, method: string, path: string): boolean {
  const area = areaOf(path);
  if (NO_READ[role].includes(area)) return false;
  const read = method === 'GET' || method === 'HEAD' || READ_POSTS.some((re) => re.test(path));
  if (read) return true;
  if (role === 'HOD') return HOD_WRITES.some((re) => re.test(path));
  return WRITE[role].includes(area);
}

export const canRead = (role: Role, area: Area) => !NO_READ[role].includes(area);

/** Areas the role may open (read) and change (write): the client hides the rest. */
export const permissions = (role: Role) => ({
  read: ALL.filter((a) => !NO_READ[role].includes(a)),
  write: role === 'HOD' ? ['leave', 'portal', 'inventory'] as Area[] : ALL.filter((a) => !NO_READ[role].includes(a) && WRITE[role].includes(a)),
  scoped: role === 'HOD',
});

/** Old sessions / rows may still say 'Admin' for the built-in administrator. */
export const isRole = (v: unknown): v is Role => (ROLES as readonly string[]).includes(String(v));

/** Roles of employees in the portal (PortalAccounts.Role). */
export const PORTAL_ROLES = ['Employee', 'TeamLead', 'Manager'] as const;
export type PortalRole = (typeof PORTAL_ROLES)[number];
export const isPortalRole = (v: unknown): v is PortalRole => (PORTAL_ROLES as readonly string[]).includes(String(v));
