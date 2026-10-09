/**
 * Stock: every change of a balance goes through post() inside the document's transaction. It locks the balance row,
 * refuses to go below zero (unless the setting allows it), keeps the weighted average cost for goods coming in and
 * writes the movement to the ledger with the balance after it. After the commit, afterStockChange() runs the automatic
 * re-order for the items that went out.
 */
import { exec, one, query, transaction, type Tx } from '../../db';
import { UserError } from '../../utils/errors';
import { addDays, mustParse, sqlD } from '../../utils/time';
import { reorderCheck } from './automation.service';
import { getSetting, itemNames, lines, mustText, nextNo, qty, qtyText, text } from './common.service';
import { addLocStock, allocateOut, mustLocation, receiving, type Alloc } from './location.service';
import { unitsIn, unitsOut, type NewUnit, type UnitStatus } from './unit.service';

export type MoveType = 'Opening' | 'Receipt' | 'Issue' | 'Return' | 'TransferOut' | 'TransferIn' | 'Adjustment' | 'Move';

export interface Move {
  itemId: number; warehouseId: number; type: MoveType;
  /** + in, - out */
  qty: number;
  /** Cost of goods coming in (receipt, opening, adjustment +); out of stock always leaves at the average cost. */
  unitCost?: number;
  refType?: string; refId?: number; refNo?: string;
  employeeId?: number | null; departmentId?: number | null; note?: string | null; by: string;
  /** Serial items: the units that move (scanned); empty = the oldest in the store (out) / new units (in). */
  units?: number[];
  /** Serial items coming in as new units: their serial numbers / tags (the rest are numbered automatically). */
  serials?: NewUnit[];
  /** Set by post() for serial items: the units that moved. */
  picked?: number[];
  /** Location in the store: where goods go to (in; empty = RECEIVING) / come from (out; empty = where they lie). */
  locationId?: number | null;
  /** Set by post(): the locations and quantities it used. */
  locs?: Alloc[];
}

/** What happens to the units of a serial item for each kind of movement. */
const UNIT_OUT: Partial<Record<MoveType, UnitStatus>> = { Issue: 'Issued', TransferOut: 'Transit', Adjustment: 'Scrapped' };
const UNIT_EVENT: Record<MoveType, string> = {
  Opening: 'Opening', Receipt: 'Received', Issue: '', Return: 'Returned', TransferOut: '', TransferIn: 'Transferred', Adjustment: 'Adjusted', Move: 'Moved',
};

