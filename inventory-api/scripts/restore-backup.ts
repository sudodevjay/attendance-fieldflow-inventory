/**
 * Loads an inventory backup (Inventory → Automation settings → Backup inventory, ZkInventory_yyyyMMdd_HHmm.json) into the
 * inventory database. Every table in the file is emptied and filled from the file.
 *
 *   cd inventory-api
 *   set DATABASE_URL=postgresql://...
 *   npx tsx scripts/restore-backup.ts <file.json> --yes
 */
import fs from 'fs';
import { Client } from 'pg';
import { config } from '../src/config';
import { poolOptions } from '../src/db';
import { ensureInventoryTables, INVENTORY_TABLES } from '../src/inventory/schema';

async function main() {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) throw new Error('Usage: npx tsx scripts/restore-backup.ts <backup.json> --yes');
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (backup.kind !== 'zk-inventory-backup') throw new Error('This is not an inventory backup file.');
  if (!process.argv.includes('--yes')) throw new Error(`This replaces the data in ${config.connectionString.replace(/(:\/\/[^:/@]+:)[^@]*@/, '$1*****@')}. Add --yes.`);

  await ensureInventoryTables();
  const pg = new Client(poolOptions(config.connectionString));
  await pg.connect();
  await pg.query('BEGIN');
  const tables = INVENTORY_TABLES.filter((t) => Array.isArray(backup.tables?.[t]));
  await pg.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  for (const t of tables) {
    const rows: Record<string, unknown>[] = backup.tables[t];
    if (!rows.length) continue;
    const names = Object.keys(rows[0]);
    const per = Math.max(1, Math.min(500, Math.floor(30000 / names.length)));
    for (let i = 0; i < rows.length; i += per) {
      const values: unknown[] = [];
      const tuples = rows.slice(i, i + per).map((r) => '(' + names.map((n) => { values.push(r[n] ?? null); return '$' + values.length; }).join(', ') + ')');
      await pg.query(`INSERT INTO ${t} (${names.join(', ')}) VALUES ${tuples.join(', ')}`, values);
    }
    if (names.includes('Id'))
      await pg.query(`SELECT setval(pg_get_serial_sequence('${t.toLowerCase()}', 'id'), (SELECT MAX(id) FROM ${t}) + 1, false)`);
    console.log(`  ${t}: ${rows.length} row(s)`);
  }
  await pg.query('COMMIT');
  await pg.end();
  console.log(`Restored the inventory backup of ${backup.createdAt}.`);
  process.exit(0);
}

main().catch((e) => { console.error('Restore failed:', e.message ?? e); process.exit(1); });
