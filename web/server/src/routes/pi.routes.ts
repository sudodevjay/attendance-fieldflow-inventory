/**
 * /api/lx50 — Raspberry Pi. Authorization: Bearer <Pi.Token>.
 *   POST /punches   {"device": {"serial", "name"}, "punches": [{"id", "user_id", "name", "time", "verify", "state"}]}
 *   POST /users     {"device": {...}, "users": [{"user_id", "name", "privilege", "card"}]}
 *   GET  /commands?device=<serial>   -> {"commands": [...]}
 *   POST /commands/:id/result        {"status": "done" | "failed", "error", "finished", "user"?}
 *   GET  /wifi, POST /wifi/:id/result   the Pi's Wi-Fi agent (wifi.routes)
 */
import { Router } from 'express';
import * as c from '../controllers/pi.controller';
import { requirePiToken } from '../middlewares/auth.middleware';
import { wifiAgentRoutes } from './wifi.routes';

export const piRoutes = Router();
piRoutes.use(requirePiToken);
piRoutes.post('/punches', c.punches);
piRoutes.post('/users', c.users);
piRoutes.get('/commands', c.commands);
piRoutes.post('/commands/:id/result', c.result);
piRoutes.use('/wifi', wifiAgentRoutes);
