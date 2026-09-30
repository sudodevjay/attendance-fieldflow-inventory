/**
 * Wi-Fi setup of the Raspberry Pi (services/wifi.service).
 *   /api/wifisetup — the /wifisetup page, own password (Bearer token from POST /login)
 *     POST /login {password} -> {token}     POST /logout
 *     GET  /state -> {pis: [{name, online, ssid, ip, signal, scan: {at, networks}}]}
 *     POST /scan {pi} -> {id}     POST /connect {pi, ssid, password} -> {id}     GET /commands/:id
 *   /api/lx50/wifi — the Pi's Wi-Fi agent (Pi token, see pi.routes)
 *     GET  /wifi?pi=<hostname>&ssid=&ip=&signal= -> {commands: [...]}     POST /wifi/:id/result
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import * as audit from '../services/audit.service';
import * as wifi from '../services/wifi.service';
import { bearer, idParam } from '../utils/http';

const ip = (req: Request) => req.ip ?? req.socket.remoteAddress ?? '';

function requireWifiSession(req: Request, res: Response, next: NextFunction) {
  if (wifi.validSession(bearer(req))) return next();
  res.status(401).json({ error: 'Please log in.' });
}

export const wifiSetupRoutes = Router();
wifiSetupRoutes.post('/login', async (req, res) => {
  try {
    res.json({ token: await wifi.login(String(req.body?.password ?? ''), ip(req)) });
  } catch (e) {
    audit.write('Wi-Fi setup', null, 'POST', '/api/wifisetup/login', 'FAILED', ip(req));
    throw e;
  }
});
wifiSetupRoutes.post('/logout', (req, res) => { wifi.logout(bearer(req)); res.json({ ok: true }); });
wifiSetupRoutes.use(requireWifiSession);
wifiSetupRoutes.get('/state', async (_req, res) => { res.json(await wifi.state()); });
wifiSetupRoutes.post('/scan', async (req, res) => { res.json(await wifi.scan(req.body?.pi)); });
wifiSetupRoutes.post('/connect', async (req, res) => {
  const r = await wifi.connect(req.body?.pi, req.body?.ssid, req.body?.password);
  await audit.write('Wi-Fi setup', null, 'POST', '/api/wifisetup/connect', `Pi ${req.body?.pi}: connect to ${req.body?.ssid}`, ip(req));
  res.json(r);
});
wifiSetupRoutes.get('/commands/:id', async (req, res) => { res.json(await wifi.command(idParam(req))); });

/** Mounted in pi.routes (behind the Pi token). */
export const wifiAgentRoutes = Router();
wifiAgentRoutes.get('/', async (req, res) => { res.json({ commands: await wifi.agentPoll(req.query) }); });
wifiAgentRoutes.post('/:id/result', async (req, res) => { await wifi.agentResult(idParam(req), req.body ?? {}); res.json({ ok: true }); });
