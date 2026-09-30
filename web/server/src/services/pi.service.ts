/**
 * The Raspberry Pi bridge. The LX50 hangs on the Pi's USB (pi/lx50pi); the Pi pushes punches and the user list here and
 * fetches user commands (add / edit / delete on the device). Protocol as in pi/lx50pi/uploader.py and commands.py.
 */
import crypto from 'crypto';
import { exec, one, query } from '../config/db';
import { now, parse, sqlDT } from '../utils/time';
import { addRecords, log } from './event.service';
import { getSetting, setSetting } from './settings.service';
import { PunchSource, savePunches } from './sync.service';

/** Last time each Pi (by device serial) called the API. */
const lastSeen = new Map<string, number>();
export const ONLINE_MS = 90_000;
export const piOnline = (serial: string | null | undefined) => !!serial && Date.now() - (lastSeen.get(serial) ?? 0) < ONLINE_MS;
export const piLastSeen = (serial: string | null | undefined) => (serial ? lastSeen.get(serial) ?? null : null);

/** Notes the call; true when the Pi was offline before (to log "Pi online"). */
function seen(serial: string) {
  const first = !piOnline(serial);
  lastSeen.set(serial, Date.now());
  return first;
}

/** The token the Pi sends (Database Option → Raspberry Pi); created on first use. */
export async function piToken(): Promise<string> {
  let t = await getSetting('Pi.Token');
  if (!t) {
    t = crypto.randomBytes(20).toString('hex');
    await setSetting('Pi.Token', t);
  }
  return t;
}

export async function newPiToken() {
  await setSetting('Pi.Token', '');
  return piToken();
}

/**
 * The Machine List row of this Pi's device: the profile with this serial number, else the first USB profile without a
 * serial (the LX50 row of the Windows program), else a new row.
 */
export async function profileFor(serial: string, name: string): Promise<{ Id: number; Name: string }> {
  const bySerial = await one('SELECT Id, Name FROM DeviceProfiles WHERE SerialNumber = @s ORDER BY Id LIMIT 1', { s: serial });
  if (bySerial) return bySerial;
  const free = await one("SELECT Id, Name FROM DeviceProfiles WHERE Kind = 0 AND (SerialNumber IS NULL OR SerialNumber = '') ORDER BY Id LIMIT 1");
  if (free) {
    await exec('UPDATE DeviceProfiles SET SerialNumber = @s WHERE Id = @id', { s: serial, id: free.Id });
    return free;
  }
  const created = await one(`INSERT INTO DeviceProfiles (Name, Kind, MachineNumber, ComPort, BaudRate, IpAddress, TcpPort, CommPassword, SerialNumber, ProductName)
    VALUES (@n, 0, 1, 'COM3', 115200, '', 4370, 0, @s, 'LX50') RETURNING Id, Name`, { n: name || 'LX50 (Pi)', s: serial });
  return created!;
}

export interface PiPunch { user_id?: unknown; time?: unknown; verify?: unknown; state?: unknown }

/** Punches the Pi read from the device. */
export async function receivePunches(serial: string, deviceName: string, raw: PiPunch[]) {
  const p = await profileFor(serial, deviceName);
  if (seen(serial)) log(p.Id, 'Pi online');
  const punches = raw
    .map((x) => ({ enrollNo: String(x.user_id ?? ''), time: parse(String(x.time ?? ''))!, verifyMode: Number(x.verify) || 0, inOutMode: Number(x.state) || 0, workCode: 0 }))
    .filter((x) => x.time !== null && x.enrollNo);
  const r = await savePunches(punches, PunchSource.Device);
  await exec('UPDATE DeviceProfiles SET LastDownload = CAST(@t AS timestamp) WHERE Id = @id', { t: sqlDT(now()), id: p.Id });
  const names = new Map((await query('SELECT EnrollNo, Name FROM Employees')).map((e) => [e.EnrollNo, e.Name]));
  addRecords(punches, names, p.Name);
  log(p.Id, `Download attendance logs: ${punches.length} record(s), new ${r.added}`);
  return r;
}

export interface PiUser { user_id?: unknown; name?: unknown; privilege?: unknown; card?: unknown }

/** The device's user list as the Pi read it (kept for "Download user info"). */
export async function receiveUsers(serial: string, deviceName: string, raw: PiUser[]) {
  const p = await profileFor(serial, deviceName);
  seen(serial);
  const users = raw.map((u) => ({ u: String(u.user_id ?? ''), n: String(u.name ?? ''), p: Number(u.privilege) || 0, c: Number(u.card) || 0 }))
    .filter((u) => u.u);
  await exec('DELETE FROM PiDeviceUsers WHERE DeviceSerial = @s', { s: serial });
  if (users.length)
    await exec(`INSERT INTO PiDeviceUsers (DeviceSerial, UserId, Name, Privilege, Card)
      SELECT @s, j.u, j.n, j.p, j.c FROM json_to_recordset(CAST(@rows AS json)) AS j(u text, n text, p int, c bigint)`, { s: serial, rows: JSON.stringify(users) });
  await exec('UPDATE DeviceProfiles SET UserCount = @n, AdminCount = @a WHERE Id = @id',
    { n: users.length, a: users.filter((u) => u.p > 0).length, id: p.Id });
  log(p.Id, `User list from device: ${users.length} user(s)`);
}

