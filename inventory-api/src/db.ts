/**
 * PostgreSQL access (Supabase in the cloud, any PostgreSQL locally). The web version has its own database: the Windows
 * program's SQL Server database is not used or changed (scripts/copy-from-sqlserver.ts copies its data once, read only).
 *
 * Queries keep the SQL Server style of this code base: @name parameters, PascalCase names (EmployeeId, IsActive ...).
 * PostgreSQL folds unquoted names to lower case, so the tables are created unquoted (config/schema.ts) and the column
 * names of every result are given their spelling back (the one used in the query text, else the one in the schema).
 * Date/time columns are exchanged as text ('yyyy-MM-dd HH:mm:ss'); the database keeps local time, no time zones.
 */
import { Pool, types, type PoolClient, type QueryResult } from 'pg';
import { config } from './config';

// Numbers as numbers (COUNT(*) and BIGINT ids are int8, DECIMAL is numeric); dates as the text PostgreSQL shows.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1114, (v) => v);

/** A transaction: the connection it runs on. */
export type Tx = PoolClient;

/** Time zone of "now" in the database (DEFAULT LOCALTIMESTAMP); the same as the Node process (TZ, e.g. Asia/Kolkata). */
export const TIME_ZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

let pool: Pool | null = null;

/** SSL for every server but this computer (Supabase needs it; its certificate chain is not in Node's list). */
export function poolOptions(connectionString: string) {
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString) || process.env.PGSSL === 'disable';
  const cs = connectionString.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '');
  return { connectionString: cs, ssl: local ? false : { rejectUnauthorized: false }, max: 5, idleTimeoutMillis: 60_000 };
}

export async function getPool(): Promise<Pool> {
  if (pool) return pool;
  const p = new Pool(poolOptions(config.connectionString));
  p.on('connect', (c) => { c.query(`SET TIME ZONE '${TIME_ZONE.replace(/'/g, '')}'`).catch(() => {}); });
  p.on('error', (e) => console.error('database connection lost:', e.message));
  await (await p.connect()).release();
  pool = p;
  return pool;
}

export type Params = Record<string, unknown>;

/** Runs a query with @name parameters and returns its rows. */
export async function query<T = any>(text: string, params: Params = {}, tx?: Tx): Promise<T[]> {
  const results = await run(text, params, tx);
  return results[results.length - 1].rows as T[];
}

export async function one<T = any>(text: string, params: Params = {}, tx?: Tx): Promise<T | undefined> {
  return (await query<T>(text, params, tx))[0];
}

/** Runs one or more statements (separated by ;) and returns the number of rows they changed. */
export async function exec(text: string, params: Params = {}, tx?: Tx): Promise<number> {
  return (await run(text, params, tx)).reduce((a, r) => a + (r.rowCount ?? 0), 0);
}

/** Runs `fn` in a transaction; rolls back when it throws. */
export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await (await getPool()).connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function run(text: string, params: Params, tx?: Tx): Promise<QueryResult[]> {
  const statements = prepare(text);
  if (statements.length === 1 || tx) {
    const db = tx ?? (await getPool());
    const out: QueryResult[] = [];
    for (const s of statements) out.push(await one1(db, s, params));
    return out;
  }
  // Several statements: all or nothing, as one SQL Server batch in a transaction would be.
  return transaction(async (t) => {
    const out: QueryResult[] = [];
    for (const s of statements) out.push(await one1(t, s, params));
    return out;
  });
}

async function one1(db: Pool | PoolClient, s: Prepared, params: Params): Promise<QueryResult> {
  const values = s.names.map((n) => value(params[n]));
  const r = await db.query(s.sql, values);
  if (r.rows?.length && r.fields?.length) {
    const rename = r.fields.map((f) => [f.name, s.names2.get(f.name) ?? COLUMN_NAMES.get(f.name) ?? f.name] as const)
      .filter(([a, b]) => a !== b);
    if (rename.length)
      for (const row of r.rows) for (const [a, b] of rename) { row[b] = row[a]; delete row[a]; }
  }
  return r;
}

/** Parameter values: arrays stay arrays (x = ANY(@ids)), booleans / numbers / Buffers as they are, the rest as text. */
function value(v: unknown) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'boolean' || Array.isArray(v) || Buffer.isBuffer(v)) return v;
  return String(v);
}

interface Prepared { sql: string; names: string[]; names2: Map<string, string> }
const cache = new Map<string, Prepared[]>();

/**
 * Splits the text into statements at ; and turns @name into $1, $2 ... (not inside '...' or "..."). Also collects the
 * spelling of every mixed-case name in the text, to give the result columns their names back.
 */
function prepare(text: string): Prepared[] {
  const hit = cache.get(text);
  if (hit) return hit;
  const out: Prepared[] = [];
  let cur = '', names: string[] = [], spell = new Map<string, string>();
  const flush = () => {
    if (cur.trim()) out.push({ sql: cur.trim(), names, names2: spell });
    cur = ''; names = []; spell = new Map();
  };
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < text.length && (text[j] !== c || text[j + 1] === c)) j += text[j] === c ? 2 : 1;
      cur += text.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '-' && text[i + 1] === '-') { const j = text.indexOf('\n', i); i = j < 0 ? text.length : j; continue; }
    if (c === ';') { flush(); i++; continue; }
    if (c === '@' && /[A-Za-z_]/.test(text[i + 1] ?? '')) {
      const m = /^@([A-Za-z_]\w*)/.exec(text.slice(i))!;
      let n = names.indexOf(m[1]);
      if (n < 0) { names.push(m[1]); n = names.length - 1; }
      cur += '$' + (n + 1); i += m[0].length; continue;
    }
    if (c === ':' && text[i + 1] === ':') { cur += '::'; i += 2; continue; }
    const w = /^[A-Za-z_]\w*/.exec(text.slice(i));
    if (w && !/\w/.test(text[i - 1] ?? '')) {
      if (w[0] !== w[0].toLowerCase() && w[0] !== w[0].toUpperCase() && !spell.has(w[0].toLowerCase())) spell.set(w[0].toLowerCase(), w[0]);
      cur += w[0]; i += w[0].length; continue;
    }
    cur += c; i++;
  }
  flush();
  if (cache.size < 2000) cache.set(text, out);
  return out;
}

/** lower case → PascalCase of every column in config/schema.ts (for SELECT * and names not written in the query). */
const COLUMN_NAMES = new Map<string, string>();
export function registerColumns(names: Iterable<string>) {
  for (const n of names) if (!COLUMN_NAMES.has(n.toLowerCase())) COLUMN_NAMES.set(n.toLowerCase(), n);
}
