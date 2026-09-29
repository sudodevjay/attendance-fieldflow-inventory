/** /api/devices — Machine List and Device management. */
import { Router } from 'express';
import * as c from '../controllers/device.controller';

export const deviceRoutes = Router();
deviceRoutes.get('/', c.list);
deviceRoutes.get('/events', c.events);
deviceRoutes.post('/', c.create);
deviceRoutes.post('/delete', c.removeMany);
deviceRoutes.put('/:id', c.update);
deviceRoutes.post('/:id/action', c.action);
deviceRoutes.get('/:id/commands', c.commands);