/** Posts one movement; returns the unit cost it was valued at. */
export async function post(m: Move, tx: Tx): Promise<number> {
  if (!m.qty) return 0;
  const serial = (await one('SELECT TrackBy FROM InvItems WHERE Id = @i', { i: m.itemId }, tx))?.TrackBy === 'Serial';
  if (serial && !Number.isInteger(m.qty)) throw new UserError('Serial items are counted in whole units.');
  await exec('INSERT INTO InvStock (ItemId, WarehouseId) VALUES (@i, @w) ON CONFLICT DO NOTHING', { i: m.itemId, w: m.warehouseId }, tx);
  const s = (await one('SELECT Qty, AvgCost FROM InvStock WHERE ItemId = @i AND WarehouseId = @w FOR UPDATE', { i: m.itemId, w: m.warehouseId }, tx))!;
  const have = Number(s.Qty), avg = Number(s.AvgCost);
  const after = Math.round((have + m.qty) * 1000) / 1000;
  if (m.qty < 0 && after < 0 && (await getSetting('AllowNegative')) !== '1') {
    const it = (await itemNames([m.itemId], tx)).get(m.itemId);
    const w = await one('SELECT Name FROM InvWarehouses WHERE Id = @w', { w: m.warehouseId }, tx);
    throw new UserError(`Not enough stock of ${it?.Code} ${it?.Name} in ${w?.Name}: ${qtyText(have)} ${it?.Unit} there, ${qtyText(-m.qty)} needed.`);
  }
  let cost = avg;
  let newAvg = avg;
  if (m.qty > 0 && m.unitCost !== undefined) {
    cost = m.unitCost;
    // Weighted average; when the store was empty (or below zero) the new goods set the cost.
    newAvg = have <= 0 ? cost : (have * avg + m.qty * cost) / (have + m.qty);
  }
  await exec('UPDATE InvStock SET Qty = @q, AvgCost = @a WHERE ItemId = @i AND WarehouseId = @w',
    { q: after, a: Math.round(newAvg * 10000) / 10000, i: m.itemId, w: m.warehouseId }, tx);
  // Locations: in = the given one or RECEIVING; out = the units' locations / the given one / where the item lies.
  const u = { itemId: m.itemId, warehouseId: m.warehouseId, n: Math.abs(m.qty), units: m.units, refNo: m.refNo, note: m.note, by: m.by };
  let locs: Alloc[];
  if (m.qty > 0) {
    const loc = m.locationId ? (await mustLocation(m.locationId, m.warehouseId, tx)).Id : await receiving(m.warehouseId, tx);
    locs = [{ locationId: loc, qty: m.qty }];
    if (serial) m.picked = await unitsIn({ ...u, locationId: loc, serials: m.serials, cost, event: UNIT_EVENT[m.type] }, tx);
  } else if (serial) {
    const out = await unitsOut({ ...u, locationId: m.units ? null : m.locationId ?? null, status: UNIT_OUT[m.type] ?? 'Scrapped', event: UNIT_EVENT[m.type] }, tx);
    m.picked = out.map((x) => x.id);
    const by = new Map<number, number>();
    for (const x of out) { const l = x.locationId ?? await receiving(m.warehouseId, tx); by.set(l, (by.get(l) ?? 0) + 1); }
    if (out.length < -m.qty) { const r = await receiving(m.warehouseId, tx); by.set(r, (by.get(r) ?? 0) + (-m.qty - out.length)); } // negative stock allowed
    locs = [...by].map(([locationId, n]) => ({ locationId, qty: -n }));
  } else {
    locs = (await allocateOut(m.itemId, m.warehouseId, -m.qty, m.locationId ?? null, tx)).map((a) => ({ ...a, qty: -a.qty }));
  }
  let bal = have;
  for (const a of locs) {
    await addLocStock(m.itemId, a.locationId, a.qty, tx);
    bal = Math.round((bal + a.qty) * 1000) / 1000;
    await exec(`INSERT INTO InvMovements (ItemId, WarehouseId, LocationId, Type, Qty, UnitCost, BalanceAfter, RefType, RefId, RefNo, EmployeeId, DepartmentId, Note, CreatedBy)
      VALUES (@i, @w, @l, @t, @q, @c, @b, @rt, @ri, @rn, @e, @d, @n, @by)`, {
      i: m.itemId, w: m.warehouseId, l: a.locationId, t: m.type, q: a.qty, c: Math.round(cost * 10000) / 10000, b: bal, rt: m.refType ?? null, ri: m.refId ?? null,
      rn: m.refNo ?? null, e: m.employeeId ?? null, d: m.departmentId ?? null, n: m.note?.slice(0, 300) ?? null, by: m.by.slice(0, 100),
    }, tx);
  }
  m.locs = locs;
  return cost;
}

/** Runs the automatic re-order for items whose stock went down; never fails the document that was saved. */
export async function afterStockChange(itemIds: number[]) {
  if (!itemIds.length) return;
  try {
    await reorderCheck([...new Set(itemIds)]);
  } catch (e) { console.error('inventory re-order check failed:', e); }
}

// ------------------------------------------------------------------ balances

