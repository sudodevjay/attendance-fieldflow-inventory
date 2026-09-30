/**
 * Copies the data of the Windows program's SQL Server database into the web version's PostgreSQL database, once.
 * SQL Server is only READ (SELECT); nothing there is changed. The PostgreSQL tables are emptied first.
 *
 *   cd web/server
 *   set DATABASE_URL=postgresql://...          (the Supabase / PostgreSQL database)
 *   npx tsx scripts/copy-from-sqlserver.ts [--source "<ODBC connection string>"] [--yes]
 *
 * Default source: the Windows program's database (.\SQLEXPRESS, ZkAttendance, Windows login). Needs Windows with the
 * ODBC Driver 18 for SQL Server (the optional npm packages mssql + msnodesqlv8).
 */
import { Client } from 'pg';
import { config } from '../src/config';
import { poolOptions } from '../src/config/db';
import { ensureWebTables, TABLES } from '../src/config/schema';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const SOURCE = arg('--source') ??
  'Driver={ODBC Driver 18 for SQL Server};Server=.\\SQLEXPRESS;Database=ZkAttendance;Trusted_Connection=yes;TrustServerCertificate=yes;';

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sql = require('mssql/msnodesqlv8');
  const src = await new sql.ConnectionPool({ connectionString: SOURCE }).connect();
  const pg = new Client(poolOptions(config.connectionString));
  await pg.connect();
  const target = config.connectionString.replace(/(:\/\/[^:/@]+:)[^@]*@/, '$1*****@');
  const db = (await src.request().query('SELECT DB_NAME() d')).recordset[0].d;
  console.log(`From SQL Server database ${db} (read only) to ${target}`);

  await ensureWebTables(); // tables exist (config/db pool, same database)
  const counts = await pg.query(`SELECT (SELECT COUNT(*) FROM Employees) e, (SELECT COUNT(*) FROM AttendanceLogs) a`);
  if ((+counts.rows[0].e > 1 || +counts.rows[0].a > 0) && !process.argv.includes('--yes')) {
    console.error('The PostgreSQL database already has employees / punches. Run again with --yes to replace them.');
    process.exit(1);
  }

  await pg.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  for (const table of TABLES) {
    const exists = (await src.request().query(`SELECT OBJECT_ID('${table}') id`)).recordset[0].id;
    if (!exists) { console.log(`  ${table}: not in SQL Server, skipped`); continue; }
    const cols = (await pg.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [table.toLowerCase()])).rows;
    const have = new Set((await src.request().query(`SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('${table}')`))
      .recordset.map((r: any) => String(r.name).toLowerCase()));
    const use = cols.filter((c) => have.has(c.column_name));
    // Dates as text, so no time zone conversion happens on the way.
    const select = use.map((c) => {
      const n = `[${c.column_name}]`;
      if (c.data_type.startsWith('timestamp')) return `CONVERT(varchar(23), ${n}, 121) ${n}`;
      if (c.data_type === 'date') return `CONVERT(varchar(10), ${n}, 120) ${n}`;
      if (c.data_type.startsWith('time')) return `CONVERT(varchar(8), ${n}, 108) ${n}`;
      return n;
    });
    const rows = (await src.request().query(`SELECT ${select.join(', ')} FROM [${table}]`)).recordset as any[];
    const names = use.map((c) => c.column_name);
    const per = Math.max(1, Math.min(500, Math.floor(30000 / names.length)));
    for (let i = 0; i < rows.length; i += per) {
      const part = rows.slice(i, i + per);
      const values: unknown[] = [];
      const tuples = part.map((r) => '(' + names.map((n) => {
        const key = Object.keys(r).find((k) => k.toLowerCase() === n)!;
        values.push(r[key] ?? null);
        return '$' + values.length;
      }).join(', ') + ')');
      await pg.query(`INSERT INTO ${table} (${names.join(', ')}) VALUES ${tuples.join(', ')}`, values);
    }
    // Identity columns continue after the copied ids.
    if (names.includes('id') && cols.find((c) => c.column_name === 'id')?.data_type.includes('int'))
      await pg.query(`SELECT setval(pg_get_serial_sequence('${table.toLowerCase()}', 'id'), GREATEST((SELECT MAX(id) FROM ${table}), 0) + 1, false)`)
        .catch(() => {});
    console.log(`  ${table}: ${rows.length} row(s)`);
  }
  await ensureWebTables(); // seed rows that are still missing (e.g. salary components, leave type CO)
  await src.close();
  await pg.end();
  console.log('Done. SQL Server was not changed.');
  process.exit(0);
}

main().catch((e) => { console.error('Copy failed:', e.message ?? e); process.exit(1); });
