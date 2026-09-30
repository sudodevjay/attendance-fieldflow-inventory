/** Database connection test / change, database backup (download), Raspberry Pi setup data, the README (Help). */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Client } from 'pg';
import { config, connectionFromEnv, ROOT, saveConnectionString } from '../config';
import { poolOptions, query } from '../config/db';
import { TABLES } from '../config/schema';
import { UserError } from '../utils/errors';
import { fmt, now } from '../utils/time';
import { piToken } from './pi.service';

export async function testConnection(connectionString: string) {
  const cs = connectionString.trim() === maskedConnectionString() ? config.connectionString : connectionString.trim();
  if (!cs) throw new UserError('Enter a connection string.');
  const client = new Client({ ...poolOptions(cs), connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    const x = (await client.query("SELECT current_setting('server_version') v, current_database() d")).rows[0];
    return `Connection OK. PostgreSQL ${x.v}, database ${x.d}`;
  } catch (e: any) {
    throw new UserError('Connection failed: ' + e.message);
  } finally {
    await client.end().catch(() => {});
  }
}

export function saveConnection(connectionString: string) {
  const cs = connectionString.trim();
  if (!cs) throw new UserError('Enter a connection string.');
  if (connectionFromEnv()) throw new UserError('The connection string comes from the environment variable DATABASE_URL (e.g. on Render). Change it there.');
  if (cs === maskedConnectionString()) return 'Nothing changed.';
  saveConnectionString(cs);
  return 'Saved in server/config.json. Restart the web server to apply the change.';
}

/** The connection string without its password (it is shown in the browser). */
export const maskedConnectionString = () => config.connectionString.replace(/(:\/\/[^:/@]+:)[^@]*@/, '$1*****@');

/** Every table as JSON (Database Option → Backup Database): a file the browser downloads. */
export async function backup() {
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) tables[t] = await query(`SELECT * FROM ${t}`);
  return {
    name: `ZkAttendance_${fmt(now(), 'yyyyMMdd_HHmm')}.json`,
    data: JSON.stringify({ kind: 'zk-attendance-backup', version: 1, createdAt: fmt(now(), 'yyyy-MM-dd HH:mm:ss'), tables }),
  };
}

/**
 * What the Pi's config.ini needs: the address of this server and the token. In the cloud that is the public URL
 * (PUBLIC_URL / RENDER_EXTERNAL_URL); on a PC its addresses (real adapters first).
 */
export async function piSetup() {
  if (config.publicUrl) return { token: await piToken(), bases: [`${config.publicUrl}/api/lx50`], port: config.port };
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
