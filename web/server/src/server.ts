/**
 * ZK Attendance web server. Same SQL Server database as the Windows program (src/ZkAttendance); serves the React app
 * (web/client/dist) and the JSON API, plus the API the Raspberry Pi (pi/lx50pi) talks to.
 *   npm run dev     development (with the React dev server on :5173 proxying /api here)
 *   npm start       production (build the client first: cd ../client && npm run build)
 */
import { app } from './app';
import { config } from './config';
import { getPool } from './config/db';
import { ensureWebTables } from './config/schema';

async function main() {
  await getPool();
  await ensureWebTables();
  // '::' = IPv6 and IPv4, so a Pi that only reaches this PC over IPv6 (mobile hotspot) works too.
  app.listen(config.port, '::', () => console.log(`ZK Attendance web server on http://localhost:${config.port}`));
}

main().catch((e) => {
  console.error('Could not start:', e.message ?? e);
  console.error('Connection string (server/config.json):', config.connectionString);
  process.exit(1);
});
