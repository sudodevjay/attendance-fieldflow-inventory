/** /api/reports — Attendance Reports, Excel / PDF, salary slip. */
import { Router } from 'express';
import * as c from '../controllers/report.controller';

export const reportRoutes = Router();
reportRoutes.get('/catalog', c.catalog);
reportRoutes.get('/run', c.run);
reportRoutes.get('/file', c.file);
reportRoutes.get('/salary-slip', c.salarySlip);