/** Stock of every active item: total, per store, on order, value, status (OK / Low / Out). */
export async function balances(opts: { warehouseId?: number | null; categoryId?: number | null; q?: string; status?: string; includeInactive?: boolean } = {}) {
  const items = await query(`SELECT i.Id, i.Code, i.Name, i.CategoryId, c.Name AS Category, i.Unit, i.Hsn, i.GstRate, i.PurchasePrice, i.ReorderLevel,
      i.ReorderQty, i.PreferredSupplierId, s.Name AS Supplier, i.IsReturnable, i.ReturnDays, i.Description, i.IsActive, i.TrackBy, COALESCE(i.Barcode, '') AS Barcode
    FROM InvItems i LEFT JOIN InvCategories c ON c.Id = i.CategoryId LEFT JOIN InvSuppliers s ON s.Id = i.PreferredSupplierId
    WHERE (@all OR i.IsActive) AND (CAST(@cat AS int) IS NULL OR i.CategoryId = @cat)
      AND (@q = '' OR i.Code ILIKE '%' || @q || '%' OR i.Name ILIKE '%' || @q || '%' OR i.Barcode ILIKE @q)
    ORDER BY i.Name`, { all: !!opts.includeInactive, cat: opts.categoryId ?? null, q: (opts.q ?? '').trim() });
  const stock = await query('SELECT ItemId, WarehouseId, Qty, AvgCost FROM InvStock WHERE Qty <> 0');
  const onOrder = await openOrderQty();
  const out = items.map((i) => {
    const rows = stock.filter((s) => s.ItemId === i.Id);
    const here = opts.warehouseId ? rows.filter((s) => s.WarehouseId === opts.warehouseId) : rows;
    const qty = round3(here.reduce((a, s) => a + Number(s.Qty), 0));
    const value = round2(here.reduce((a, s) => a + Number(s.Qty) * Number(s.AvgCost), 0));
    const total = round3(rows.reduce((a, s) => a + Number(s.Qty), 0));
    const level = Number(i.ReorderLevel);
    const status = total <= 0 ? 'Out' : level > 0 && total <= level ? 'Low' : 'OK';
    return {
      ...i, IsActive: !!i.IsActive, IsReturnable: !!i.IsReturnable, Qty: qty, TotalQty: total, Value: value,
      AvgCost: qty > 0 ? round2(value / qty) : round2(Number(rows[0]?.AvgCost ?? 0)), OnOrder: onOrder.get(i.Id) ?? 0, Status: status,
      Stores: rows.map((s) => ({ WarehouseId: s.WarehouseId, Qty: Number(s.Qty) })),
    };
  });
  return opts.status ? out.filter((r) => (opts.status === 'Reorder' ? r.Status !== 'OK' && Number(r.ReorderLevel) > 0 : r.Status === opts.status)) : out;
}

/** Quantity still to come on open POs (Draft, Ordered, Partial), per item. */
export async function openOrderQty(tx?: Tx): Promise<Map<number, number>> {
  const rows = await query(`SELECT l.ItemId, SUM(GREATEST(l.Qty - l.ReceivedQty, 0)) AS PendingQty FROM InvPurchaseOrderLines l
    JOIN InvPurchaseOrders p ON p.Id = l.PoId WHERE p.Status IN ('Draft', 'Ordered', 'Partial') GROUP BY l.ItemId`, {}, tx);
  return new Map(rows.map((r) => [r.ItemId as number, Number(r.PendingQty)]));
}

/** Stock of one item per store. */
export async function itemStock(itemId: number, tx?: Tx) {
  return query(`SELECT w.Id AS WarehouseId, w.Name AS Warehouse, COALESCE(s.Qty, 0) AS Qty, COALESCE(s.AvgCost, 0) AS AvgCost
    FROM InvWarehouses w LEFT JOIN InvStock s ON s.WarehouseId = w.Id AND s.ItemId = @i WHERE w.IsActive OR s.Qty <> 0 ORDER BY w.Name`, { i: itemId }, tx);
}

export async function available(itemId: number, warehouseId: number, tx?: Tx): Promise<number> {
  return Number((await one('SELECT Qty FROM InvStock WHERE ItemId = @i AND WarehouseId = @w', { i: itemId, w: warehouseId }, tx))?.Qty ?? 0);
}

// ------------------------------------------------------------------ ledger

