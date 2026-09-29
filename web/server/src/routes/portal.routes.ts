/** /api/portal — employee self-service (web portal /me and the mobile app). Login with AC No + password, then Bearer <token>. */
import { Router } from 'express';
import multer from 'multer';
import * as c from '../controllers/portal.controller';
import { auditTrail, requireEmployee } from '../middlewares/auth.middleware';
import { one } from '../config/db';
import { MAX_DOCUMENT_BYTES } from '../services/document.service';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_DOCUMENT_BYTES } });

/** "Employee 961 Name" for the audit log. */
async function employeeName(id: number | undefined) {
  const e = id ? await one('SELECT EnrollNo, Name FROM Employees WHERE Id = @id', { id }) : null;
  return e ? `Employee ${e.EnrollNo} ${e.Name}` : 'Employee';
}

export const portalRoutes = Router();
portalRoutes.post('/login', c.login);
portalRoutes.get('/info', c.info);

portalRoutes.use(requireEmployee);
portalRoutes.use(auditTrail((req) => employeeName(req.employeeId), () => 'Employee'));
portalRoutes.post('/logout', c.logout);
portalRoutes.post('/password', c.password);
portalRoutes.get('/me', c.profile);
portalRoutes.get('/home', c.home);
portalRoutes.post('/checkin', c.checkIn);
portalRoutes.get('/attendance', c.attendance);
portalRoutes.get('/leave', c.leave);
portalRoutes.post('/leave', c.applyLeave);
portalRoutes.delete('/leave/:id', c.cancelLeave);
portalRoutes.get('/holidays', c.holidays);
portalRoutes.get('/requests', c.requestList);
portalRoutes.post('/requests', c.requestCreate);
portalRoutes.delete('/requests/:id', c.requestCancel);
portalRoutes.get('/requests/:id/attachment', c.requestAttachment);
portalRoutes.get('/payslip', c.payslip);
portalRoutes.get('/payroll/yearly', c.yearly);
portalRoutes.get('/payroll/tax', c.tax);
portalRoutes.get('/team', c.teamOverview);
portalRoutes.post('/team/decide', c.teamDecide);
portalRoutes.get('/notifications', c.notifications);
portalRoutes.post('/notifications/read', c.notificationsRead);
portalRoutes.get('/comp-off', c.compOff);
portalRoutes.get('/documents', c.documentList);
portalRoutes.post('/documents', upload.single('file'), c.documentUpload);
portalRoutes.get('/documents/:id', c.documentGet);
portalRoutes.delete('/documents/:id', c.documentRemove);
