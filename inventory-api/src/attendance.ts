/**
 * Everything the inventory needs from attendance, over attendance's API only (GET /api/internal/directory,
 * POST /api/internal/notifications with the SERVICE_TOKEN). Employees, departments and work sites are kept as a read-only
 * copy (Dir* tables) so the inventory's queries can show names; attendance owns them. The copy is refreshed when the
 * attendance server says its data changed (X-Directory-Version on every request it forwards) and at least every minute.
 */
import { config } from './config';
import { exec, one, query, transaction } from './db';

let synced: string | null = null;
let lastSync = 0;
let running: Promise<void> | null = null;
let company = { name: 'Inventory', address: '' };

async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
  const res = await fetch(config.attendanceUrl + path, {
    method, signal: AbortSignal.timeout(90_000),
    headers: { 'Content-Type': 'application/json', 'X-Service-Token': config.serviceToken },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`attendance ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const lower = (rows: Record<string, unknown>[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v])));

async function sync() {
  const d = await call('GET', '/api/internal/directory');
  await transaction(async (tx) => {
    await exec('DELETE FROM DirSiteEmployees; DELETE FROM DirSites; DELETE FROM DirEmployees; DELETE FROM DirDepartments', {}, tx);
    await exec(`INSERT INTO DirDepartments (Id, Name, ParentId) SELECT id, name, parentid FROM json_to_recordset(CAST(@j AS json)) AS x(id int, name text, parentid int)`,
      { j: JSON.stringify(lower(d.departments)) }, tx);
    await exec(`INSERT INTO DirEmployees (Id, EnrollNo, Name, DepartmentId, Designation, IsActive, CardNo)
      SELECT id, enrollno, name, departmentid, designation, isactive, cardno
      FROM json_to_recordset(CAST(@j AS json)) AS x(id int, enrollno text, name text, departmentid int, designation text, isactive boolean, cardno text)`,
    { j: JSON.stringify(lower(d.employees)) }, tx);
    await exec(`INSERT INTO DirSites (Id, Name, AllEmployees, IsActive) SELECT id, name, allemployees, isactive
      FROM json_to_recordset(CAST(@j AS json)) AS x(id int, name text, allemployees boolean, isactive boolean)`, { j: JSON.stringify(lower(d.sites)) }, tx);
    await exec(`INSERT INTO DirSiteEmployees (SiteId, EmployeeId) SELECT siteid, employeeid FROM json_to_recordset(CAST(@j AS json)) AS x(siteid int, employeeid int)
      ON CONFLICT DO NOTHING`, { j: JSON.stringify(lower(d.siteEmployees)) }, tx);
    // Deleted in attendance: the documents keep the name they were saved with, the link goes (as ON DELETE SET NULL did).
    if (d.employees.length) {
      for (const [t, c] of [['InvRequisitions', 'EmployeeId'], ['InvIssues', 'EmployeeId'], ['InvMovements', 'EmployeeId'], ['InvWarehouses', 'InchargeId'], ['InvUnits', 'EmployeeId']])
        await exec(`UPDATE ${t} SET ${c} = NULL WHERE ${c} IS NOT NULL AND ${c} NOT IN (SELECT Id FROM DirEmployees)`, {}, tx);
      await exec('DELETE FROM InvBins WHERE EmployeeId NOT IN (SELECT Id FROM DirEmployees)', {}, tx);
    }
    for (const t of ['InvRequisitions', 'InvIssues', 'InvMovements'])
      await exec(`UPDATE ${t} SET DepartmentId = NULL WHERE DepartmentId IS NOT NULL AND DepartmentId NOT IN (SELECT Id FROM DirDepartments)`, {}, tx);
    for (const t of ['InvRequisitions', 'InvIssues', 'InvSiteUsage', 'InvUnits'])
      await exec(`UPDATE ${t} SET SiteId = NULL WHERE SiteId IS NOT NULL AND SiteId NOT IN (SELECT Id FROM DirSites)`, {}, tx);
  });
  company = { name: d.company?.name || 'Inventory', address: d.company?.address || '' };
  synced = String(d.version ?? '');
  lastSync = Date.now();
}

/** Brings the copy up to date: when attendance's version differs, or the copy is older than a minute. */
export async function ensureDirectory(version?: string | null) {
  if (version ? version === synced : Date.now() - lastSync < 60_000) return;
  running ??= sync().finally(() => { running = null; });
  try {
    await running;
  } catch (e: any) {
    // Attendance unreachable: keep working with the copy there is (if any).
    console.error('directory not refreshed:', e.message ?? e);
    if (!lastSync) throw e;
  }
}

export const companyName = () => company.name;
export const companyAddress = () => company.address;

/** In-app notification to an employee (portal / app); never fails the caller. */
export async function notify(employeeId: number | null, title: string, body = '', link = '') {
  try {
    await call('POST', '/api/internal/notifications', { employeeId, title, body, link });
  } catch (e: any) { console.error('notification not sent:', e.message ?? e); }
}

/** A department and all its sub-departments (from the copy). */
export async function withChildren(id: number): Promise<number[]> {
  return (await query(`WITH RECURSIVE t AS (SELECT Id FROM DirDepartments WHERE Id = @id
    UNION SELECT d.Id FROM DirDepartments d JOIN t ON d.ParentId = t.Id) SELECT Id FROM t`, { id })).map((r) => r.Id as number);
}

/** Active work sites an employee works at. */
export async function sitesOf(employeeId: number): Promise<{ Id: number; Name: string }[]> {
  return query(`SELECT s.Id, s.Name FROM DirSites s WHERE s.IsActive
    AND (s.AllEmployees OR EXISTS (SELECT 1 FROM DirSiteEmployees x WHERE x.SiteId = s.Id AND x.EmployeeId = @e)) ORDER BY s.Name`, { e: employeeId });
}

export async function directoryCounts() {
  return one('SELECT (SELECT COUNT(*) FROM DirEmployees) AS Employees, (SELECT COUNT(*) FROM DirSites) AS Sites');
}
