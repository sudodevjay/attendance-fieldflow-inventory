/** /api/leave — Leave & Holidays. */
import { Router } from 'express';
import * as c from '../controllers/leave.controller';

export const leaveRoutes = Router();
leaveRoutes.get('/entries', c.entries);
leaveRoutes.post('/entries', c.save);
leaveRoutes.post('/entries/delete', c.removeMany);
leaveRoutes.post('/decide', c.decide);
leaveRoutes.get('/last-approver', c.lastApprover);
leaveRoutes.get('/balance', c.balance);
leaveRoutes.get('/balance/export', c.balanceExcel);
leaveRoutes.get('/holidays', c.holidayList);
leaveRoutes.post('/holidays', c.holidaySave);
leaveRoutes.post('/holidays/delete', c.holidayRemove);
leaveRoutes.get('/types', c.typeList);
leaveRoutes.post('/types', c.typeSave);
