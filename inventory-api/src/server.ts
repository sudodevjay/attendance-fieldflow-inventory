/**
 * Inventory service: its own PostgreSQL database; employees / departments / work sites and notifications come from the
 * attendance server's API.
 *   npm run dev     development (DATABASE_URL, ATTENDANCE_URL, SERVICE_TOKEN in the environment)
 *   npm start       production
 */
import { app } from './app';
import { ensureDirectory } from './attendance';
import { config } from './config';
import { getPool } from './db';
import { ensureInventoryTables } from './inventory/schema';
import { startJobs } from './inventory/services/automation.service';

async function main() {
  if (!config.serviceToken) throw new Error('Set SERVICE_TOKEN (the same secret as on the attendance server).');
  await getPool();
  await ensureInventoryTables();
  // First copy of employees / departments / sites; when attendance is not up yet it is fetched on the first request.
  await ensureDirectory().catch((e) => console.error('attendance not reachable yet:', e.message ?? e));
  startJobs();
  app.listen(config.port, '::', () => console.log(`Inventory service on http://localhost:${config.port} (attendance: ${config.attendanceUrl})`));
}

main().catch((e) => {
  console.error('Could not start:', e.message ?? e);
  console.error('Database (DATABASE_URL):', config.connectionString.replace(/(:\/\/[^:/@]+:)[^@]*@/, '$1*****@'));
  process.exit(1);
});