export async function ledger(f: { from: string; to: string; itemId?: number | null; warehouseId?: number | null; type?: string; employeeId?: number | null; departmentIds?: number[] | null }) {
  const from = mustParse(f.from), to = mustParse(f.to);
  if (to < from) throw new UserError("The 'To' date cannot be before the 'From' date.");
  const rows = await query(`SELECT m.Id, to_char(m.At, 'YYYY-MM-DD HH24:MI') AS At, m.ItemId, i.Code, i.Name AS Item, i.Unit, m.WarehouseId, w.Name AS Warehouse,
      COALESCE(lc.Code, '') AS Location,
      m.Type, m.Qty, m.UnitCost, ROUND(m.Qty * m.UnitCost, 2) AS Value, m.BalanceAfter, m.RefType, m.RefId, m.RefNo,
      m.EmployeeId, e.Name AS Employee, e.EnrollNo, m.DepartmentId, d.Name AS Department, m.Note, m.CreatedBy
    FROM InvMovements m JOIN InvItems i ON i.Id = m.ItemId JOIN InvWarehouses w ON w.Id = m.WarehouseId
      LEFT JOIN DirEmployees e ON e.Id = m.EmployeeId LEFT JOIN DirDepartments d ON d.Id = m.DepartmentId LEFT JOIN InvLocations lc ON lc.Id = m.LocationId
    WHERE m.At >= CAST(@f AS timestamp) AND m.At < CAST(@t AS timestamp)
      AND (CAST(@i AS int) IS NULL OR m.ItemId = @i) AND (CAST(@w AS int) IS NULL OR m.WarehouseId = @w)
      AND (@ty = '' OR m.Type = @ty) AND (CAST(@e AS int) IS NULL OR m.EmployeeId = @e)
      AND (CAST(@ds AS int[]) IS NULL OR m.DepartmentId = ANY(@ds))
    ORDER BY m.At DESC, m.Id DESC LIMIT 5000`, {
    f: sqlD(from), t: sqlD(addDays(to, 1)), i: f.itemId ?? null, w: f.warehouseId ?? null, ty: f.type ?? '', e: f.employeeId ?? null, ds: f.departmentIds ?? null,
  });
  return rows.map((r) => ({ ...r, Employee: r.Employee ?? '', Department: r.Department ?? '' }));
}

// ------------------------------------------------------------------ transfers, adjustments, stock counts

async function doc(kind: 'Transfer' | 'Adjustment' | 'Count', warehouseId: number, toId: number | null, reason: string | null, by: string, tx: Tx) {
  const no = await nextNo(kind === 'Transfer' ? 'TRF' : kind === 'Count' ? 'CNT' : 'ADJ', tx);
  const r = await one(`INSERT INTO InvStockDocs (DocNo, Kind, WarehouseId, ToWarehouseId, Reason, CreatedBy) VALUES (@no, @k, @w, @to, @r, @by) RETURNING Id`,
    { no, k: kind, w: warehouseId, to: toId, r: reason, by }, tx);
  return { id: r!.Id as number, no };
}

async function mustWarehouse(id: unknown, tx: Tx, what = 'store') {
  const w = await one('SELECT Id, Name, IsActive FROM InvWarehouses WHERE Id = @id', { id: Number(id) || 0 }, tx);
  if (!w) throw new UserError(`Choose the ${what}.`);
  if (!w.IsActive) throw new UserError(`The store ${w.Name} is not active.`);
  return w.Id as number;
}

/** Moves goods from one store to another at their average cost. */
export async function transfer(b: { FromWarehouseId?: unknown; ToWarehouseId?: unknown; Reason?: unknown; Lines?: unknown }, by: string) {
  const items = lines(b.Lines);
  const r = await transaction(async (tx) => {
    const from = await mustWarehouse(b.FromWarehouseId, tx, 'store to take the goods from');
    const to = await mustWarehouse(b.ToWarehouseId, tx, 'store to send the goods to');
    if (from === to) throw new UserError('Choose two different stores.');
    const d = await doc('Transfer', from, to, text(b.Reason, 300), by, tx);
    for (const l of items) {
      const out: Move = { itemId: l.itemId, warehouseId: from, type: 'TransferOut', qty: -l.qty, refType: 'StockDoc', refId: d.id, refNo: d.no, by, units: unitsOf(b.Lines, l.itemId),
        locationId: lineLoc(b, l.itemId, 'LocationId') };
      const cost = await post(out, tx);
      await post({ itemId: l.itemId, warehouseId: to, type: 'TransferIn', qty: l.qty, unitCost: cost, refType: 'StockDoc', refId: d.id, refNo: d.no, by, units: out.picked,
        locationId: lineLoc(b, l.itemId, 'ToLocationId') }, tx);
    }
    return d;
  });
  return { id: r.id, message: `Transfer ${r.no} saved.` };
}

