/** Employee Portal (administrator): employee logins, managers, portal settings. */
import { exec, one, query } from '../config/db';
import { byEnroll } from '../models';
import { UserError } from '../utils/errors';
import { endSessions, hashPassword, randomPassword } from './portalAuth.service';
import { getSetting, setSetting } from './settings.service';

export async function list() {
  const rows = await query(`SELECT e.Id, e.EnrollNo, e.Name, d.Name Department, e.IsActive, a.IsManager, a.MustChange,
      to_char(a.LastLogin, 'YYYY-MM-DD HH24:MI') AS LastLogin, CASE WHEN a.EmployeeId IS NULL THEN 0 ELSE 1 END AS HasAccount
    FROM Employees e LEFT JOIN Departments d ON d.Id = e.DepartmentId LEFT JOIN PortalAccounts a ON a.EmployeeId = e.Id`);
  return rows.map((r) => ({ ...r, IsActive: !!r.IsActive, IsManager: !!r.IsManager, MustChange: !!r.MustChange, HasAccount: !!r.HasAccount })).sort(byEnroll);
}

/** Creates / resets logins; without a password a random one is made. Returns the passwords to hand out. */
export async function createOrReset(ids: number[], password: string) {
  if (!ids.length) throw new UserError('Select employees first.');
  if (password && password.length < 6) throw new UserError('The password must have at least 6 characters.');
  const out: { EnrollNo: string; Name: string; Password: string }[] = [];
  for (const id of ids) {
    const e = await one('SELECT EnrollNo, Name FROM Employees WHERE Id = @id', { id });
    if (!e) continue;
    const pwd = password || randomPassword();
    await exec(`INSERT INTO PortalAccounts (EmployeeId, PasswordHash, MustChange) VALUES (@id, @h, TRUE)
      ON CONFLICT (EmployeeId) DO UPDATE SET PasswordHash = EXCLUDED.PasswordHash, MustChange = TRUE`, { id, h: hashPassword(pwd) });
    out.push({ EnrollNo: e.EnrollNo, Name: e.Name, Password: pwd });
  }
  endSessions(ids);
  return out;
}

export async function setManager(employeeId: number, isManager: boolean) {
  const n = await exec('UPDATE PortalAccounts SET IsManager = @m WHERE EmployeeId = @id', { m: isManager, id: employeeId });
  if (!n) throw new UserError('Create the login first.');
}

export async function removeMany(ids: number[]) {
  await exec('DELETE FROM PortalAccounts WHERE EmployeeId = ANY(@ids)', { ids });
  endSessions(ids);
}

export async function settings() {
  return { allowCheckIn: (await getSetting('Portal.AllowCheckIn', '1')) === '1', officeName: await getSetting('Portal.OfficeName') };
}

export async function saveSettings(allowCheckIn: boolean, officeName: string) {
  await setSetting('Portal.AllowCheckIn', allowCheckIn ? '1' : '0');
  await setSetting('Portal.OfficeName', officeName.trim());
}
