/**
 * ZK Attendance web server with its own PostgreSQL database (Supabase in the cloud); serves the React app
 * (web/client/dist) and the JSON API, plus the API the Raspberry Pi (pi/lx50pi) talks to.
 *   npm run dev     development (with the React dev server on :5173 proxying /api here)
 *   npm start       production (build the client first: cd ../client && npm run build)
 */
import { app } from './app';
import { config } from './config';
import { getPool } from './config/db';
import { ensureWebTables } from './config/schema';
import { hasPassword, setInitialPassword } from './services/auth.service';

async function main() {
  await getPool();
  await ensureWebTables();
  // In the cloud nobody opens the program "on the server PC": ADMIN_PASSWORD sets the first Supervisor password.
  if (process.env.ADMIN_PASSWORD && !(await hasPassword())) {
    await setInitialPassword(process.env.ADMIN_PASSWORD);
    console.log('Administrator password set from ADMIN_PASSWORD.');
  }
  // '::' = IPv6 and IPv4, so a Pi that only reaches this PC over IPv6 (mobile hotspot) works too.
  app.listen(config.port, '::', () => console.log(`ZK Attendance web server on http://localhost:${config.port}`));
}

main().catch((e) => {
  console.error('Could not start:', e.message ?? e);
  console.error('Database (DATABASE_URL or server/config.json):', config.connectionString.replace(/(:\/\/[^:/@]+:)[^@]*@/, '$1*****@'));
  process.exit(1);
});
