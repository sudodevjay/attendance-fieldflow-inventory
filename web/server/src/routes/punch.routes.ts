/** /api/logs — AC Log (raw punches). */
import { Router } from 'express';
import multer from 'multer';
import * as c from '../controllers/punch.controller';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export const punchRoutes = Router();
punchRoutes.get('/', c.list);
punchRoutes.get('/export', c.exportExcel);
punchRoutes.post('/manual', c.addManual);
punchRoutes.post('/delete', c.removeMany);
punchRoutes.post('/import', upload.single('file'), c.importFile);
