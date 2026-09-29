/**
 * Machine List and Device management. Devices are the DeviceProfiles rows of the Windows program. The web version reaches
 * a device through its Raspberry Pi (pi.service); USB / Serial / Ethernet devices plugged into a Windows PC are still
 * driven by the Windows program (ZKTeco SDK), so their commands here explain that instead of failing silently.
 */
import { exec, one, query } from '../config/db';
import { UserError } from '../utils/errors';
import { fmt, now } from '../utils/time';
import { log } from './event.service';
import { commandsOf, piLastSeen, piOnline, piSerials, queueCommand } from './pi.service';

export const KIND_NAMES = ['USB', 'Serial Port/RS485', 'Ethernet', 'ADMS (Push / Cloud)'];

const COLUMNS = `Id, Name, Kind, MachineNumber, ComPort, BaudRate, IpAddress, TcpPort, CommPassword, ProductName, SerialNumber, Firmware,
  UserCount, AdminCount, FpCount, FaceCount, PasswordCount, LogCount, CONVERT(varchar(19), LastDownload, 120) LastDownload`;

/** A Machine List row: the profile plus how it is reached and its status. */
function toRow(p: any, pis: Set<string>) {
  const viaPi = !!p.SerialNumber && (pis.has(p.SerialNumber) || piLastSeen(p.SerialNumber) !== null);
  const online = viaPi && piOnline(p.SerialNumber);
  const comm = viaPi ? 'USB via Raspberry Pi' : p.Kind === 1 ? 'Serial Port/RS485' : p.Kind === 3 ? 'ADMS (Push)' : p.Kind === 2 ? 'Ethernet' : 'USB';
  return {
    ...p, viaPi, online,
    Status: viaPi ? (online ? 'Online' : 'Offline') : 'Windows program',
    Comm: comm,
    Baud: p.Kind === 1 ? String(p.BaudRate) : '',
    Ip: p.Kind === 2 || p.Kind === 3 ? p.IpAddress : '',
    Port: p.Kind === 1 ? p.ComPort : p.Kind === 2 ? String(p.TcpPort) : '',
  };
}

export async function list() {
  const pis = await piSerials();
  const devices = (await query(`SELECT ${COLUMNS} FROM DeviceProfiles ORDER BY Id`)).map((p) => toRow(p, pis));
  return { devices, connected: devices.filter((r) => r.online).length };
}

async function load(id: number) {
  const p = await one(`SELECT ${COLUMNS} FROM DeviceProfiles WHERE Id = @id`, { id });
  if (!p) throw new UserError('Device not found.', 404);
  return toRow(p, await piSerials());
}

export interface DeviceInput {
  Name?: unknown; Kind?: unknown; MachineNumber?: unknown; ComPort?: unknown; BaudRate?: unknown; IpAddress?: unknown;
  TcpPort?: unknown; CommPassword?: unknown; SerialNumber?: unknown;
}

function params(b: DeviceInput) {
  const name = String(b.Name ?? '').trim();
  if (!name) throw new UserError('Device Name is required.');
  const kind = Math.max(0, KIND_NAMES.indexOf(String(b.Kind)));
  if (kind === 3 && !String(b.SerialNumber ?? '').trim()) throw new UserError('Serial Number is required for an ADMS device.');
  const int = (v: unknown, min: number, max: number, what: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new UserError(`${what} must be ${min} to ${max}.`);
    return n;
  };
  return {
    n: name.slice(0, 100), k: kind, m: int(b.MachineNumber ?? 1, 1, 255, 'Machine No.'), com: String(b.ComPort ?? 'COM3').trim().slice(0, 10),
    baud: [9600, 19200, 38400, 57600, 115200].includes(Number(b.BaudRate)) ? Number(b.BaudRate) : 115200, ip: String(b.IpAddress ?? '').trim().slice(0, 50),
    port: int(b.TcpPort ?? 4370, 1, 65535, 'Port (TCP)'), key: int(b.CommPassword ?? 0, 0, 999999, 'Comm Key'),
    sn: String(b.SerialNumber ?? '').trim().slice(0, 50) || null,
  };
}

