/** /api/shifts — Maintenance Timetables; /api/schedule — Employee Schedule. */
import { Router } from 'express';
import * as c from '../controllers/shift.controller';

export const shiftRoutes = Router();
shiftRoutes.get('/', c.list);
shiftRoutes.post('/', c.create);
shiftRoutes.put('/:id', c.update);
shiftRoutes.delete('/:id', c.remove);

export const scheduleRoutes = Router();
scheduleRoutes.get('/', c.schedule);
scheduleRoutes.post('/', c.assign);
