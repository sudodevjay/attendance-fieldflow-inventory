/**
 * Locations inside a store: rack / row / column (R03-2-4), each with a QR label (LOC-<Id>) and optionally an RFID tag.
 * Stock is always on a location (InvLocStock adds up to InvStock of the store; units in a store have their LocationId).
 * Goods booked in without a location go to the store's RECEIVING location and are put away with move(); goods taken
 * out without a location come from the locations that have them (RECEIVING first, then the fullest).
 */
import { exec, one, query, transaction, type Tx } from '../../db';
import { UserError } from '../../utils/errors';
import { getSetting, nextNo, qty, qtyText, text } from './common.service';
import { logUnits } from './unit.service';

export interface Alloc { locationId: number; qty: number }

/** The store's RECEIVING location (made when missing). */
export async function receiving(warehouseId: number, tx: Tx): Promise<number> {
  const r = await one('SELECT Id FROM InvLocations WHERE WarehouseId = @w AND IsSystem', { w: warehouseId }, tx);
  if (r) return r.Id;
  return (await one(`INSERT INTO InvLocations (WarehouseId, Code, Rack, IsSystem) VALUES (@w, 'RECEIVING', 'RECEIVING', TRUE)
    ON CONFLICT DO NOTHING RETURNING Id`, { w: warehouseId }, tx))?.Id ?? (await one('SELECT Id FROM InvLocations WHERE WarehouseId = @w AND IsSystem', { w: warehouseId }, tx))!.Id;
}

/** A location of this store, active (for goods coming in) or any (going out). */
export async function mustLocation(id: unknown, warehouseId: number, tx: Tx, active = true) {
  const l = await one('SELECT l.Id, l.Code, l.WarehouseId, l.IsActive, w.Name AS Warehouse FROM InvLocations l JOIN InvWarehouses w ON w.Id = l.WarehouseId WHERE l.Id = @id',
    { id: Number(id) || 0 }, tx);
  if (!l) throw new UserError('Choose the location (rack / row / column).');
  if (l.WarehouseId !== warehouseId) throw new UserError(`Location ${l.Code} is in ${l.Warehouse}, not in this store.`);
  if (active && !l.IsActive) throw new UserError(`Location ${l.Code} is switched off.`);
  return l as { Id: number; Code: string };
}

export async function addLocStock(itemId: number, locationId: number, delta: number, tx: Tx) {
  await exec(`INSERT INTO InvLocStock (ItemId, LocationId, Qty) VALUES (@i, @l, @q)
    ON CONFLICT (ItemId, LocationId) DO UPDATE SET Qty = ROUND(InvLocStock.Qty + EXCLUDED.Qty, 3)`, { i: itemId, l: locationId, q: delta }, tx);
}

/**
 * Where `n` of an item leave a store from: the given location (enough there, unless negative stock is allowed) or the
 * locations that have it, RECEIVING first and then the fullest.
 */
export async function allocateOut(itemId: number, warehouseId: number, n: number, locationId: number | null, tx: Tx): Promise<Alloc[]> {
  const negative = (await getSetting('AllowNegative')) === '1';
  if (locationId) {
    const l = await mustLocation(locationId, warehouseId, tx, false);
    const have = Number((await one('SELECT Qty FROM InvLocStock WHERE ItemId = @i AND LocationId = @l FOR UPDATE', { i: itemId, l: l.Id }, tx))?.Qty ?? 0);
    if (have + 1e-9 < n && !negative) {
      const it = await one('SELECT Code, Name, Unit FROM InvItems WHERE Id = @i', { i: itemId }, tx);
      throw new UserError(`Only ${qtyText(have)} ${it?.Unit} of ${it?.Code} ${it?.Name} at ${l.Code}, ${qtyText(n)} needed.`);
    }
    return [{ locationId: l.Id, qty: n }];
  }
  const rows = await query(`SELECT s.LocationId, s.Qty FROM InvLocStock s JOIN InvLocations l ON l.Id = s.LocationId
    WHERE s.ItemId = @i AND l.WarehouseId = @w AND s.Qty > 0 ORDER BY l.IsSystem DESC, s.Qty DESC, l.Code FOR UPDATE OF s`, { i: itemId, w: warehouseId }, tx);
  const out: Alloc[] = [];
  let left = n;
  for (const r of rows) {
    if (left <= 1e-9) break;
    const take = Math.min(left, Number(r.Qty));
    out.push({ locationId: r.LocationId, qty: take });
    left = Math.round((left - take) * 1000) / 1000;
  }
  if (left > 1e-9) out.push({ locationId: await receiving(warehouseId, tx), qty: left }); // negative stock allowed (post() checked the store)
  return out;
}

