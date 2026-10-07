/** /api/sites — work sites for site attendance (GPS + selfie check-in) and the site punches with their selfies. */
import { Router } from 'express';
import * as c from '../controllers/site.controller';

export const siteRoutes = Router();
siteRoutes.get('/', c.list);
siteRoutes.post('/', c.create);
siteRoutes.put('/:id', c.update);
siteRoutes.delete('/:id', c.remove);
siteRoutes.get('/punches', c.punches);
siteRoutes.get('/punches/:id/photo', c.photo);
