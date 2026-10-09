/**
 * Serial / tagged units (InvUnits): items tracked one by one — boom barriers, turnstiles, tripods, laptops. Each unit has a
 * serial number and optionally an RFID / QR tag. stock.service post() calls unitsIn / unitsOut for every movement of a
 * serial item, so the units in a store always match its stock; the documents (issue, return, installed at site) then
 * say who holds a unit or where it is installed. InvUnitEvents keeps each unit's history.
 */
import { exec, one, query, type Tx } from '../../db';
import { UserError } from '../../utils/errors';
import { text } from './common.service';

export type UnitStatus = 'InStore' | 'Transit' | 'Issued' | 'Installed' | 'Damaged' | 'Lost' | 'Scrapped';
export interface NewUnit { SerialNo?: unknown; Tag?: unknown }

export interface UnitEvent {
  event: string; refNo?: string | null; warehouseId?: number | null; locationId?: number | null; employeeId?: number | null; employeeName?: string | null;
  siteName?: string | null; note?: string | null; by: string;
}

export async function logUnits(ids: number[], e: UnitEvent, tx: Tx) {
  if (!ids.length) return;
  await exec(`INSERT INTO InvUnitEvents (UnitId, Event, RefNo, WarehouseId, LocationId, EmployeeId, EmployeeName, SiteName, Note, CreatedBy)
    SELECT u, @ev, @rn, @w, @l, @e, @en, @sn, @n, @by FROM unnest(CAST(@ids AS int[])) u`, {
    ids, ev: e.event, rn: e.refNo ?? null, w: e.warehouseId ?? null, l: e.locationId ?? null, e: e.employeeId ?? null, en: e.employeeName ?? null,
    sn: e.siteName ?? null, n: e.note?.slice(0, 300) ?? null, by: e.by.slice(0, 100),
  }, tx);
}

export async function isSerial(itemId: number, tx?: Tx): Promise<boolean> {
  return (await one('SELECT TrackBy FROM InvItems WHERE Id = @i', { i: itemId }, tx))?.TrackBy === 'Serial';
}

/** A tag / serial is free: no other unit has it as tag. */
async function assertTagFree(tag: string, exceptId: number | null, tx: Tx) {
  const u = await one(`SELECT u.SerialNo, i.Code FROM InvUnits u JOIN InvItems i ON i.Id = u.ItemId WHERE lower(u.Tag) = lower(@t) AND u.Id <> @id`, { t: tag, id: exceptId ?? 0 }, tx);
  if (u) throw new UserError(`The tag ${tag} is on ${u.Code} ${u.SerialNo} already.`);
}

/** Next automatic serial numbers <item code>-0001 … (free of the item's existing serials). */
async function autoSerials(itemId: number, n: number, tx: Tx): Promise<string[]> {
  const code = (await one('SELECT Code FROM InvItems WHERE Id = @i', { i: itemId }, tx))!.Code as string;
  const out: string[] = [];
  while (out.length < n) {
    const r = await one(`INSERT INTO InvCounters (Key, Value) VALUES (@k, 1) ON CONFLICT (Key) DO UPDATE SET Value = InvCounters.Value + 1 RETURNING Value`,
      { k: `UNIT:${itemId}` }, tx);
    const s = `${code}-${String(r!.Value).padStart(4, '0')}`;
    if (!(await one('SELECT 1 FROM InvUnits WHERE ItemId = @i AND lower(SerialNo) = lower(@s)', { i: itemId, s }, tx))) out.push(s);
  }
  return out;
}

/**
 * Units coming into a store. Given units (a return, the second half of a transfer) are put back in the store; otherwise
 * `n` new units are made (serials / tags from `serials`, the rest numbered automatically).
 */
