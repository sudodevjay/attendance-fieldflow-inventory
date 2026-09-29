import fs from 'fs';
import path from 'path';

/** server/config.json (optional; config.example.json shows the fields). The Windows program keeps its own appsettings.json. */
export interface Config {
  port: number;
  connectionString: string;
}

/** web/server */
export const ROOT = path.resolve(__dirname, '..', '..');
const FILE = path.join(ROOT, 'config.json');

const defaults: Config = {
  port: 4000,
  // Same database as the Windows program (src/ZkAttendance/appsettings.json), through ODBC with the Windows login.
  connectionString:
    'Driver={ODBC Driver 18 for SQL Server};Server=.\\SQLEXPRESS;Database=ZkAttendance;Trusted_Connection=yes;TrustServerCertificate=yes;',
};

/** Defaults < config.json < environment (PORT, ZK_CONNECTION_STRING; used by the end-to-end test). */
function load(): Config {
  const file = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
  const c: Config = { ...defaults, ...file };
  if (process.env.PORT) c.port = parseInt(process.env.PORT, 10);
  if (process.env.ZK_CONNECTION_STRING) c.connectionString = process.env.ZK_CONNECTION_STRING;
  return c;
}

export const config: Config = load();

export function saveConnectionString(cs: string) {
  const current = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
  fs.writeFileSync(FILE, JSON.stringify({ ...current, connectionString: cs }, null, 2));
}
