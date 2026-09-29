/** Employees ↔ device users through the Raspberry Pi: Upload, Del(Device), Download user info. */
import { one, query } from '../config/db';
import { UserError } from '../utils/errors';
import { log } from './event.service';
import { piOnline, queueCommand, userCommand } from './pi.service';
import { saveUsers } from './sync.service';

/** The device an action goes to: the chosen one, else the first device linked to a Pi. */
export async function piDevice(deviceId?: number | null) {
  const p = deviceId
    ? await one('SELECT Id, Name, SerialNumber, Kind FROM DeviceProfiles WHERE Id = @id', { id: deviceId })
    : await one(`SELECT TOP 1 d.Id, d.Name, d.SerialNumber, d.Kind FROM DeviceProfiles d
        WHERE d.SerialNumber IS NOT NULL AND d.SerialNumber <> ''
          AND (EXISTS (SELECT 1 FROM PiDeviceUsers u WHERE u.DeviceSerial = d.SerialNumber)
               OR EXISTS (SELECT 1 FROM PiCommands c WHERE c.DeviceSerial = d.SerialNumber))
        ORDER BY d.Id`);
  if (!p) throw new UserError('No device is linked to a Raspberry Pi yet. Set up the Pi (Database Option → Raspberry Pi) and wait until it shows Online in the Machine List.');
  if (!p.SerialNumber) throw new UserError(`Device '${p.Name}' has no serial number yet: it is not connected through a Raspberry Pi.`);
  return p as { Id: number; Name: string; SerialNumber: string; Kind: number };
}

/** Queues set_user commands (name, password, card, admin) for the Pi. */
export async function upload(ids: number[], deviceId: number | null, by: string) {
  if (!ids.length) throw new UserError('Select an employee first.');
  const dev = await piDevice(deviceId);
  const rows = await query(`SELECT EnrollNo, Name, DevicePassword, Privilege, CardNo FROM Employees WHERE Id IN (SELECT value FROM OPENJSON(@ids))`, { ids });
  const skipped: string[] = [];
  let queued = 0;
  for (const e of rows) {
    const c = userCommand(e);
    if ('error' in c) { skipped.push(c.error); continue; }
    await queueCommand(dev.SerialNumber, 'set_user', c.body, by);
    queued++;
  }
  log(dev.Id, `Upload user info: ${queued} user(s) queued for the Pi`);
  return `${queued} user(s) sent to the Raspberry Pi of '${dev.Name}'. The Pi writes them to the device within about 15 seconds` +
    (piOnline(dev.SerialNumber) ? '.' : ' after it comes online (it is offline now).') +
    '\nFingerprint templates cannot be written to the LX50: enroll fingers on the device.' +
    (skipped.length ? `\n\nNot sent:\n${skipped.join('\n')}` : '');
}

/** Queues delete_user commands; the employees stay in the software. */
export async function removeFromDevice(ids: number[], deviceId: number | null, by: string) {
  if (!ids.length) throw new UserError('Select an employee first.');
  const dev = await piDevice(deviceId);
  const rows = await query(`SELECT EnrollNo FROM Employees WHERE Id IN (SELECT value FROM OPENJSON(@ids))`, { ids });
  for (const e of rows) await queueCommand(dev.SerialNumber, 'delete_user', { user_id: e.EnrollNo }, by);
  log(dev.Id, `Delete ${rows.length} user(s) from device: queued for the Pi`);
  return `${rows.length} user(s) will be deleted from the device '${dev.Name}' (with their fingerprints) by the Raspberry Pi. The data stays in the software.`;
}

/** Download user info: the user list the Pi last reported, merged into Employees. */
export async function download(deviceId: number | null, overwriteNames: boolean) {
  const dev = await piDevice(deviceId);
  const users = await query(`SELECT UserId, Name, Privilege, Card, CONVERT(varchar(19), UpdatedAt, 120) At FROM PiDeviceUsers WHERE DeviceSerial = @s`,
    { s: dev.SerialNumber });
  if (!users.length) throw new UserError(`The Raspberry Pi has not reported the user list of '${dev.Name}' yet.`);
  const r = await saveUsers(users.map((u) => ({
    enrollNo: u.UserId, name: u.Name, privilege: u.Privilege, cardNo: u.Card ? String(u.Card) : undefined,
  })), overwriteNames);
  log(dev.Id, `Download user info: new ${r.added}, updated ${r.updated}`);
  return `Download user info complete (user list the Pi reported at ${users[0].At}).\nNew: ${r.added}\nUpdated: ${r.updated}\n` +
    'Fingerprint templates are not read over the Pi.';
}