export async function unitsIn(o: { itemId: number; warehouseId: number; locationId: number; n: number; units?: number[]; serials?: NewUnit[]; cost: number; event: string; refNo?: string | null; note?: string | null; by: string }, tx: Tx): Promise<number[]> {
  if (o.units) {
    if (o.units.length !== o.n) throw new UserError(`Choose ${o.n} unit(s).`);
    await exec(`UPDATE InvUnits SET Status = 'InStore', WarehouseId = @w, LocationId = @l, IssueLineId = NULL, EmployeeId = NULL, SiteId = NULL, SiteName = NULL,
      UpdatedAt = LOCALTIMESTAMP WHERE Id = ANY(@ids)`, { w: o.warehouseId, l: o.locationId, ids: o.units }, tx);
    if (o.event) await logUnits(o.units, { event: o.event, refNo: o.refNo, warehouseId: o.warehouseId, locationId: o.locationId, note: o.note, by: o.by }, tx);
    return o.units;
  }
  const given = (o.serials ?? []).slice(0, o.n).map((s) => ({ serial: text(s.SerialNo, 60), tag: text(s.Tag, 100) }));
  const auto = await autoSerials(o.itemId, o.n - given.filter((g) => g.serial).length, tx);
  const ids: number[] = [];
  for (let k = 0; k < o.n; k++) {
    const g = given[k] ?? { serial: null, tag: null };
    const serial = g.serial ?? auto.shift()!;
    if (await one('SELECT 1 FROM InvUnits WHERE ItemId = @i AND lower(SerialNo) = lower(@s)', { i: o.itemId, s: serial }, tx))
      throw new UserError(`Serial number ${serial} exists already for this item.`);
    if (g.tag) await assertTagFree(g.tag, null, tx);
    ids.push((await one(`INSERT INTO InvUnits (ItemId, SerialNo, Tag, Status, WarehouseId, LocationId, Cost) VALUES (@i, @s, @t, 'InStore', @w, @l, @c) RETURNING Id`,
      { i: o.itemId, s: serial, t: g.tag, w: o.warehouseId, l: o.locationId, c: Math.round(o.cost * 10000) / 10000 }, tx))!.Id as number);
  }
  await logUnits(ids, { event: o.event || 'Received', refNo: o.refNo, warehouseId: o.warehouseId, locationId: o.locationId, note: o.note, by: o.by }, tx);
  return ids;
}

/**
 * Units leaving a store: the given ones (scanned) or the oldest in the store. They get `status` (Issued, Transit,
 * Scrapped); the caller links them to its document.
 */
export async function unitsOut(o: { itemId: number; warehouseId: number; locationId?: number | null; n: number; units?: number[]; status: UnitStatus; event: string; refNo?: string | null; note?: string | null; by: string }, tx: Tx): Promise<{ id: number; locationId: number | null }[]> {
  let ids: number[];
  if (o.units) {
    if (new Set(o.units).size !== o.units.length) throw new UserError('A unit is chosen twice.');
    if (o.units.length !== o.n) throw new UserError(`Choose ${o.n} unit(s): ${o.units.length} chosen.`);
    const rows = await query('SELECT Id, SerialNo, Status, WarehouseId, ItemId FROM InvUnits WHERE Id = ANY(@ids) FOR UPDATE', { ids: o.units }, tx);
    for (const id of o.units) {
      const u = rows.find((r) => r.Id === id);
      if (!u || u.ItemId !== o.itemId) throw new UserError('A unit does not belong to this item.');
      if (u.Status !== 'InStore' || u.WarehouseId !== o.warehouseId) throw new UserError(`Unit ${u.SerialNo} is not in this store (${u.Status}).`);
    }
    ids = o.units;
  } else {
    ids = (await query(`SELECT Id FROM InvUnits WHERE ItemId = @i AND WarehouseId = @w AND Status = 'InStore' AND (CAST(@l AS int) IS NULL OR LocationId = @l)
      ORDER BY Id LIMIT @n FOR UPDATE`, { i: o.itemId, w: o.warehouseId, l: o.locationId ?? null, n: o.n }, tx)).map((r) => r.Id as number);
    if (o.locationId && ids.length < o.n) throw new UserError(`Only ${ids.length} unit(s) at that location.`);
  }
  if (!ids.length) return [];
  const locs = await query('SELECT Id, LocationId FROM InvUnits WHERE Id = ANY(@ids)', { ids }, tx);
  await exec(`UPDATE InvUnits SET Status = @s, WarehouseId = CASE WHEN @keep THEN WarehouseId ELSE NULL END, LocationId = NULL, UpdatedAt = LOCALTIMESTAMP WHERE Id = ANY(@ids)`,
    { s: o.status, keep: o.status === 'Scrapped', ids }, tx);
  if (o.event) for (const l of locs) await logUnits([l.Id], { event: o.event, refNo: o.refNo, warehouseId: o.warehouseId, locationId: l.LocationId, note: o.note, by: o.by }, tx);
  return ids.map((id) => ({ id, locationId: locs.find((l) => l.Id === id)?.LocationId ?? null }));
}

