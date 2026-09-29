/** Database connection test / change, database backup, Raspberry Pi setup data, the README (Help). */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config, ROOT, saveConnectionString } from '../config';
import { exec, one, sql } from '../config/db';
import { UserError } from '../utils/errors';
import { fmt, now } from '../utils/time';
import { piToken } from './pi.service';

export async function testConnection(connectionString: string) {
  const cs = connectionString.trim();
  if (!cs) throw new UserError('Enter a connection string.');
  const pool = new sql.ConnectionPool({ connectionString: cs } as any);
  try {
    await pool.connect();
    const r = await pool.request().query("SELECT @@SERVERNAME s, SERVERPROPERTY('ProductVersion') v, DB_NAME() d");
    const x = r.recordset[0];
    return `Connection OK. Server: ${x.s}, Version ${x.v}, Database ${x.d}`;
  } catch (e: any) {
    throw new UserError('Connection failed: ' + e.message);
  } finally {
    await pool.close().catch(() => {});
  }
}

export function saveConnection(connectionString: string) {
  const cs = connectionString.trim();
  if (!cs) throw new UserError('Enter a connection string.');
  saveConnectionString(cs);
  return 'Saved in server/config.json. Restart the web server to apply the change.';
}

export const currentConnectionString = () => config.connectionString;

/** BACKUP DATABASE; the file is written by the SQL Server service on the server computer. */
export async function backup(file: string) {
  file = file.trim();
  if (!/^[a-zA-Z]:\\.+\.bak$/i.test(file) && !/^\\\\.+\.bak$/i.test(file)) throw new UserError('Enter a full path ending in .bak, e.g. D:\\Backup\\ZkAttendance.bak');
  const db = (await one('SELECT DB_NAME() d'))!.d as string;
  await exec(`BACKUP DATABASE [${db.replace(/]/g, ']]')}] TO DISK = @p WITH INIT`, { p: file });
  return 'Backup complete: ' + file;
}

export const defaultBackupPath = () => `D:\\Backup\\ZkAttendance_${fmt(now(), 'yyyyMMdd_HHmm')}.bak`;

/** What the Pi's config.ini needs: this PC's addresses (real adapters first) and the token. */
export async function piSetup() {
  // VirtualBox / Hyper-V / WSL / VPN adapters and their addresses are not reachable from the Pi: they go last.
  const virtual = /virtual|vbox|vmware|vethernet|wsl|hyper-v|loopback|tailscale|zerotier/i;
  const virtualIp = /^(192\.168\.56\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;
  const ips = Object.entries(os.networkInterfaces())
    .flatMap(([name, list]) => (list ?? []).map((a) => ({ name, a })))
    .filter(({ a }) => a.family === 'IPv4' && !a.internal)
    .sort((x, y) => Number(virtual.test(x.name) || virtualIp.test(x.a.address)) - Number(virtual.test(y.name) || virtualIp.test(y.a.address)))
    .map(({ a }) => a.address);
  return { token: await piToken(), bases: ips.map((ip) => `http://${ip}:${config.port}/api/lx50`), port: config.port };
}

/** The repository README (Help → Help). */
export function readme() {
  const file = path.resolve(ROOT, '..', '..', 'README.md');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 'README.md not found.';
}
