/** Users with a role (AdminUsers): list, add, change, delete. Only an Admin reaches these (utils/permissions). */
import { exec, one, query } from '../config/db';
import { UserError } from '../utils/errors';
import { isRole, ROLES } from '../utils/permissions';
import { endUserSessions } from './auth.service';
import { hashPassword } from './portalAuth.service';

export async function list() {
  const rows = await query(`SELECT Id, UserName, FullName, Role, IsActive, CONVERT(varchar(16), LastLogin, 120) LastLogin,
    CONVERT(varchar(10), CreatedAt, 120) CreatedAt FROM AdminUsers ORDER BY UserName`);
  return { users: rows.map((r) => ({ ...r, FullName: r.FullName ?? '', IsActive: !!r.IsActive, LastLogin: r.LastLogin ?? '' })), roles: ROLES };
}

export interface UserInput { UserName?: unknown; FullName?: unknown; Role?: unknown; IsActive?: unknown; Password?: unknown }

export async function save(id: number | null, b: UserInput) {
  const name = String(b.UserName ?? '').trim();
  if (!/^[\w.\-@]{2,50}$/.test(name)) throw new UserError('User name: 2 to 50 letters, digits or . - _ @');
  if (name.toLowerCase() === 'supervisor') throw new UserError('Supervisor is the built-in administrator; choose another name.');
  if (!isRole(b.Role)) throw new UserError('Choose a role.');
  const pwd = String(b.Password ?? '');
  if ((!id || pwd) && pwd.length < 6) throw new UserError('The password must have at least 6 characters.');
  if (await one('SELECT Id FROM AdminUsers WHERE UserName = @n AND Id <> @id', { n: name, id: id ?? 0 })) throw new UserError('This user name is taken.');
  const p = { n: name, f: String(b.FullName ?? '').trim().slice(0, 100) || null, r: b.Role, a: b.IsActive !== false, h: pwd ? hashPassword(pwd) : null, id };
  if (id) {
    const n = await exec(`UPDATE AdminUsers SET UserName = @n, FullName = @f, Role = @r, IsActive = @a,
      PasswordHash = ISNULL(@h, PasswordHash) WHERE Id = @id`, p);
    if (!n) throw new UserError('User not found.', 404);
    endUserSessions(id);
    return id;
  }
  return (await one('INSERT INTO AdminUsers (UserName, FullName, Role, IsActive, PasswordHash) OUTPUT INSERTED.Id VALUES (@n, @f, @r, @a, @h)', p))!.Id as number;
}

export async function remove(id: number) {
  await exec('DELETE FROM AdminUsers WHERE Id = @id', { id });
  endUserSessions(id);
}
