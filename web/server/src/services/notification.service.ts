/**
 * In-app notifications (Notifications table): for an employee (portal / app bell) or, with no employee, for HR in the
 * administrator program. Written when a request is made or decided and when HR sends an announcement.
 */
import { exec, one, query } from '../config/db';
import { UserError } from '../utils/errors';
import { fmt, parse } from '../utils/time';
import { withChildren } from './department.service';

/** Adds a notification; never fails the action that caused it. */
export async function notify(employeeId: number | null, title: string, body = '', link = '') {
  try {
    await exec('INSERT INTO Notifications (EmployeeId, Title, Body, Link) VALUES (@e, @t, @b, @l)',
      { e: employeeId, t: title.slice(0, 150), b: body.slice(0, 500) || null, l: link.slice(0, 100) || null });
  } catch (e) { console.error('notification not saved:', e); }
}

/** Latest notifications of an employee (null = HR), with the unread count. */
export async function list(employeeId: number | null, limit = 50) {
  const where = employeeId === null ? 'EmployeeId IS NULL' : 'EmployeeId = @e';
  const rows = await query(`SELECT TOP (@n) Id, Title, Body, Link, IsRead, CONVERT(varchar(19), CreatedAt, 120) CreatedAt
    FROM Notifications WHERE ${where} ORDER BY CreatedAt DESC, Id DESC`, { e: employeeId, n: Math.min(200, Math.max(1, limit)) });
  const unread = (await one(`SELECT COUNT(*) c FROM Notifications WHERE ${where} AND IsRead = 0`, { e: employeeId }))?.c ?? 0;
  return {
    unread,
    items: rows.map((r) => ({ ...r, IsRead: !!r.IsRead, When: fmt(parse(r.CreatedAt)!, 'dd MMM, hh:mm tt') })),
  };
}

export async function unreadCount(employeeId: number | null) {
  return (await one(`SELECT COUNT(*) c FROM Notifications WHERE ${employeeId === null ? 'EmployeeId IS NULL' : 'EmployeeId = @e'} AND IsRead = 0`,
    { e: employeeId }))?.c ?? 0;
}

/** Marks some (ids) or all notifications of the owner as read. */
export async function markRead(employeeId: number | null, ids: number[] | 'all') {
  const owner = employeeId === null ? 'EmployeeId IS NULL' : 'EmployeeId = @e';
  if (ids === 'all') await exec(`UPDATE Notifications SET IsRead = 1 WHERE ${owner} AND IsRead = 0`, { e: employeeId });
  else if (ids.length) await exec(`UPDATE Notifications SET IsRead = 1 WHERE ${owner} AND Id IN (SELECT value FROM OPENJSON(@ids))`, { e: employeeId, ids });
}

/** Announcement from HR to every active employee, or to a department (with its sub-departments). */
export async function broadcast(title: string, body: string, departmentId: number | null) {
  title = title.trim();
  if (!title) throw new UserError('Enter the title.');
  const depts = departmentId ? await withChildren(departmentId) : null;
  const rows = await query('SELECT Id, DepartmentId FROM Employees WHERE IsActive = 1');
  const ids = rows.filter((r) => !depts || (r.DepartmentId !== null && depts.includes(r.DepartmentId))).map((r) => r.Id as number);
  if (!ids.length) throw new UserError('No active employees in this department.');
  await exec(`INSERT INTO Notifications (EmployeeId, Title, Body, Link) SELECT CAST(value AS int), @t, @b, 'announcement' FROM OPENJSON(@ids)`,
    { ids, t: title.slice(0, 150), b: body.trim().slice(0, 500) || null });
  return `Announcement sent to ${ids.length} employee(s).`;
}
