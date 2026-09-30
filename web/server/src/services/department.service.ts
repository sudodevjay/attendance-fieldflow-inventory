/** Department List: company tree with sub-departments (DepartmentWindow.cs). */
import { exec, one, query } from '../config/db';
import { scopeDepartments } from '../utils/scope';
import { UserError } from '../utils/errors';
import { companyName } from './settings.service';

/** The department and all its sub-departments ("include sub department"). */
export async function withChildren(id: number): Promise<number[]> {
  const all = await query<{ Id: number; ParentId: number | null }>('SELECT Id, ParentId FROM Departments');
  const set = new Set([id]);
  let added = true;
  while (added) {
    added = false;
    for (const d of all) if (d.ParentId !== null && set.has(d.ParentId) && !set.has(d.Id)) { set.add(d.Id); added = true; }
  }
  return [...set];
}

export async function list() {
  const departments = await query(`SELECT d.Id, d.Name, d.ParentId, (SELECT COUNT(*) FROM Employees e WHERE e.DepartmentId = d.Id) Employees
    FROM Departments d ORDER BY d.Name`);
  // HOD: their department tree only; its top department is shown directly under the company.
  const sc = scopeDepartments();
  const visible = sc ? departments.filter((d) => sc.has(d.Id)).map((d) => ({ ...d, ParentId: d.ParentId !== null && sc.has(d.ParentId) ? d.ParentId : null })) : departments;
  return { company: (await companyName()).toUpperCase(), departments: visible };
}

export async function create(name: string, parentId: number | null) {
  name = name.trim();
  if (!name) throw new UserError('Department name is required.');
  const r = await one('INSERT INTO Departments (Name, ParentId) VALUES (@n, @p) RETURNING Id', { n: name.slice(0, 100), p: parentId });
  return r!.Id as number;
}

export async function rename(id: number, name: string) {
  name = name.trim();
  if (!name) throw new UserError('Department name is required.');
  await exec('UPDATE Departments SET Name = @n WHERE Id = @id', { n: name.slice(0, 100), id });
}

/** Moves a department under another one (null = directly under the company). */
export async function move(id: number, parentId: number | null) {
  if (parentId !== null && (await withChildren(id)).includes(parentId))
    throw new UserError('A department cannot be moved under one of its own sub-departments.');
  await exec('UPDATE Departments SET ParentId = @p WHERE Id = @id', { p: parentId, id });
}

/** Employees of a deleted department are left without one. */
export async function remove(id: number) {
  if (await one('SELECT Id FROM Departments WHERE ParentId = @id LIMIT 1', { id }))
    throw new UserError('This department has sub-departments. Delete or move them first.');
  await exec('UPDATE Employees SET DepartmentId = NULL WHERE DepartmentId = @id; DELETE FROM Departments WHERE Id = @id', { id });
}
