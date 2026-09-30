import fs from 'fs';
import path from 'path';

/** server/config.json (optional; config.example.json shows the fields). The Windows program keeps its own appsettings.json. */
export interface Config {
  port: number;
  /** PostgreSQL URL: postgresql://user:password@host:5432/database */
  connectionString: string;
  /** Address of this server as the Pi and the phones reach it, e.g. https://zk-attendance.onrender.com (optional). */
  publicUrl: string;
}

/** web/server */
export const ROOT = path.resolve(__dirname, '..', '..');
const FILE = path.join(ROOT, 'config.json');

const defaults: Config = {
  port: 4000,
  // The web version's own PostgreSQL database (Supabase in the cloud). The Windows program's SQL Server is not used.
  connectionString: 'postgresql://postgres:postgres@localhost:5432/zkattendance',
  publicUrl: '',
};

/**
 * Defaults < config.json < environment: PORT, DATABASE_URL (or ZK_CONNECTION_STRING), PUBLIC_URL (Render sets
 * RENDER_EXTERNAL_URL itself).
 */
function load(): Config {
  const file = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
  const c: Config = { ...defaults, ...file };
  if (process.env.PORT) c.port = parseInt(process.env.PORT, 10);
  const cs = process.env.DATABASE_URL || process.env.ZK_CONNECTION_STRING;
  if (cs) c.connectionString = cs;
  const url = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (url) c.publicUrl = url;
  c.publicUrl = c.publicUrl.replace(/\/+$/, '');
  return c;
}

export const config: Config = load();

/** True when the connection string comes from the environment (Render): config.json cannot change it. */
export const connectionFromEnv = () => !!(process.env.DATABASE_URL || process.env.ZK_CONNECTION_STRING);

export function saveConnectionString(cs: string) {
  const current = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
  fs.writeFileSync(FILE, JSON.stringify({ ...current, connectionString: cs }, null, 2));
}