// ------------------------------------------------------------------ screens

/** Locations of a store (or all) with what is on them. */
export async function locations(f: { warehouseId?: number | null; q?: string } = {}) {
  const rows = await query(`SELECT l.Id, l.WarehouseId, w.Name AS Warehouse, l.Code, l.Rack, l.RowNo, l.ColNo, COALESCE(l.Tag, '') AS Tag, l.IsSystem, l.IsActive,
      COALESCE(l.Note, '') AS Note,
      (SELECT COUNT(*) FROM InvLocStock s WHERE s.LocationId = l.Id AND s.Qty <> 0) AS Items,
      (SELECT COALESCE(SUM(s.Qty), 0) FROM InvLocStock s WHERE s.LocationId = l.Id) AS Qty
    FROM InvLocations l JOIN InvWarehouses w ON w.Id = l.WarehouseId
    WHERE (CAST(@w AS int) IS NULL OR l.WarehouseId = @w) AND (@q = '' OR l.Code ILIKE '%' || @q || '%' OR l.Tag ILIKE @q)
    ORDER BY w.Name, l.IsSystem DESC, l.Rack, length(l.RowNo), l.RowNo, length(l.ColNo), l.ColNo`, { w: f.warehouseId ?? null, q: (f.q ?? '').trim() });
  return rows.map((r) => ({ ...r, IsSystem: !!r.IsSystem, IsActive: !!r.IsActive, Items: Number(r.Items), Qty: Number(r.Qty) }));
}

/** Makes the positions of a rack: rows 1…Rows × columns 1…Cols → <Rack>-<row>-<col>; existing ones are kept. */
export async function createRack(b: { WarehouseId?: unknown; Rack?: unknown; Rows?: unknown; Cols?: unknown }) {
  const rack = text(b.Rack, 20)?.toUpperCase();
  if (!rack || !/^[A-Z0-9][A-Z0-9_.]*$/.test(rack)) throw new UserError('Rack name: letters / digits, e.g. R03 or A.');
  if (rack === 'RECEIVING') throw new UserError('RECEIVING is the inward counter of every store.');
  const rowsN = Math.round(Number(b.Rows) || 0), colsN = Math.round(Number(b.Cols) || 0);
  if (rowsN < 1 || colsN < 1 || rowsN > 50 || colsN > 50) throw new UserError('Rows and columns: 1 to 50.');
  return transaction(async (tx) => {
    const w = await one('SELECT Id FROM InvWarehouses WHERE Id = @id AND IsActive', { id: Number(b.WarehouseId) || 0 }, tx);
    if (!w) throw new UserError('Choose an active store.');
    await receiving(w.Id, tx);
    let made = 0;
    for (let r = 1; r <= rowsN; r++) for (let c = 1; c <= colsN; c++) {
      made += await exec(`INSERT INTO InvLocations (WarehouseId, Code, Rack, RowNo, ColNo) VALUES (@w, @code, @rk, @r, @c) ON CONFLICT DO NOTHING`,
        { w: w.Id, code: `${rack}-${r}-${c}`, rk: rack, r: String(r), c: String(c) }, tx);
    }
    return `Rack ${rack}: ${made} new location(s) (${rowsN} row(s) × ${colsN} column(s)).`;
  });
}