/** Adds (+) or removes (-) stock with a reason: damage, expiry, found, opening balance ... */
export async function adjust(b: { WarehouseId?: unknown; Reason?: unknown; Lines?: unknown }, by: string) {
  if (!Array.isArray(b.Lines) || !b.Lines.length) throw new UserError('Add at least one item.');
  const reason = mustText(b.Reason, 300, 'reason of the adjustment');
  const seen = new Set<number>();
  const items = (b.Lines as any[]).map((l) => {
    const itemId = Number(l.ItemId), n = Number(l.Qty);
    if (!Number.isInteger(itemId) || itemId <= 0) throw new UserError('Choose the item of every line.');
    if (seen.has(itemId)) throw new UserError('An item is on two lines.');
    seen.add(itemId);
    if (!Number.isFinite(n) || n === 0) throw new UserError('Every line needs a quantity: + adds stock, - removes it.');
    return { itemId, qty: Math.round(n * 1000) / 1000, cost: l.UnitCost === undefined || l.UnitCost === '' ? undefined : qty(l.UnitCost, 'cost', false) };
  });
  const r = await transaction(async (tx) => {
    const w = await mustWarehouse(b.WarehouseId, tx);
    const d = await doc('Adjustment', w, null, reason, by, tx);
    for (const l of items) {
      let cost = l.cost;
      if (l.qty > 0 && cost === undefined) cost = await currentCost(l.itemId, w, tx);
      await post({ itemId: l.itemId, warehouseId: w, type: 'Adjustment', qty: l.qty, unitCost: cost, refType: 'StockDoc', refId: d.id, refNo: d.no, note: reason, by,
        units: l.qty < 0 ? unitsOf(b.Lines, l.itemId) : undefined, serials: l.qty > 0 ? serialsOf(b.Lines, l.itemId) : undefined, locationId: lineLoc(b, l.itemId, 'LocationId') }, tx);
    }
    return d;
  });
  await afterStockChange(items.filter((l) => l.qty < 0).map((l) => l.itemId));
  return { id: r.id, message: `Adjustment ${r.no} saved.` };
}

/**
 * Physical stock count: the counted quantities replace the book stock; the differences are posted as adjustments.
 * LocationId: the count of one location (rack position) — the books of that location are compared.
 */
export async function count(b: { WarehouseId?: unknown; LocationId?: unknown; Reason?: unknown; Lines?: unknown }, by: string) {
  if (!Array.isArray(b.Lines) || !b.Lines.length) throw new UserError('Enter the counted quantity of at least one item.');
  const counted = (b.Lines as any[]).map((l) => ({ itemId: Number(l.ItemId), counted: qty(l.Counted, 'counted quantity', false) }));
  if (counted.some((l) => !Number.isInteger(l.itemId) || l.itemId <= 0)) throw new UserError('Choose the item of every line.');
  const r = await transaction(async (tx) => {
    const w = await mustWarehouse(b.WarehouseId, tx);
    const loc = b.LocationId ? await mustLocation(b.LocationId, w, tx, false) : null;
    const d = await doc('Count', w, null, text(b.Reason, 300) ?? `Physical stock count${loc ? ' at ' + loc.Code : ''}`, by, tx);
    let changed = 0;
    for (const l of counted) {
      const book = loc ? Number((await one('SELECT Qty FROM InvLocStock WHERE ItemId = @i AND LocationId = @l', { i: l.itemId, l: loc.Id }, tx))?.Qty ?? 0) : await available(l.itemId, w, tx);
      const diff = Math.round((l.counted - book) * 1000) / 1000;
      if (!diff) continue;
      changed++;
      await post({ itemId: l.itemId, warehouseId: w, type: 'Adjustment', qty: diff, unitCost: diff > 0 ? await currentCost(l.itemId, w, tx) : undefined,
        refType: 'StockDoc', refId: d.id, refNo: d.no, note: `Stock count ${d.no}${loc ? ' at ' + loc.Code : ''}`, by, locationId: loc?.Id ?? null }, tx);
    }
    return { ...d, changed };
  });
  await afterStockChange(counted.map((l) => l.itemId));
  return { id: r.id, message: `Stock count ${r.no} saved: ${r.changed} item(s) corrected, ${counted.length - r.changed} matched the books.` };
}