/** Commands waiting for this Pi (marked as sent). */
export async function pendingCommands(serial: string) {
  const p = await profileFor(serial, '');
  if (seen(serial)) log(p.Id, 'Pi online');
  const rows = await query("SELECT Id, Body FROM PiCommands WHERE DeviceSerial = @s AND Status IN ('pending', 'sent') ORDER BY Id", { s: serial });
  if (rows.length) await exec(`UPDATE PiCommands SET Status = 'sent' WHERE Status = 'pending' AND Id = ANY(@ids)`, { ids: rows.map((r) => r.Id) });
  return rows.map((r) => ({ ...JSON.parse(r.Body), id: String(r.Id) }));
}

/** Result of a command, as the Pi reports it. */
export async function saveResult(id: number, result: { status?: unknown; error?: unknown }) {
  const status = result.status === 'done' ? 'done' : 'failed';
  const row = await one('SELECT c.Id, c.Type, c.Body, c.DeviceSerial FROM PiCommands c WHERE c.Id = @id', { id });
  if (!row) return;
  const error = String(result.error ?? '').slice(0, 500);
  await exec(`UPDATE PiCommands SET Status = @st, Error = @er, Result = @r, FinishedAt = LOCALTIMESTAMP WHERE Id = @id`,
    { st: status, er: error || null, r: JSON.stringify(result ?? {}), id });
  const p = await profileFor(row.DeviceSerial, '');
  log(p.Id, `${status === 'done' ? 'Succeed' : 'failed'}: ${describe(row.Type, JSON.parse(row.Body))}${error ? ` (${error})` : ''}`);
}

export function describe(type: string, body: any) {
  switch (type) {
    case 'set_user': return `upload user ${body.user_id} ${body.name ?? ''}`.trim();
    case 'delete_user': return `delete user ${body.user_id} from device`;
    case 'enroll_finger': return `enroll user ${body.user_id} finger ${body.finger ?? 0}`;
    case 'sync': return 'read the device now';
    default: return type;
  }
}

/** Queues a command for the Pi of `serial`. */
export async function queueCommand(serial: string, type: string, body: Record<string, unknown>, by: string) {
  const r = await one(`INSERT INTO PiCommands (DeviceSerial, Type, Body, CreatedBy) VALUES (@s, @t, @b, @by) RETURNING Id`,
    { s: serial, t: type, b: JSON.stringify({ type, ...body }), by });
  return r!.Id as number;
}

/** Commands of a device, newest first (Machine List → Pi commands). */
export async function commandsOf(serial: string) {
  const rows = await query(`SELECT Id, Type, Body, Status, Error, to_char(CreatedAt, 'YYYY-MM-DD HH24:MI:SS') AS CreatedAt,
      to_char(FinishedAt, 'YYYY-MM-DD HH24:MI:SS') AS FinishedAt, CreatedBy FROM PiCommands WHERE DeviceSerial = @s ORDER BY Id DESC LIMIT 100`, { s: serial });
  return rows.map((r) => ({ ...r, What: describe(r.Type, JSON.parse(r.Body)), Body: undefined }));
}

/** Serial numbers that have ever talked to this server through a Pi. */
export async function piSerials(): Promise<Set<string>> {
  const rows = await query(`SELECT DISTINCT DeviceSerial s FROM PiDeviceUsers UNION SELECT DISTINCT DeviceSerial FROM PiCommands`);
  return new Set(rows.map((r) => r.s));
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/** set_user command body from an employee row, or the reason the device cannot take it. */
export function userCommand(e: { EnrollNo: string; Name: string; DevicePassword: string | null; Privilege: number; CardNo: string | null }):
  { body: Record<string, unknown> } | { error: string } {
  if (!/^\d{1,9}$/.test(e.EnrollNo)) return { error: `AC No ${e.EnrollNo}: must be 1-9 digits` };
  let name = e.Name.trim() || `User ${e.EnrollNo}`;
  while (Buffer.byteLength(name, 'utf8') > 24) name = name.slice(0, -1);
  const pwd = e.DevicePassword ?? '';
  if (pwd && !/^\d{1,8}$/.test(pwd)) return { error: `AC No ${e.EnrollNo}: device password must be up to 8 digits` };
  const card = digits(e.CardNo);
  return {
    body: {
      user_id: e.EnrollNo, name, password: pwd, privilege: e.Privilege > 0 ? 14 : 0,
      card: card && Number(card) <= 0xffffffff ? Number(card) : 0,
    },
  };
}