export async function saveLocation(id: number, b: { Tag?: unknown; Note?: unknown; IsActive?: unknown }) {
  return transaction(async (tx) => {
    const l = await one('SELECT Id, IsSystem FROM InvLocations WHERE Id = @id FOR UPDATE', { id }, tx);
    if (!l) throw new UserError('Location not found.', 404);
    const tag = text(b.Tag, 100);
    if (tag) {
      if (/^LOC-\d+$/i.test(tag)) throw new UserError('LOC-… is the QR label of a location; scan the RFID tag.');
      const u = await one(`SELECT 'unit' AS Kind FROM InvUnits WHERE lower(Tag) = lower(@t) UNION ALL SELECT 'location' FROM InvLocations WHERE lower(Tag) = lower(@t) AND Id <> @id LIMIT 1`, { t: tag, id }, tx);
      if (u) throw new UserError(`The tag ${tag} is on a ${u.Kind} already.`);
    }
    const active = b.IsActive === undefined ? true : b.IsActive !== false;
    if (!active) {
      if (l.IsSystem) throw new UserError('RECEIVING cannot be switched off.');
      if (await one('SELECT 1 FROM InvLocStock WHERE LocationId = @id AND Qty <> 0 LIMIT 1', { id }, tx)) throw new UserError('Move the goods away first: the location is not empty.');
    }
    await exec('UPDATE InvLocations SET Tag = @t, Note = @n, IsActive = @a WHERE Id = @id', { t: tag, n: text(b.Note, 200), a: active, id }, tx);
  });
}

export async function removeLocation(id: number) {
  const l = await one('SELECT IsSystem FROM InvLocations WHERE Id = @id', { id });
  if (!l) throw new UserError('Location not found.', 404);
  if (l.IsSystem) throw new UserError('RECEIVING cannot be deleted.');
  if (await one('SELECT 1 FROM InvLocStock WHERE LocationId = @id AND Qty <> 0 LIMIT 1', { id }) || await one('SELECT 1 FROM InvMovements WHERE LocationId = @id LIMIT 1', { id }))
    throw new UserError('This location has (had) stock: switch it off instead of deleting it.');
  await exec('DELETE FROM InvLocStock WHERE LocationId = @id; DELETE FROM InvLocations WHERE Id = @id', { id });
}

/** What is on a location: quantities per item and the serial units. */
export async function location(id: number) {
  const l = (await query(`SELECT l.Id, l.WarehouseId, w.Name AS Warehouse, l.Code, COALESCE(l.Tag, '') AS Tag, l.IsSystem, l.IsActive, COALESCE(l.Note, '') AS Note
    FROM InvLocations l JOIN InvWarehouses w ON w.Id = l.WarehouseId WHERE l.Id = @id`, { id }))[0];
  if (!l) throw new UserError('Location not found.', 404);
  const items = await query(`SELECT i.Id AS ItemId, i.Code, i.Name, i.Unit, i.TrackBy, s.Qty, COALESCE(st.AvgCost, 0) AS AvgCost
    FROM InvLocStock s JOIN InvItems i ON i.Id = s.ItemId LEFT JOIN InvStock st ON st.ItemId = s.ItemId AND st.WarehouseId = @w
    WHERE s.LocationId = @id AND s.Qty <> 0 ORDER BY i.Name`, { id, w: l.WarehouseId });
  const units = await query(`SELECT u.Id, u.ItemId, u.SerialNo, COALESCE(u.Tag, '') AS Tag FROM InvUnits u WHERE u.LocationId = @id AND u.Status = 'InStore' ORDER BY u.ItemId, u.Id`, { id });
  return {
    ...l, IsSystem: !!l.IsSystem, IsActive: !!l.IsActive, Label: `LOC-${l.Id}`,
    Items: items.map((i) => ({ ...i, Qty: Number(i.Qty), Value: Math.round(Number(i.Qty) * Number(i.AvgCost) * 100) / 100, Units: units.filter((u) => u.ItemId === i.ItemId) })),
  };
}

