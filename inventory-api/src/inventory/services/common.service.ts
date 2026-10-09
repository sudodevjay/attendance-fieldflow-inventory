/** Small shared pieces of the inventory module: settings, document numbers, alerts, input checks. */
import { exec, one, query, type Tx } from '../../db';
import { UserError } from '../../utils/errors';
import { fmt, parse, today, year } from '../../utils/time';

// ------------------------------------------------------------------ settings (InvSettings)

/** What the store can switch on / off (Inventory → Settings). Values are text as in AppSettings. */
export const DEFAULTS = {
  /** off | draft | ordered: a PO for the preferred supplier when an item falls below its re-order level. */
  AutoPO: 'draft',
  /** hod = the HOD (or the store) approves a requisition first; none = requisitions are approved at once. */
  Approval: 'hod',
  /** 1 = an approved requisition is issued at once when the stock is there (and again when goods arrive). */
  AutoIssue: '0',
  /** 1 = an issue may take the stock below zero (not recommended). */
  AllowNegative: '0',
  /** Store of automatic POs and of portal requisitions without a store; '' = the first active store. */
  DefaultWarehouseId: '',
  /** Days a requisition may wait for a decision before the store is reminded. */
  PendingReminderDays: '2',
  /** Days between two reminders to an employee who has not given a returnable item back. */
  OverdueReminderDays: '7',
  /** Most open things one employee's bin may hold (returnables, serial units, material at a site); 0 = no limit. */
  BinLimit: '0',
  /** Last day the daily checks ran (yyyy-MM-dd). */
  LastDailyRun: '',
} as const;
export type SettingKey = keyof typeof DEFAULTS;

export async function getSetting(key: SettingKey): Promise<string> {
  return (await one('SELECT Value FROM InvSettings WHERE Key = @k', { k: key }))?.Value ?? DEFAULTS[key];
}

export async function getSettings(): Promise<Record<SettingKey, string>> {
  const rows = await query('SELECT Key, Value FROM InvSettings');
  const out: Record<string, string> = { ...DEFAULTS };
  for (const r of rows) if (r.Key in DEFAULTS) out[r.Key] = r.Value;
  return out as Record<SettingKey, string>;
}

export async function setSetting(key: SettingKey, value: string) {
  await exec('INSERT INTO InvSettings (Key, Value) VALUES (@k, @v) ON CONFLICT (Key) DO UPDATE SET Value = EXCLUDED.Value', { k: key, v: value.slice(0, 500) });
}

const CHOICES: Partial<Record<SettingKey, string[]>> = {
  AutoPO: ['off', 'draft', 'ordered'], Approval: ['hod', 'none'], AutoIssue: ['0', '1'], AllowNegative: ['0', '1'],
};

/** Saves the settings screen (only known keys, checked values). */
export async function saveSettings(b: Record<string, unknown>) {
  for (const key of Object.keys(DEFAULTS) as SettingKey[]) {
    if (key === 'LastDailyRun' || b[key] === undefined) continue;
    let v = String(b[key] ?? '').trim();
    if (typeof b[key] === 'boolean') v = b[key] ? '1' : '0';
    const choices = CHOICES[key];
    if (choices && !choices.includes(v)) throw new UserError(`Invalid value for ${key}.`);
    if (key === 'PendingReminderDays' || key === 'OverdueReminderDays') v = String(Math.min(90, Math.max(1, Math.round(Number(v)) || 1)));
    if (key === 'BinLimit') v = String(Math.min(10000, Math.max(0, Math.round(Number(v)) || 0)));
    if (key === 'DefaultWarehouseId' && v && !(await one('SELECT Id FROM InvWarehouses WHERE Id = @id', { id: Number(v) || 0 })))
      throw new UserError('Choose an existing store.');
    await setSetting(key, v);
  }
}

/** The store automatic POs and portal requisitions go to. */
export async function defaultWarehouse(tx?: Tx): Promise<number> {
  const id = Number(await getSetting('DefaultWarehouseId')) || 0;
  const w = await one('SELECT Id FROM InvWarehouses WHERE IsActive AND (Id = @id OR @id = 0) ORDER BY (Id = @id) DESC, Id LIMIT 1', { id }, tx);
  if (!w) throw new UserError('Add a store (Inventory → Masters → Stores) first.');
  return w.Id;
}

// ------------------------------------------------------------------ document numbers

/** Next number of a document kind, per year: PO/2026/0001, GRN/2026/0001 ... (inside the document's transaction). */
export async function nextNo(prefix: 'PO' | 'GRN' | 'REQ' | 'ISS' | 'TRF' | 'ADJ' | 'CNT' | 'MOV', tx: Tx): Promise<string> {
  const y = year(today());
  const r = await one(`INSERT INTO InvCounters (Key, Value) VALUES (@k, 1)
    ON CONFLICT (Key) DO UPDATE SET Value = InvCounters.Value + 1 RETURNING Value`, { k: `${prefix}-${y}` }, tx);
  return `${prefix}/${y}/${String(r!.Value).padStart(4, '0')}`;
}

