/** /api/employees — Employee List. */
import { Router } from 'express';
import multer from 'multer';
import * as c from '../controllers/employee.controller';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

export const employeeRoutes = Router();
employeeRoutes.get('/', c.list);
employeeRoutes.get('/options', c.options);
employeeRoutes.get('/next-no', c.nextNo);
employeeRoutes.post('/', c.create);
employeeRoutes.post('/delete', c.removeMany);
employeeRoutes.post('/photos', c.photos);
employeeRoutes.post('/export', c.exportExcel);
employeeRoutes.post('/import', upload.single('file'), c.importExcel);
employeeRoutes.post('/device/upload', c.uploadToDevice);
employeeRoutes.post('/device/delete', c.deleteFromDevice);
employeeRoutes.post('/device/download', c.downloadFromDevice);
employeeRoutes.get('/:id', c.detail);
employeeRoutes.put('/:id', c.update);
employeeRoutes.delete('/:id/fingers/:index', c.deleteFinger);