/** Cost for stock found / added without a price: the store's average, else the item's purchase price. */
async function currentCost(itemId: number, warehouseId: number, tx: Tx) {
  const s = await one('SELECT AvgCost FROM InvStock WHERE ItemId = @i AND WarehouseId = @w AND AvgCost > 0', { i: itemId, w: warehouseId }, tx);
  if (s) return Number(s.AvgCost);
  return Number((await one('SELECT PurchasePrice FROM InvItems WHERE Id = @i', { i: itemId }, tx))?.PurchasePrice ?? 0);
}

/** Transfers / adjustments / counts with their lines (from the ledger). */
export async function stockDocs(kind: string) {
  const docs = await query(`SELECT d.Id, d.DocNo, d.Kind, d.WarehouseId, w.Name AS Warehouse, t.Name AS ToWarehouse, d.Reason, d.CreatedBy,
      to_char(d.CreatedAt, 'YYYY-MM-DD HH24:MI') AS CreatedAt
    FROM InvStockDocs d JOIN InvWarehouses w ON w.Id = d.WarehouseId LEFT JOIN InvWarehouses t ON t.Id = d.ToWarehouseId
    WHERE (@k = '' OR d.Kind = @k) ORDER BY d.CreatedAt DESC, d.Id DESC LIMIT 500`, { k: kind });
  const ids = docs.map((d) => d.Id as number);
  const moves = ids.length ? await query(`SELECT m.RefId, i.Code, i.Name, i.Unit, m.Type, m.Qty, m.UnitCost FROM InvMovements m JOIN InvItems i ON i.Id = m.ItemId
    WHERE m.RefType = 'StockDoc' AND m.RefId = ANY(@ids) AND m.Type <> 'TransferIn' AND NOT (m.Type = 'Move' AND m.Qty > 0) ORDER BY m.Id`, { ids }) : [];
  return docs.map((d) => ({
    ...d, ToWarehouse: d.ToWarehouse ?? '', Reason: d.Reason ?? '',
    Lines: moves.filter((m) => m.RefId === d.Id).map((m) => ({ Code: m.Code, Name: m.Name, Unit: m.Unit, Qty: d.Kind === 'Transfer' || d.Kind === 'Move' ? -Number(m.Qty) : Number(m.Qty), UnitCost: Number(m.UnitCost) })),
  }));
}

/** Location of a document line (Lines [{ ItemId, LocationId / ToLocationId }]), else the document's own; null = none given. */
export function lineLoc(b: any, itemId: number, key: 'LocationId' | 'ToLocationId'): number | null {
  const l = Array.isArray(b?.Lines) ? (b.Lines as any[]).find((x) => Number(x?.ItemId) === itemId) : null;
  return Number(l?.[key]) || Number(b?.[key]) || null;
}

/** Units chosen (scanned) on a document line of a serial item: Lines [{ ItemId, Units: [unit ids] }]; undefined = none chosen. */
export function unitsOf(v: unknown, itemId: number): number[] | undefined {
  const l = Array.isArray(v) ? (v as any[]).find((x) => Number(x?.ItemId) === itemId) : null;
  const u = Array.isArray(l?.Units) ? (l.Units as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  return u.length ? u : undefined;
}

/** New units' serial numbers / tags on a document line: Lines [{ ItemId, Serials: [{ SerialNo, Tag }] }]. */
export function serialsOf(v: unknown, itemId: number): NewUnit[] | undefined {
  const l = Array.isArray(v) ? (v as any[]).find((x) => Number(x?.ItemId) === itemId) : null;
  return Array.isArray(l?.Serials) ? (l.Serials as NewUnit[]) : undefined;
}

export const round2 = (v: number) => Math.round(v * 100) / 100;
export const round3 = (v: number) => Math.round(v * 1000) / 1000;
