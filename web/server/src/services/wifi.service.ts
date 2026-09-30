/**
 * Wi-Fi setup of the Raspberry Pi from anywhere (/wifisetup page). The page has its own password (not the administrator
 * one): AppSettings WifiSetup.PasswordHash, set from WIFI_SETUP_PASSWORD on the first start.
 *
 * The Pi's Wi-Fi agent (pi/lx50pi/wifi.py, runs as root) calls GET /api/lx50/wifi every few seconds with its current
 * Wi-Fi; it gets the queued commands (wifi_scan, wifi_connect) and reports the result. Commands are PiCommands rows with
 * DeviceSerial 'pi:<hostname>' (the LX50's commands use the device serial). The Wi-Fi password of a connect command is
 * removed from the row as soon as the Pi has reported the result.
 */
import crypto from 'crypto';
import { exec, one, query } from '../config/db';
import { UserError } from '../utils/errors';
import { checkPassword, hashPassword } from './portalAuth.service';
import { getSetting, setSetting } from './settings.service';

const KEY = 'WifiSetup.PasswordHash';
const TTL = 60 * 60_000;
const ONLINE_MS = 45_000;
const sessions = new Map<string, number>();
const failures = new Map<string, { n: number; until: number }>();

/** WIFI_SETUP_PASSWORD becomes the page password while none is set. */
export async function initWifiPassword(password: string | undefined) {
  if (password && !(await getSetting(KEY))) await setSetting(KEY, hashPassword(password));
}

export async function login(password: string, ip: string) {
  const f = failures.get(ip);
  if (f && f.n >= 5 && f.until > Date.now()) throw new UserError('Too many wrong passwords. Try again in 10 minutes.', 429);
  const hash = await getSetting(KEY);
  if (!hash) throw new UserError('The Wi-Fi setup password is not set (WIFI_SETUP_PASSWORD on the server).', 403);
  if (!checkPassword(password, hash)) {
    const n = f && f.until > Date.now() ? f.n + 1 : 1;
    failures.set(ip, { n, until: Date.now() + 10 * 60_000 });
    throw new UserError('Wrong password.', 401);
  }
  failures.delete(ip);
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + TTL);
  return token;
}

export function validSession(token: string) {
  const exp = sessions.get(token);
  if (!exp || exp <= Date.now()) { sessions.delete(token); return false; }
  sessions.set(token, Date.now() + TTL);
  return true;
}

export const logout = (token: string) => sessions.delete(token);

// ---- the Pi's agent -------------------------------------------------------------------------------------------

interface PiState { name: string; ssid: string; ip: string; signal: number | null; fallback: string; seen: number }
const pis = new Map<string, PiState>();

const cleanName = (s: unknown) => String(s ?? '').replace(/[^\w.-]/g, '').slice(0, 40);

/** The agent's call: notes its Wi-Fi and hands out its waiting commands. */
export async function agentPoll(q: Record<string, unknown>) {
  const name = cleanName(q.pi);
  if (!name) throw new UserError('pi missing');
  pis.set(name, {
    name, ssid: String(q.ssid ?? '').slice(0, 64), ip: String(q.ip ?? '').slice(0, 50),
    signal: q.signal !== undefined && q.signal !== '' && isFinite(Number(q.signal)) ? Number(q.signal) : null,
    fallback: String(q.fallback ?? '').slice(0, 64), seen: Date.now(),
  });
  const serial = 'pi:' + name;
  const rows = await query("SELECT Id, Body FROM PiCommands WHERE DeviceSerial = @s AND Status IN ('pending', 'sent') ORDER BY Id", { s: serial });
  if (rows.length) await exec("UPDATE PiCommands SET Status = 'sent' WHERE Status = 'pending' AND Id = ANY(@ids)", { ids: rows.map((r) => r.Id) });
  return rows.map((r) => ({ ...JSON.parse(r.Body), id: String(r.Id) }));
}

export async function agentResult(id: number, result: Record<string, unknown>) {
  const row = await one("SELECT Id, Type, Body FROM PiCommands WHERE Id = @id AND DeviceSerial LIKE 'pi:%'", { id });
  if (!row) return;
  const body = JSON.parse(row.Body);
  delete body.password;
  await exec(`UPDATE PiCommands SET Status = @st, Error = @er, Result = @r, Body = @b, FinishedAt = LOCALTIMESTAMP WHERE Id = @id`, {
    st: result.status === 'done' ? 'done' : 'failed', er: String(result.error ?? '').slice(0, 500) || null,
    r: JSON.stringify(result), b: JSON.stringify(body), id,
  });
}

// ---- the page ---------------------------------------------------------------------------------------------------

/** Pis whose agent called in, newest first, and the latest scan of each. */
export async function state() {
  const list = [...pis.values()].sort((a, b) => b.seen - a.seen);
  const out = [];
  for (const p of list) {
    const scan = await one(`SELECT Id, Result, to_char(FinishedAt, 'YYYY-MM-DD HH24:MI:SS') AS At FROM PiCommands
      WHERE DeviceSerial = @s AND Type = 'wifi_scan' AND Status = 'done' ORDER BY Id DESC LIMIT 1`, { s: 'pi:' + p.name });
    out.push({
      name: p.name, online: Date.now() - p.seen < ONLINE_MS, ssid: p.ssid, ip: p.ip, signal: p.signal, fallback: p.fallback,
      lastSeenSeconds: Math.round((Date.now() - p.seen) / 1000),
      scan: scan ? { at: scan.At, networks: JSON.parse(scan.Result).networks ?? [] } : null,
    });
  }
  return { pis: out };
}

function piOf(name: unknown) {
  const n = cleanName(name);
  if (!n || !pis.has(n)) throw new UserError('This Pi has not called in yet. Is it on and connected to the internet?');
  return n;
}

async function queue(pi: string, type: string, body: Record<string, unknown>) {
  // An older command of the same kind that the Pi has not picked up yet is replaced.
  await exec("DELETE FROM PiCommands WHERE DeviceSerial = @s AND Type = @t AND Status = 'pending'", { s: 'pi:' + pi, t: type });
  const r = await one(`INSERT INTO PiCommands (DeviceSerial, Type, Body, CreatedBy) VALUES (@s, @t, @b, 'wifisetup') RETURNING Id`,
    { s: 'pi:' + pi, t: type, b: JSON.stringify({ type, ...body }) });
  return r!.Id as number;
}

export const scan = async (pi: unknown) => ({ id: await queue(piOf(pi), 'wifi_scan', {}) });

export async function connect(pi: unknown, ssid: unknown, password: unknown) {
  const name = piOf(pi);
  const s = String(ssid ?? '');
  const p = String(password ?? '');
  if (!s || s.length > 32) throw new UserError('Choose a Wi-Fi network.');
  if (s === pis.get(name)!.fallback) throw new UserError(`${s} is the fallback Wi-Fi: it is always kept. Choose another network.`);
  if (p && (p.length < 8 || p.length > 63)) throw new UserError('A Wi-Fi password has 8 to 63 characters.');
  return { id: await queue(name, 'wifi_connect', { ssid: s, password: p }) };
}

export async function command(id: number) {
  const r = await one(`SELECT Id, Type, Status, Error, Result FROM PiCommands WHERE Id = @id AND DeviceSerial LIKE 'pi:%'`, { id });
  if (!r) throw new UserError('Not found.', 404);
  return { id: r.Id, type: r.Type, status: r.Status, error: r.Error, result: r.Result ? JSON.parse(r.Result) : null };
}