export async function create(b: DeviceInput) {
  const r = await one(`INSERT INTO DeviceProfiles (Name, Kind, MachineNumber, ComPort, BaudRate, IpAddress, TcpPort, CommPassword, SerialNumber)
    OUTPUT INSERTED.Id VALUES (@n, @k, @m, @com, @baud, @ip, @port, @key, @sn)`, params(b));
  return r!.Id as number;
}

export async function update(id: number, b: DeviceInput) {
  await exec(`UPDATE DeviceProfiles SET Name = @n, Kind = @k, MachineNumber = @m, ComPort = @com, BaudRate = @baud, IpAddress = @ip,
    TcpPort = @port, CommPassword = @key, SerialNumber = @sn WHERE Id = @id`, { ...params(b), id });
}

/** Removes devices from the Machine List; their attendance stays in the database. */
export async function removeMany(ids: number[]) {
  if (!ids.length) throw new UserError('Select a device first.');
  await exec('DELETE FROM DeviceProfiles WHERE Id IN (SELECT value FROM OPENJSON(@ids))', { ids });
}

const windowsOnly = (name: string, what: string) =>
  new UserError(`${what}: '${name}' is not connected through a Raspberry Pi. USB / Serial / Ethernet / ADMS devices on a Windows PC are handled by the Windows program (Attendance Management Program).`);

/** Device commands of the Machine List (toolbar, menu, right click); returns the message to show. */
export async function action(id: number, action: string, by: string): Promise<string> {
  const p = await load(id);
  if (action === 'info') {
    const seen = piLastSeen(p.SerialNumber);
    const cap = (v: any) => (v === null || v === undefined ? '-' : String(v));
    return `Device        : ${p.Name}\nConnection    : ${p.Comm}\nStatus        : ${p.Status}\nProduct       : ${cap(p.ProductName)}\n` +
      `Serial Number : ${cap(p.SerialNumber)}\nFirmware      : ${cap(p.Firmware)}\nUsers         : ${cap(p.UserCount)}  (Admin ${cap(p.AdminCount)})\n` +
      `Fingerprints  : ${cap(p.FpCount)}\nAtt. Logs     : ${cap(p.LogCount)}\nLast download : ${p.LastDownload ?? '-'}\n` +
      (p.viaPi ? `Pi last seen  : ${seen ? new Date(seen).toLocaleString('en-IN') : 'not since the server started'}\n` : '') +
      `PC Time       : ${fmt(now(), 'dd-MM-yyyy HH:mm:ss')}`;
  }
  if (!p.viaPi) throw windowsOnly(p.Name, action === 'connect' ? 'Connect' : 'This command');

  switch (action) {
    case 'connect':
    case 'disconnect':
      return p.online
        ? `'${p.Name}' is online: its Raspberry Pi reads the device every 15 seconds and sends new punches here. There is nothing to connect.`
        : `'${p.Name}' is offline: the Raspberry Pi has not contacted this server in the last 90 seconds. Check that the Pi is on, on the network, and that the LX50 is plugged into it (through the USB hub).`;
    case 'download-logs':
      await queueCommand(p.SerialNumber, 'sync', {}, by);
      log(p.Id, 'Download attendance logs: asked the Pi to read the device now');
      return `The Raspberry Pi will read '${p.Name}' now and send any new punches (within about 15 seconds). New punches appear in the records list below.`;
    case 'sync-time':
    case 'clear-logs':
    case 'restart':
      throw new UserError(`${action === 'sync-time' ? 'Synchronize time' : action === 'clear-logs' ? 'Clear attendance logs' : 'Restart'} is not available through the Raspberry Pi: the Pi only reads punches and manages users. Use the device menu for this.`);
    default:
      throw new UserError(`Unknown command ${action}`);
  }
}

/** Commands queued for a device's Pi, newest first. */
export async function commands(id: number) {
  const p = await load(id);
  return p.SerialNumber ? commandsOf(p.SerialNumber) : [];
}