/** Switching an item to serial: its stock in every store becomes units (numbered automatically, tags added later). */
export async function registerExistingStock(itemId: number, by: string, tx: Tx) {
  if (await one(`SELECT 1 FROM InvIssueLines l JOIN InvIssues s ON s.Id = l.IssueId JOIN InvItems i ON i.Id = l.ItemId
    WHERE l.ItemId = @i AND l.ReturnedQty + l.ConsumedQty < l.Qty AND (i.IsReturnable OR s.SiteId IS NOT NULL OR s.SiteName IS NOT NULL) LIMIT 1`, { i: itemId }, tx))
    throw new UserError('Some of this item is still out with employees / at sites. Get it back (Return / Installed) before tracking it by serial.');
  const stock = await query('SELECT WarehouseId, Qty, AvgCost FROM InvStock WHERE ItemId = @i AND Qty <> 0', { i: itemId }, tx);
  for (const s of stock) {
    const q = Number(s.Qty);
    if (!Number.isInteger(q) || q < 0) throw new UserError('Serial items are counted in whole units: correct the stock first (stock count).');
    const locs = await query(`SELECT s.LocationId, s.Qty FROM InvLocStock s JOIN InvLocations l ON l.Id = s.LocationId WHERE s.ItemId = @i AND l.WarehouseId = @w AND s.Qty > 0`,
      { i: itemId, w: s.WarehouseId }, tx);
    for (const l of locs) {
      if (!Number.isInteger(Number(l.Qty))) throw new UserError('Serial items are counted in whole units: correct the stock first (stock count).');
      await unitsIn({ itemId, warehouseId: s.WarehouseId, locationId: l.LocationId, n: Number(l.Qty), cost: Number(s.AvgCost), event: 'Registered', note: 'Item switched to serial tracking', by }, tx);
    }
  }
}

// ------------------------------------------------------------------ screens

const UNIT_SELECT = `SELECT u.Id, u.ItemId, i.Code, i.Name AS Item, u.SerialNo, COALESCE(u.Tag, '') AS Tag, u.Status, u.WarehouseId, w.Name AS Warehouse,
    u.EmployeeId, e.EnrollNo, e.Name AS Employee, COALESCE(ws.Name, u.SiteName, '') AS Site, u.IssueLineId, l.IssueId, s.IssueNo,
    u.Cost, COALESCE(u.Note, '') AS Note, to_char(u.CreatedAt, 'YYYY-MM-DD') AS CreatedAt, to_char(u.UpdatedAt, 'YYYY-MM-DD HH24:MI') AS UpdatedAt,
    u.LocationId, COALESCE(lc.Code, '') AS Location
  FROM InvUnits u JOIN InvItems i ON i.Id = u.ItemId LEFT JOIN InvWarehouses w ON w.Id = u.WarehouseId LEFT JOIN DirEmployees e ON e.Id = u.EmployeeId
    LEFT JOIN InvLocations lc ON lc.Id = u.LocationId
    LEFT JOIN DirSites ws ON ws.Id = u.SiteId LEFT JOIN InvIssueLines l ON l.Id = u.IssueLineId LEFT JOIN InvIssues s ON s.Id = l.IssueId`;

