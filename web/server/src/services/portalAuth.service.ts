/**
 * Employee logins of the portal / mobile app: AC No + password (scrypt hash in PortalAccounts). The administrator creates
 * them (portalAccount.service); the employee must change a temporary password at the first login.
 */
import crypto from 'crypto';
import { exec, one } from '../config/db';
import { UserError } from '../utils/errors';

export function hashPassword(pwd: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(pwd, salt, 32).toString('hex')}`;
}

export function checkPassword(pwd: string, stored: string): boolean {
  const [kind, salt, hex] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hex) return false;
  const want = Buffer.from(hex, 'hex');
  return crypto.timingSafeEqual(crypto.scryptSync(pwd, salt, want.length), want);
}

/** Temporary password the administrator hands out (no look-alike characters). */
export function randomPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(8), (b) => chars[b % chars.length]).join('');
}

const TTL = 30 * 24 * 3600_000; // the app stays logged in for a month
const sessions = new Map<string, { employeeId: number; expires: number }>();

/** Employee id of a valid session (and extends it), else null. */
export function sessionEmployee(token: string): number | null {
  const s = sessions.get(token);
  if (!s || s.expires < Date.now()) return null;
  s.expires = Date.now() + TTL;
  return s.employeeId;
}

export const logout = (token: string) => sessions.delete(token);

/** Ends every session of these employees (password reset, login removed). */
export function endSessions(employeeIds: number[]) {
  for (const [k, s] of sessions) if (employeeIds.includes(s.employeeId)) sessions.delete(k);
}

export async function login(enrollNo: string, password: string) {
  const acc = await one(`SELECT a.EmployeeId, a.PasswordHash, a.MustChange, e.IsActive FROM PortalAccounts a JOIN Employees e ON e.Id = a.EmployeeId
    WHERE e.EnrollNo = @e`, { e: enrollNo.trim() });
  if (!acc || !checkPassword(password, acc.PasswordHash)) throw new UserError('Wrong AC No or password.', 401);
  if (!acc.IsActive) throw new UserError('Your employee record is inactive. Please contact HR.', 403);
  await exec('UPDATE PortalAccounts SET LastLogin = SYSDATETIME() WHERE EmployeeId = @id', { id: acc.EmployeeId });
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { employeeId: acc.EmployeeId, expires: Date.now() + TTL });
  return { token, mustChange: !!acc.MustChange };
}

export async function changePassword(employeeId: number, current: string, next: string, confirm: string) {
  const acc = await one('SELECT PasswordHash FROM PortalAccounts WHERE EmployeeId = @id', { id: employeeId });
  if (!acc || !checkPassword(current, acc.PasswordHash)) throw new UserError('The current password is incorrect.');
  if (next.length < 6) throw new UserError('The new password must have at least 6 characters.');
  if (next !== confirm) throw new UserError('The passwords do not match.');
  await exec('UPDATE PortalAccounts SET PasswordHash = @h, MustChange = 0 WHERE EmployeeId = @id', { h: hashPassword(next), id: employeeId });
}
