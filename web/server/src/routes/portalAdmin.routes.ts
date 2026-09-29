/** /api/portal-admin — Employee Portal screen of the administrator program: logins, managers, requests, settings. */
import { Router } from 'express';
import * as c from '../controllers/portalAdmin.controller';

export const portalAdminRoutes = Router();
portalAdminRoutes.get('/accounts', c.accountList);
portalAdminRoutes.post('/accounts', c.accountCreate);
portalAdminRoutes.put('/accounts/:id', c.accountUpdate);
portalAdminRoutes.post('/accounts/delete', c.accountRemove);
portalAdminRoutes.get('/requests', c.requestList);
portalAdminRoutes.get('/requests/:id/attachment', c.requestAttachment);
portalAdminRoutes.post('/requests/decide', c.requestDecide);
portalAdminRoutes.get('/settings', c.settings);
portalAdminRoutes.put('/settings', c.saveSettings);
