/** /api/settings — Database Option, Attendance / Salary Rule, Administrator, Backup, Raspberry Pi setup, Help. */
import { Router } from 'express';
import * as c from '../controllers/settings.controller';

export const settingsRoutes = Router();
settingsRoutes.get('/company', c.company);
settingsRoutes.put('/company', c.saveCompany);
settingsRoutes.put('/adms', c.saveAdms);
settingsRoutes.post('/test-connection', c.testConnection);
settingsRoutes.put('/connection', c.saveConnection);
settingsRoutes.get('/backup', c.backup);
settingsRoutes.get('/attendance-rule', c.attendanceRule);
settingsRoutes.put('/attendance-rule', c.saveAttendanceRule);
settingsRoutes.get('/salary-rule', c.salaryRule);
settingsRoutes.put('/salary-rule', c.saveSalaryRule);
settingsRoutes.put('/admin-password', c.adminPassword);
settingsRoutes.get('/pi', c.pi);
settingsRoutes.post('/pi/new-token', c.newToken);
settingsRoutes.get('/readme', c.readme);