/** Where an item lies: every location with its quantity (and units). */
export async function whereIs(itemId: number) {
  const rows = await query(`SELECT l.Id AS LocationId, l.Code, w.Id AS WarehouseId, w.Name AS Warehouse, l.IsSystem, s.Qty
    FROM InvLocStock s JOIN InvLocations l ON l.Id = s.LocationId JOIN InvWarehouses w ON w.Id = l.WarehouseId
    WHERE s.ItemId = @i AND s.Qty <> 0 ORDER BY w.Name, l.IsSystem DESC, l.Code`, { i: itemId });
  const units = await query(`SELECT Id, SerialNo, COALESCE(Tag, '') AS Tag, LocationId FROM InvUnits WHERE ItemId = @i AND Status = 'InStore' ORDER BY Id`, { i: itemId });
  return rows.map((r) => ({ ...r, IsSystem: !!r.IsSystem, Qty: Number(r.Qty), Units: units.filter((u) => u.LocationId === r.LocationId) }));
}

/** Stock on RECEIVING still to be put away (per store). */
export async function toPutAway() {
  return query(`SELECT w.Id AS WarehouseId, w.Name AS Warehouse, l.Id AS LocationId, COUNT(*) AS Items, SUM(s.Qty) AS Qty
    FROM InvLocStock s JOIN InvLocations l ON l.Id = s.LocationId AND l.IsSystem JOIN InvWarehouses w ON w.Id = l.WarehouseId
    WHERE s.Qty > 0 GROUP BY w.Id, w.Name, l.Id ORDER BY w.Name`).then((r) => r.map((x) => ({ ...x, Items: Number(x.Items), Qty: Number(x.Qty) })));
}

/**
 * Put-away / move inside a store: Lines [{ ItemId, Qty } | { Units: [unit ids] }] from FromLocationId (default:
 * RECEIVING; units: wherever they are) to ToLocationId. The store's stock does not change; the ledger gets a Move pair.
 */
