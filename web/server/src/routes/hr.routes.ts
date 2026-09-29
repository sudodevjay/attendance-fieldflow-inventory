/** Web-only HR screens of the administrator program (see controllers/hr.controller). */
import { Router } from 'express';
import multer from 'multer';
import * as c from '../controllers/hr.controller';
import { MAX_DOCUMENT_BYTES } from '../services/document.service';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_DOCUMENT_BYTES } });

/** /api/dashboard */
export const dashboardRoutes = Router();
dashboardRoutes.get('/', c.dashboardData);

/** /api/documents — employee documents (upload is /api/employees/:id/documents). */
export const documentRoutes = Router();
documentRoutes.get('/:id', c.documentGet);
documentRoutes.delete('/:id', c.documentRemove);

/** Added to /api/employees. */
export const employeeHrRoutes = Router();
employeeHrRoutes.get('/:id/documents', c.documentList);
employeeHrRoutes.post('/:id/documents', upload.single('file'), c.documentUpload);
employeeHrRoutes.get('/:id/salary-structure', c.structureOf);
employeeHrRoutes.get('/:id/comp-off', c.compOffBalance);

/** /api/roster — rotating shifts. */
export const rosterRoutes = Router();
rosterRoutes.get('/', c.rosterGrid);
rosterRoutes.post('/', c.rosterSave);
rosterRoutes.post('/rotate', c.rosterRotate);
rosterRoutes.post('/clear', c.rosterClear);

/** /api/payroll — salary structure and statutory rules. */
export const payrollRoutes = Router();
payrollRoutes.get('/components', c.components);
payrollRoutes.post('/components', c.componentSave);
payrollRoutes.delete('/components/:id', c.componentRemove);
payrollRoutes.get('/statutory', c.statutory);
payrollRoutes.put('/statutory', c.statutorySave);

/** Added to /api/leave. */
export const leaveHrRoutes = Router();
leaveHrRoutes.get('/comp-off-settings', c.compOffSettings);
leaveHrRoutes.put('/comp-off-settings', c.compOffSettingsSave);

/** /api/notifications — HR's notifications and announcements to employees. */
export const notificationRoutes = Router();
notificationRoutes.get('/', c.notificationList);
notificationRoutes.post('/read', c.notificationRead);
notificationRoutes.post('/broadcast', c.broadcast);

/** /api/users — users with roles (Admin only). */
export const userRoutes = Router();
userRoutes.get('/', c.userList);
userRoutes.post('/', c.userCreate);
userRoutes.put('/:id', c.userUpdate);
userRoutes.delete('/:id', c.userRemove);

/** /api/audit */
export const auditRoutes = Router();
auditRoutes.get('/', c.auditList);
auditRoutes.get('/export', c.auditExport);

/** Added to /api/settings. */
export const settingsHrRoutes = Router();
settingsHrRoutes.get('/logo', c.logo);
settingsHrRoutes.put('/logo', c.logoSave);
