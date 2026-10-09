/**
 * /api/internal — for the other services of the app (the inventory), with the shared SERVICE_TOKEN; not for browsers.
 *   GET  /directory       employees, departments, work sites (+ who may work where), company name / address, data version
 *   POST /notifications   { employeeId, title, body, link }: in-app notification to an employee (portal / app)
 */
import { Router } from 'express';
import { query } from '../config/db';
import { notify } from '../services/notification.service';
import { directoryVersion, requireService } from '../services/inventoryGateway';
import { companyAddress, companyName } from '../services/settings.service';

export const internalRoutes = Router();
internalRoutes.use(requireService);

internalRoutes.get('/directory', async (_req, res) => {
  const version = directoryVersion();
  res.json({
    version,
    company: { name: await companyName(), address: await companyAddress() },
    employees: await query('SELECT Id, EnrollNo, Name, DepartmentId, Designation, IsActive, CardNo FROM Employees ORDER BY Id'),
    departments: await query('SELECT Id, Name, ParentId FROM Departments ORDER BY Id'),
    sites: await query('SELECT Id, Name, AllEmployees, IsActive FROM WorkSites ORDER BY Id'),
    siteEmployees: await query('SELECT SiteId, EmployeeId FROM SiteEmployees'),
  });
});

internalRoutes.post('/notifications', async (req, res) => {
  const b = req.body ?? {};
  await notify(Number(b.employeeId) || null, String(b.title ?? '').slice(0, 150), String(b.body ?? ''), String(b.link ?? ''));
  res.json({ ok: true });
});
