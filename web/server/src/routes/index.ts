/** All of /api. Public first (admin login, Raspberry Pi, employee portal), then everything behind the administrator login. */
import { Router } from 'express';
import { me } from '../controllers/hr.controller';
import { auditTrail, authorize, requireAdmin } from '../middlewares/auth.middleware';
import { portalCors } from '../middlewares/cors.middleware';
import { notFound } from '../middlewares/error.middleware';
import { authRoutes } from './auth.routes';
import { departmentRoutes } from './department.routes';
import { deviceRoutes } from './device.routes';
import { employeeRoutes } from './employee.routes';
import {
  auditRoutes, dashboardRoutes, documentRoutes, employeeHrRoutes, leaveHrRoutes, notificationRoutes, payrollRoutes, rosterRoutes,
  settingsHrRoutes, userRoutes,
} from './hr.routes';
import { leaveRoutes } from './leave.routes';
import { piRoutes } from './pi.routes';
import { portalRoutes } from './portal.routes';
import { portalAdminRoutes } from './portalAdmin.routes';
import { punchRoutes } from './punch.routes';
import { reportRoutes } from './report.routes';
import { settingsRoutes } from './settings.routes';
import { scheduleRoutes, shiftRoutes } from './shift.routes';
import { wifiSetupRoutes } from './wifi.routes';

export const api = Router();

// ---- public (own authentication); administrator logins are in the audit log, failed ones too
api.use('/auth/login', auditTrail((req) => String(req.body?.user || 'Supervisor'), () => null, true));
api.use('/auth', authRoutes);
api.use('/lx50', piRoutes);
api.use('/portal', portalCors, portalRoutes);
api.use('/wifisetup', wifiSetupRoutes);

// ---- administrator program: logged in, allowed by the role, changes written to the audit log
api.use(requireAdmin);
api.get('/auth/me', me);
api.use(authorize);
api.use(auditTrail((req) => req.user ?? '?', (req) => req.role ?? null));
api.use('/dashboard', dashboardRoutes);
api.use('/departments', departmentRoutes);
api.use('/shifts', shiftRoutes);
api.use('/schedule', scheduleRoutes);
api.use('/roster', rosterRoutes);
api.use('/employees', employeeHrRoutes);
api.use('/employees', employeeRoutes);
api.use('/documents', documentRoutes);
api.use('/logs', punchRoutes);
api.use('/leave', leaveHrRoutes);
api.use('/leave', leaveRoutes);
api.use('/reports', reportRoutes);
api.use('/payroll', payrollRoutes);
api.use('/devices', deviceRoutes);
api.use('/settings', settingsHrRoutes);
api.use('/settings', settingsRoutes);
api.use('/portal-admin', portalAdminRoutes);
api.use('/notifications', notificationRoutes);
api.use('/users', userRoutes);
api.use('/audit', auditRoutes);
api.use(notFound);
