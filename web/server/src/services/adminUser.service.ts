/** Users with a role (AdminUsers): list, add, change, delete. Only a SuperAdmin reaches these (utils/permissions). */
import { exec, one, query } from '../config/db';
import { UserError } from '../utils/errors';
import { isRole, ROLES } from '../utils/permissions';
import { endUserSessions } from './auth.service';
import { hashPassword } from './portalAuth.service';

export async function list() {
  const rows = await query(`SELECT u.Id, u.UserName, u.FullName, u.Role, u.IsActive, u.DepartmentId, d.Name Department,
    to_char(u.LastLogin, 'YYYY-MM-DD HH24:MI') AS LastLogin, to_char(u.CreatedAt, 'YYYY-MM-DD') AS CreatedAt
    FROM AdminUsers u LEFT JOIN Departments d ON d.Id = u.DepartmentId ORDER BY u.UserName`);
  return {
    users: rows.map((r) => ({ ...r, FullName: r.FullName ?? '', IsActive: !!r.IsActive, LastLogin: r.LastLogin ?? '', Department: r.Department ?? '' })),
    roles: ROLES,
  };
}

export interface UserInput { UserName?: unknown; FullName?: unknown; Role?: unknown; IsActive?: unknown; Password?: unknown; DepartmentId?: unknown }

export async function save(id: number | null, b: UserInput) {
  const name = String(b.UserName ?? '').trim();
  if (!/^[\w.\-@]{2,50}$/.test(name)) throw new UserError('User name: 2 to 50 letters, digits or . - _ @');
  if (name.toLowerCase() === 'supervisor') throw new UserError('Supervisor is the built-in administrator; choose another name.');
  if (!isRole(b.Role)) throw new UserError('Choose a role.');
  // An HOD sees one department (with its sub-departments); the other roles see everything.
  const dept = b.Role === 'HOD' ? Number(b.DepartmentId) || null : null;
  if (b.Role === 'HOD' && (!dept || !(await one('SELECT Id FROM Departments WHERE Id = @d', { d: dept }))))
    throw new UserError('Choose the department of the HOD.');
  const pwd = String(b.Password ?? '');
  if ((!id || pwd) && pwd.length < 6) throw new UserError('The password must have at least 6 characters.');
  if (await one('SELECT Id FROM AdminUsers WHERE lower(UserName) = lower(@n) AND Id <> @id', { n: name, id: id ?? 0 })) throw new UserError('This user name is taken.');
  const p = {
    n: name, f: String(b.FullName ?? '').trim().slice(0, 100) || null, r: b.Role, a: b.IsActive !== false, h: pwd ? hashPassword(pwd) : null,
    d: dept, id,
  };
  if (id) {
    const n = await exec(`UPDATE AdminUsers SET UserName = @n, FullName = @f, Role = @r, IsActive = @a, DepartmentId = @d,
      PasswordHash = COALESCE(@h, PasswordHash) WHERE Id = @id`, p);
    if (!n) throw new UserError('User not found.', 404);
    endUserSessions(id);
    return id;
  }
  return (await one(`INSERT INTO AdminUsers (UserName, FullName, Role, IsActive, PasswordHash, DepartmentId)
    VALUES (@n, @f, @r, @a, @h, @d) RETURNING Id`, p))!.Id as number;
}

export async function remove(id: number) {
  await exec('DELETE FROM AdminUsers WHERE Id = @id', { id });
  endUserSessions(id);
}
