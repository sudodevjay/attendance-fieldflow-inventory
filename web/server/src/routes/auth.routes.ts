/** /api/auth — administrator login (status / login / logout are public; /me needs the login). */
import { Router } from 'express';
import * as c from '../controllers/auth.controller';

export const authRoutes = Router();
authRoutes.get('/status', c.status);
authRoutes.post('/login', c.login);
authRoutes.post('/logout', c.logout);
