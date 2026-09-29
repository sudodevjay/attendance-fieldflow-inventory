/**
 * User roles of the administrator program. Every /api path belongs to an area; GET = read, anything else = write
 * (except the few POSTs that only read). The Supervisor password always logs in as Admin.
 *   Admin    everything
 *   HR       employees, attendance, leave, portal requests, reports, announcements; reads the rest (not users)
 *   Payroll  salary structure / rules and reports; reads the rest (not users)
 *   Viewer   reads everything except users and the audit log
 */
export const ROLES = ['Admin', 'HR', 'Payroll', 'Viewer'] as const;
export type Role = (typeof ROLES)[number];

export type Area = 'dashboard' | 'employees' | 'attendance' | 'leave' | 'reports' | 'payroll' | 'devices' | 'portal' | 'settings' | 'users' | 'audit';

const ALL: Area[] = ['dashboard', 'employees', 'attendance', 'leave', 'reports', 'payroll', 'devices', 'portal', 'settings', 'users', 'audit'];

const AREAS: [RegExp, Area][] = [
  [/^\/dashboard/, 'dashboard'],
  [/^\/(departments|employees|documents)/, 'employees'],
  [/^\/(shifts|schedule|roster|logs)/, 'attendance'],
  [/^\/leave/, 'leave'],
  [/^\/reports/, 'reports'],
  [/^\/(payroll|settings\/salary-rule)/, 'payroll'],
  [/^\/devices/, 'devices'],
  [/^\/(portal-admin|notifications)/, 'portal'],
  [/^\/users/, 'users'],
  [/^\/audit/, 'audit'],
  [/^\/settings/, 'settings'],
];

/** POSTs that only read data. */
const READ_POSTS = [/^\/employees\/(photos|export)$/, /^\/notifications\/read$/, /^\/logs\/export$/];

const WRITE: Record<Role, Area[]> = {
  Admin: ALL,
  HR: ['employees', 'attendance', 'leave', 'portal', 'reports', 'dashboard'],
  Payroll: ['payroll', 'reports', 'dashboard'],
  Viewer: [],
};
const NO_READ: Record<Role, Area[]> = { Admin: [], HR: ['users'], Payroll: ['users'], Viewer: ['users', 'audit'] };

export const areaOf = (path: string): Area => AREAS.find(([re]) => re.test(path))?.[1] ?? 'settings';

export function allowed(role: Role, method: string, path: string): boolean {
  const area = areaOf(path);
  if (NO_READ[role].includes(area)) return false;
  const read = method === 'GET' || method === 'HEAD' || READ_POSTS.some((re) => re.test(path));
  return read || WRITE[role].includes(area);
}

/** Areas the role may open (read) and change (write): the client hides the rest. */
export const permissions = (role: Role) => ({
  read: ALL.filter((a) => !NO_READ[role].includes(a)),
  write: ALL.filter((a) => !NO_READ[role].includes(a) && WRITE[role].includes(a)),
});

export const isRole = (v: unknown): v is Role => (ROLES as readonly string[]).includes(String(v));