/** Next free item code ITM-0001 when the store leaves the code empty. */
export async function nextItemCode(tx?: Tx): Promise<string> {
  const r = await one(`INSERT INTO InvCounters (Key, Value) VALUES ('ITEM', 1)
    ON CONFLICT (Key) DO UPDATE SET Value = InvCounters.Value + 1 RETURNING Value`, {}, tx);
  const code = `ITM-${String(r!.Value).padStart(4, '0')}`;
  return (await one('SELECT 1 FROM InvItems WHERE Code = @c', { c: code }, tx)) ? nextItemCode(tx) : code;
}

// ------------------------------------------------------------------ alerts (InvAlerts)

export type AlertKind = 'LowStock' | 'AutoPO' | 'LatePO' | 'Overdue' | 'ExitClearance' | 'PendingReq' | 'CanIssue' | 'NewReq';

/** Opens an alert unless one with the same key is still open; true when a new one was made. Never fails the caller. */
export async function raise(kind: AlertKind, key: string, title: string, body = '', link = '', tx?: Tx): Promise<boolean> {
  try {
    const n = await exec(`INSERT INTO InvAlerts (Kind, AlertKey, Title, Body, Link) VALUES (@k, @key, @t, @b, @l)
      ON CONFLICT (AlertKey) WHERE NOT IsResolved DO NOTHING`,
    { k: kind, key: key.slice(0, 60), t: title.slice(0, 150), b: body.slice(0, 500) || null, l: link.slice(0, 100) || null }, tx);
    return n > 0;
  } catch (e) { console.error('inventory alert not saved:', e); return false; }
}

/** Closes the open alerts with these keys (the condition is over: stock is back, item returned ...). */
export async function resolve(keys: string[], tx?: Tx) {
  if (keys.length) await exec('UPDATE InvAlerts SET IsResolved = TRUE WHERE NOT IsResolved AND AlertKey = ANY(@k)', { k: keys }, tx);
}

export async function alerts(all: boolean) {
  const rows = await query(`SELECT Id, Kind, Title, Body, Link, IsRead, IsResolved, to_char(CreatedAt, 'YYYY-MM-DD HH24:MI:SS') AS CreatedAt
    FROM InvAlerts ${all ? '' : 'WHERE NOT IsResolved'} ORDER BY CreatedAt DESC, Id DESC LIMIT 300`);
  const unread = (await one('SELECT COUNT(*) c FROM InvAlerts WHERE NOT IsResolved AND NOT IsRead'))?.c ?? 0;
  return { unread, items: rows.map((r) => ({ ...r, When: fmt(parse(r.CreatedAt)!, 'dd MMM, hh:mm tt') })) };
}

export async function markAlerts(ids: number[] | 'all', dismiss: boolean) {
  const set = dismiss ? 'IsRead = TRUE, IsResolved = TRUE' : 'IsRead = TRUE';
  if (ids === 'all') await exec(`UPDATE InvAlerts SET ${set} WHERE NOT IsResolved`);
  else if (ids.length) await exec(`UPDATE InvAlerts SET ${set} WHERE Id = ANY(@ids)`, { ids });
}

// ------------------------------------------------------------------ input checks

export const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max) || null;

export function mustText(v: unknown, max: number, what: string) {
  const s = text(v, max);
  if (!s) throw new UserError(`Enter the ${what}.`);
  return s;
}

/** A number ≥ 0 (or > 0 with positive), rounded to 3 decimals. */
export function qty(v: unknown, what = 'quantity', positive = true): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || (positive && n === 0)) throw new UserError(`The ${what} must be a number${positive ? ' above 0' : ''}.`);
  return Math.round(n * 1000) / 1000;
}

export function money(v: unknown, what = 'price'): number {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new UserError(`The ${what} must be 0 or more.`);
  return Math.round(n * 100) / 100;
}

export const idOrNull = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : Number.isInteger(Number(v)) ? Number(v) : null);

export interface LineInput { ItemId?: unknown; Qty?: unknown; UnitPrice?: unknown; LineId?: unknown; Counted?: unknown }

/** Lines of a document: item + quantity, the same item only once. */
export function lines(v: unknown, opts: { price?: boolean } = {}) {
  if (!Array.isArray(v) || !v.length) throw new UserError('Add at least one item.');
  const seen = new Set<number>();
  return (v as LineInput[]).map((l) => {
    const itemId = Number(l.ItemId);
    if (!Number.isInteger(itemId) || itemId <= 0) throw new UserError('Choose the item of every line.');
    if (seen.has(itemId)) throw new UserError('An item is on two lines; put the quantity on one line.');
    seen.add(itemId);
    return { itemId, qty: qty(l.Qty), price: opts.price ? money(l.UnitPrice) : 0 };
  });
}

/** Names of items for messages. */
export async function itemNames(ids: number[], tx?: Tx): Promise<Map<number, { Code: string; Name: string; Unit: string }>> {
  const rows = ids.length ? await query('SELECT Id, Code, Name, Unit FROM InvItems WHERE Id = ANY(@ids)', { ids }, tx) : [];
  return new Map(rows.map((r) => [r.Id as number, r]));
}

export const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, ''));
