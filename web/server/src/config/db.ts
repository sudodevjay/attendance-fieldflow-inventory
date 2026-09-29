/**
 * SQL Server access. The tables belong to the Windows program (Entity Framework, src/ZkAttendance/Data); this server
 * reads and writes the same rows. Date/time columns are exchanged as text ('yyyy-MM-dd HH:mm:ss', CONVERT style 120)
 * so no time zone conversion ever happens: the database keeps local time, exactly as the Windows program writes it.
 */
import type * as MSSQL from 'mssql';
import { config } from './index';

// mssql's msnodesqlv8 driver (Windows login through ODBC). CommonJS module with a native part.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sql: typeof MSSQL = require('mssql/msnodesqlv8');
export { sql };

let pool: MSSQL.ConnectionPool | null = null;

export async function getPool(): Promise<MSSQL.ConnectionPool> {
  if (pool?.connected) return pool;
  pool = await new sql.ConnectionPool({ connectionString: config.connectionString } as unknown as MSSQL.config).connect();
  return pool;
}

export type Params = Record<string, unknown>;

/** Runs a query with @name parameters. Strings go as NVARCHAR, numbers as INT or FLOAT, booleans as BIT, null as NULL. */
export async function query<T = any>(text: string, params: Params = {}, tx?: MSSQL.Transaction): Promise<T[]> {
  const req = tx ? new sql.Request(tx) : (await getPool()).request();
  for (const [k, v] of Object.entries(params)) bind(req, k, v);
  const r = await req.query(text);
  const rows = (r.recordset ?? []) as any[];
  // The ODBC driver returns IDENTITY columns as text without a type; turn them (and integer columns) into numbers.
  const cols = (r.recordset as any)?.columns ?? {};
  const ints = Object.keys(cols).filter((c) => !cols[c].type || [sql.Int, sql.BigInt, sql.SmallInt, sql.TinyInt].includes(cols[c].type));
  if (ints.length)
    for (const row of rows) for (const c of ints) if (typeof row[c] === 'string' && /^-?\d+$/.test(row[c])) row[c] = Number(row[c]);
  return rows as T[];
}

export async function one<T = any>(text: string, params: Params = {}, tx?: MSSQL.Transaction): Promise<T | undefined> {
  return (await query<T>(text, params, tx))[0];
}

export async function exec(text: string, params: Params = {}, tx?: MSSQL.Transaction): Promise<number> {
  const req = tx ? new sql.Request(tx) : (await getPool()).request();
  for (const [k, v] of Object.entries(params)) bind(req, k, v);
  const r = await req.query(text);
  return r.rowsAffected.reduce((a, b) => a + b, 0);
}

function bind(req: MSSQL.Request, name: string, v: unknown) {
  if (v === null || v === undefined) req.input(name, sql.NVarChar, null);
  else if (typeof v === 'number') req.input(name, Number.isInteger(v) && Math.abs(v) < 2 ** 31 ? sql.Int : sql.Float, v);
  else if (typeof v === 'boolean') req.input(name, sql.Bit, v);
  else if (Array.isArray(v)) req.input(name, sql.NVarChar(sql.MAX), JSON.stringify(v));
  else req.input(name, sql.NVarChar(sql.MAX), String(v));
}

/** Runs `fn` in a transaction; rolls back when it throws. */
export async function transaction<T>(fn: (tx: MSSQL.Transaction) => Promise<T>): Promise<T> {
  const tx = new sql.Transaction(await getPool());
  await tx.begin();
  try {
    const r = await fn(tx);
    await tx.commit();
    return r;
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}
