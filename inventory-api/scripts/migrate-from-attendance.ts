/**
 * One-time move of the inventory data that lived in the attendance database (Inv* tables, before the inventory became its
 * own service) into the inventory's own database. The attendance database is only read; nothing there changes or is
 * deleted. Columns that the old tables did not have yet keep their defaults; ids and document numbers stay the same.
 *
 *   cd inventory-api
 *   set SOURCE_DATABASE_URL=<attendance database URL>
 *   set DATABASE_URL=<inventory database URL>
 *   npx tsx scripts/migrate-from-attendance.ts --yes          (refuses when the inventory database has data; --force replaces it)
 */
import { Client } from 'pg';
import { config } from '../src/config';
import { poolOptions } from '../src/db';
import { ensureInventoryTables, INVENTORY_TABLES } from '../src/inventory/schema';

const mask = (cs: string) => cs.replace(/(:\/\/[^:/@]+:)[^@]*@/, '$1*****@');

async function main() {
  const source = process.env.SOURCE_DATABASE_URL;
  if (!source) throw new Error('Set SOURCE_DATABASE_URL (the attendance database) and DATABASE_URL (the inventory database).');
  if (source === config.connectionString) throw new Error('SOURCE_DATABASE_URL and DATABASE_URL are the same database.');
  if (!process.argv.includes('--yes')) throw new Error(`This copies the inventory from ${mask(source)} into ${mask(config.connectionString)}. Add --yes.`);

  await ensureInventoryTables();
  const src = new Client(poolOptions(source));
  const dst = new Client(poolOptions(config.connectionString));
  await src.connect();
  await dst.connect();
  const have = async (c: Client, t: string) => (await c.query('SELECT 1 FROM information_schema.tables WHERE table_name = $1', [t.toLowerCase()])).rowCount! > 0;
  const columns = async (c: Client, t: string) => (await c.query('SELECT column_name FROM information_schema.columns WHERE table_name = $1', [t.toLowerCase()])).rows.map((r) => r.column_name as string);

  const tables: string[] = [];
  for (const t of INVENTORY_TABLES) if (await have(src, t)) tables.push(t);
  if (!tables.length) { console.log('The attendance database has no inventory tables: nothing to move.'); process.exit(0); }
  const filled = [];
  for (const t of tables) if (Number((await dst.query(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n) > 0) filled.push(t);
  // A new inventory database has only its seed (Main Store, categories, RECEIVING): those are replaced.
  const seedOnly = filled.every((t) => ['InvWarehouses', 'InvCategories', 'InvLocations'].includes(t));
  if (filled.length && !seedOnly && !process.argv.includes('--force'))
    throw new Error(`The inventory database has data already (${filled.join(', ')}). Add --force to replace it.`);

  await dst.query('BEGIN');
  await dst.query(`TRUNCATE ${INVENTORY_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  for (const t of tables) {
    const target = new Set(await columns(dst, t));
    const cols = (await columns(src, t)).filter((c) => target.has(c));
    const rows = (await src.query(`SELECT ${cols.join(', ')} FROM ${t}`)).rows;
    const per = Math.max(1, Math.min(500, Math.floor(30000 / Math.max(1, cols.length))));
    for (let i = 0; i < rows.length; i += per) {
      const values: unknown[] = [];
      const tuples = rows.slice(i, i + per).map((r) => '(' + cols.map((c) => { values.push(r[c]); return '$' + values.length; }).join(', ') + ')');
      await dst.query(`INSERT INTO ${t} (${cols.join(', ')}) VALUES ${tuples.join(', ')}`, values);
    }
    if (cols.includes('id'))
      await dst.query(`SELECT setval(pg_get_serial_sequence('${t.toLowerCase()}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
    console.log(`  ${t}: ${rows.length} row(s)`);
  }
  await dst.query('COMMIT');
  await src.end();
  await dst.end();
  // RECEIVING per store and stock on locations (the old tables had no locations).
  await ensureInventoryTables();
  console.log('Inventory moved. The attendance database was not changed; its Inv* tables can be dropped once the inventory service runs well.');
  process.exit(0);
}

main().catch((e) => { console.error('Move failed:', e.message ?? e); process.exit(1); });
