/** /api/departments — Department List. */
import { Router } from 'express';
import * as c from '../controllers/department.controller';

export const departmentRoutes = Router();
departmentRoutes.get('/', c.list);
departmentRoutes.post('/', c.create);
departmentRoutes.put('/:id', c.update);
departmentRoutes.delete('/:id', c.remove);