export async function move(b: { FromLocationId?: unknown; ToLocationId?: unknown; Lines?: unknown; Note?: unknown }, by: string) {
  if (!Array.isArray(b.Lines) || !b.Lines.length) throw new UserError('Scan / add at least one item.');
  return transaction(async (tx) => {
    const to = await one('SELECT Id, Code, WarehouseId, IsActive FROM InvLocations WHERE Id = @id', { id: Number(b.ToLocationId) || 0 }, tx);
    if (!to) throw new UserError('Choose / scan the location the goods go to.');
    if (!to.IsActive) throw new UserError(`Location ${to.Code} is switched off.`);
    const w = to.WarehouseId as number;
    const fromId = b.FromLocationId ? (await mustLocation(b.FromLocationId, w, tx, false)).Id : await receiving(w, tx);
    const no = await nextNo('MOV', tx);
    const docId = (await one(`INSERT INTO InvStockDocs (DocNo, Kind, WarehouseId, Reason, CreatedBy) VALUES (@no, 'Move', @w, @r, @by) RETURNING Id`,
      { no, w, r: text(b.Note, 300) ?? `To ${to.Code}`, by }, tx))!.Id as number;
    let n = 0;
    for (const l of b.Lines as any[]) {
      const unitIds: number[] = Array.isArray(l.Units) ? (l.Units as unknown[]).map(Number).filter((x) => x > 0) : [];
      let parts: { itemId: number; from: number; qty: number; units?: number[] }[];
      if (unitIds.length) {
        const us = await query(`SELECT u.Id, u.ItemId, u.SerialNo, u.Status, u.LocationId, u.WarehouseId FROM InvUnits u WHERE u.Id = ANY(@ids) FOR UPDATE`, { ids: unitIds }, tx);
        if (us.length !== unitIds.length) throw new UserError('A unit does not exist.');
        for (const u of us) if (u.Status !== 'InStore' || u.WarehouseId !== w) throw new UserError(`Unit ${u.SerialNo} is not in this store (${u.Status}).`);
        const groups = new Map<string, { itemId: number; from: number; units: number[] }>();
        for (const u of us) {
          if (u.LocationId === to.Id) continue;
          const k = `${u.ItemId}:${u.LocationId}`;
          const g = groups.get(k) ?? { itemId: u.ItemId, from: u.LocationId ?? fromId, units: [] as number[] };
          g.units.push(u.Id);
          groups.set(k, g);
        }
        parts = [...groups.values()].map((g) => ({ ...g, qty: g.units.length }));
      } else {
        const itemId = Number(l.ItemId) || 0;
        const it = await one('SELECT TrackBy FROM InvItems WHERE Id = @i', { i: itemId }, tx);
        if (!it) throw new UserError('Choose the item of every line.');
        const q = qty(l.Qty);
        if (it.TrackBy === 'Serial') {
          if (!Number.isInteger(q)) throw new UserError('Serial items are counted in whole units.');
          const pick = (await query(`SELECT Id FROM InvUnits WHERE ItemId = @i AND LocationId = @f AND Status = 'InStore' ORDER BY Id LIMIT @n FOR UPDATE`,
            { i: itemId, f: fromId, n: q }, tx)).map((r) => r.Id as number);
          if (pick.length < q) throw new UserError(`Only ${pick.length} unit(s) there: scan the units' tags.`);
          parts = [{ itemId, from: fromId, qty: q, units: pick }];
        } else parts = [{ itemId, from: l.FromLocationId ? (await mustLocation(l.FromLocationId, w, tx, false)).Id : fromId, qty: q }];
      }
      for (const p of parts) {
        if (p.from === to.Id) continue;
        const have = Number((await one('SELECT Qty FROM InvLocStock WHERE ItemId = @i AND LocationId = @l FOR UPDATE', { i: p.itemId, l: p.from }, tx))?.Qty ?? 0);
        if (have + 1e-9 < p.qty) {
          const f = await one(`SELECT l.Code, i.Code AS ICode, i.Name, i.Unit FROM InvLocations l, InvItems i WHERE l.Id = @l AND i.Id = @i`, { l: p.from, i: p.itemId }, tx);
          throw new UserError(`Only ${qtyText(have)} ${f?.Unit} of ${f?.ICode} ${f?.Name} at ${f?.Code}.`);
        }
        await addLocStock(p.itemId, p.from, -p.qty, tx);
        await addLocStock(p.itemId, to.Id, p.qty, tx);
        const bal = Number((await one('SELECT Qty, AvgCost FROM InvStock WHERE ItemId = @i AND WarehouseId = @w', { i: p.itemId, w }, tx))?.Qty ?? 0);
        const cost = Number((await one('SELECT AvgCost FROM InvStock WHERE ItemId = @i AND WarehouseId = @w', { i: p.itemId, w }, tx))?.AvgCost ?? 0);
        for (const [loc, q] of [[p.from, -p.qty], [to.Id, p.qty]] as const)
          await exec(`INSERT INTO InvMovements (ItemId, WarehouseId, LocationId, Type, Qty, UnitCost, BalanceAfter, RefType, RefId, RefNo, Note, CreatedBy)
            VALUES (@i, @w, @l, 'Move', @q, @c, @b, 'StockDoc', @r, @rn, @n, @by)`, { i: p.itemId, w, l: loc, q, c: cost, b: bal, r: docId, rn: no, n: `To ${to.Code}`, by }, tx);
        if (p.units?.length) {
          await exec('UPDATE InvUnits SET LocationId = @l, UpdatedAt = LOCALTIMESTAMP WHERE Id = ANY(@ids)', { l: to.Id, ids: p.units }, tx);
          await logUnits(p.units, { event: 'Moved', refNo: no, warehouseId: w, locationId: to.Id, note: `To ${to.Code}`, by }, tx);
        }
        n++;
      }
    }
    if (!n) throw new UserError(`Everything is at ${to.Code} already.`);
    return { id: docId, message: `${no}: ${n} line(s) moved to ${to.Code}.` };
  });
}