const fixUnit = (u: any) => ({ ...u, Cost: Number(u.Cost), Warehouse: u.Warehouse ?? '', Employee: u.Employee ?? '', EnrollNo: u.EnrollNo ?? '', IssueNo: u.IssueNo ?? '' });

export async function units(f: { itemId?: number | null; status?: string; warehouseId?: number | null; q?: string; untagged?: boolean }) {
  const rows = await query(`${UNIT_SELECT}
    WHERE (CAST(@i AS int) IS NULL OR u.ItemId = @i) AND (@s = '' OR u.Status = @s OR (@s = 'Out' AND u.Status = 'Issued'))
      AND (CAST(@w AS int) IS NULL OR u.WarehouseId = @w) AND (NOT @ut OR u.Tag IS NULL)
      AND (@q = '' OR u.SerialNo ILIKE '%' || @q || '%' OR u.Tag ILIKE '%' || @q || '%' OR i.Name ILIKE '%' || @q || '%' OR i.Code ILIKE '%' || @q || '%'
        OR e.Name ILIKE '%' || @q || '%' OR e.EnrollNo = @q OR COALESCE(ws.Name, u.SiteName, '') ILIKE '%' || @q || '%')
    ORDER BY i.Name, u.Id LIMIT 3000`, { i: f.itemId ?? null, s: f.status ?? '', w: f.warehouseId ?? null, ut: !!f.untagged, q: (f.q ?? '').trim() });
  return rows.map(fixUnit);
}

export async function unit(id: number) {
  const u = await one(`${UNIT_SELECT} WHERE u.Id = @id`, { id });
  if (!u) throw new UserError('Unit not found.', 404);
  const events = await query(`SELECT v.Id, to_char(v.At, 'YYYY-MM-DD HH24:MI') AS At, v.Event, COALESCE(v.RefNo, '') AS RefNo, COALESCE(w.Name, '') AS Warehouse,
      COALESCE(lc.Code, '') AS Location, COALESCE(e.Name, v.EmployeeName, '') AS Employee, e.EnrollNo, COALESCE(v.SiteName, '') AS Site, COALESCE(v.Note, '') AS Note,
      COALESCE(v.CreatedBy, '') AS CreatedBy
    FROM InvUnitEvents v LEFT JOIN InvWarehouses w ON w.Id = v.WarehouseId LEFT JOIN DirEmployees e ON e.Id = v.EmployeeId LEFT JOIN InvLocations lc ON lc.Id = v.LocationId
    WHERE v.UnitId = @id ORDER BY v.At DESC, v.Id DESC`, { id });
  return { ...fixUnit(u), Events: events.map((e) => ({ ...e, EnrollNo: e.EnrollNo ?? '' })) };
}

