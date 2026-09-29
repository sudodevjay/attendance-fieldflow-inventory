/**
 * Administrator login. Two kinds of users:
 *  - the Supervisor password of the Windows program (Maintenance/Options → Administrator): same SHA-256 hash in
 *    AppSettings.AdminPasswordHash; any user name, role Admin. Without a password the administrator program only opens on
 *    the server PC itself (see middlewares/auth.middleware).
 *  - users with a role (AdminUsers, web only): own user name and password (scrypt), role Admin / HR / Payroll / Viewer.
 */
import crypto from 'crypto';
import { exec, one } from '../config/db';
import { UserError } from '../utils/errors';
import { isRole, type Role } from '../utils/permissions';
import { checkPassword } from './portalAuth.service';
import { getSetting, setSetting } from './settings.service';

const KEY = 'AdminPasswordHash';
const TTL = 12 * 3600_000;

export interface AdminSession { user: string; role: Role; userId: number | null }
const sessions = new Map<string, AdminSession & { expires: number }>();

export const NO_PASSWORD_REMOTE = 'The administrator program has no password yet, so it only opens on the server PC itself. ' +
  'Set a password there (Maintenance/Options → Administrator) to use it from other computers. Employees use /me.';

export const hash = (s: string) => crypto.createHash('sha256').update('zkatt:' + s, 'utf8').digest('hex').toUpperCase();
export const hasPassword = async () => (await getSetting(KEY)) !== '';

export async function login(user: string, password: string, local: boolean) {
  const name = user.trim() || 'Supervisor';
  const account = await one('SELECT Id, UserName, PasswordHash, Role, IsActive FROM AdminUsers WHERE UserName = @u', { u: name });
  let session: AdminSession;
  if (account && checkPassword(password, account.PasswordHash)) {
    if (!account.IsActive) throw new UserError('This user is disabled.', 403);
    await exec('UPDATE AdminUsers SET LastLogin = SYSDATETIME() WHERE Id = @id', { id: account.Id });
    session = { user: account.UserName, role: isRole(account.Role) ? account.Role : 'Viewer', userId: account.Id };
  } else {
    if (!(await hasPassword()) && !local) throw new UserError(NO_PASSWORD_REMOTE, 403);
    if ((await hasPassword()) && hash(password) !== (await getSetting(KEY))) throw new UserError('Incorrect user name or password.', 401);
    session = { user: name, role: 'Admin', userId: null };
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { ...session, expires: Date.now() + TTL });
  return { token, ...session };
}

/** User of a valid session (and extends it), else null. */
export function sessionUser(token: string): AdminSession | null {
  const s = sessions.get(token);
  if (!s || s.expires <= Date.now()) return null;
  s.expires = Date.now() + TTL;
  return { user: s.user, role: s.role, userId: s.userId };
}

export const logout = (token: string) => sessions.delete(token);

/** Ends the sessions of a role user (changed, disabled or deleted). */
export function endUserSessions(userId: number) {
  for (const [k, s] of sessions) if (s.userId === userId) sessions.delete(k);
}

export async function changePassword(current: string, next: string, confirm: string) {
  if ((await hasPassword()) && hash(current) !== (await getSetting(KEY))) throw new UserError('The current password is incorrect.');
  if (next !== confirm) throw new UserError('The passwords do not match.');
  await setSetting(KEY, next.length === 0 ? '' : hash(next));
  return next.length === 0 ? 'Password removed.' : 'Password set.';
}