/** Serial number, tag and note of a unit (sticking an RFID / QR label on it). */
export async function saveUnit(id: number, b: { SerialNo?: unknown; Tag?: unknown; Note?: unknown }, by: string, tx: Tx) {
  const u = await one('SELECT Id, ItemId, SerialNo, Tag FROM InvUnits WHERE Id = @id FOR UPDATE', { id }, tx);
  if (!u) throw new UserError('Unit not found.', 404);
  const serial = b.SerialNo === undefined ? u.SerialNo : text(b.SerialNo, 60);
  if (!serial) throw new UserError('Enter the serial number.');
  const tag = b.Tag === undefined ? u.Tag : text(b.Tag, 100);
  if (await one('SELECT 1 FROM InvUnits WHERE ItemId = @i AND lower(SerialNo) = lower(@s) AND Id <> @id', { i: u.ItemId, s: serial, id }, tx))
    throw new UserError(`Serial number ${serial} exists already for this item.`);
  if (tag) await assertTagFree(tag, id, tx);
  await exec('UPDATE InvUnits SET SerialNo = @s, Tag = @t, Note = CASE WHEN @nn THEN Note ELSE @n END, UpdatedAt = LOCALTIMESTAMP WHERE Id = @id',
    { s: serial, t: tag, nn: b.Note === undefined, n: text(b.Note, 300), id }, tx);
  const changes = [serial !== u.SerialNo && `serial ${u.SerialNo} → ${serial}`, (tag ?? '') !== (u.Tag ?? '') && `tag ${u.Tag ?? '—'} → ${tag ?? '—'}`].filter(Boolean);
  if (changes.length) await logUnits([id], { event: tag !== u.Tag ? 'Tagged' : 'Edited', note: changes.join(', '), by }, tx);
}

/** Tagging labels one after the other: the scanned tag goes on the next untagged unit of the item (in the store first). */
export async function tagNext(b: { ItemId?: unknown; Tag?: unknown; WarehouseId?: unknown }, by: string, tx: Tx) {
  const tag = text(b.Tag, 100);
  if (!tag) throw new UserError('Scan the tag.');
  const u = await one(`SELECT Id FROM InvUnits WHERE ItemId = @i AND Tag IS NULL AND (CAST(@w AS int) IS NULL OR WarehouseId = @w)
    ORDER BY (Status = 'InStore') DESC, Id LIMIT 1 FOR UPDATE`, { i: Number(b.ItemId) || 0, w: Number(b.WarehouseId) || null }, tx);
  if (!u) throw new UserError('Every unit of this item has a tag already.');
  await saveUnit(u.Id, { Tag: tag }, by, tx);
  return u.Id as number;
}

/** Open units of issue lines (still with the employee / at the site, not yet installed or back). */
export async function openUnitsOf(lineIds: number[], tx?: Tx) {
  if (!lineIds.length) return [];
  return query(`SELECT x.IssueLineId, u.Id, u.SerialNo, COALESCE(u.Tag, '') AS Tag, x.Status FROM InvIssueUnits x JOIN InvUnits u ON u.Id = x.UnitId
    WHERE x.IssueLineId = ANY(@ids) ORDER BY u.Id`, { ids: lineIds }, tx);
}

/**
 * Closes units of an issue line (Returned / Installed / Damaged / Lost): the chosen ones or the oldest open ones.
 * Returned units are put back in the store by post() (unitsIn); this only marks the line's units.
 */
export async function closeLineUnits(lineId: number, n: number, chosen: number[] | undefined, how: 'Returned' | 'Installed' | 'Damaged' | 'Lost', tx: Tx) {
  if (!Number.isInteger(n)) throw new UserError('Serial items are counted in whole units.');
  const open = (await query(`SELECT UnitId FROM InvIssueUnits WHERE IssueLineId = @l AND Status = 'Out' ORDER BY UnitId FOR UPDATE`, { l: lineId }, tx)).map((r) => r.UnitId as number);
  let ids: number[];
  if (chosen?.length) {
    if (chosen.length !== n) throw new UserError(`Choose ${n} unit(s): ${chosen.length} chosen.`);
    for (const c of chosen) if (!open.includes(c)) throw new UserError('A chosen unit is not out on this issue.');
    ids = chosen;
  } else ids = open.slice(0, n);
  if (ids.length < n) throw new UserError(`Only ${open.length} unit(s) are still out on this line.`);
  await exec(`UPDATE InvIssueUnits SET Status = @s, ClosedAt = LOCALTIMESTAMP WHERE IssueLineId = @l AND UnitId = ANY(@ids)`, { s: how, l: lineId, ids }, tx);
  return ids;
}
