/**
 * Employee bins: every employee has a bin (code BIN-<AC No>) with everything the store gave them that is still open —
 * returnable items, serial units and material for a site that is neither installed nor given back. Consumables issued
 * without a site are used up and do not stay in the bin.
 *
 * Bin limit: the most open entries one bin may hold (InvBins.MaxItems, else the BinLimit setting; 0 = no limit). An entry
 * is one serial unit, or one issue line of a quantity item (10 pens on one line = 1 entry). An issue that would go over
 * the limit is refused until the employee clears the bin (return / installed at site) or the limit is raised.
 *
 * Scanning: resolve() tells what a scanned code is — a unit's RFID / QR tag or serial, an item's barcode or code, a bin
 * (BIN-<AC No>), an employee's AC No or card number.
 */
import { exec, one, query, type Tx } from '../../db';
import { UserError } from '../../utils/errors';
import { scopeDepartments } from '../../utils/scope';
import { mustParse, sqlD, today } from '../../utils/time';
import { getSetting, qty, text } from './common.service';
import { round2 } from './stock.service';

/** Open lines of a bin: the employee still has them, or they are at a site and not installed. */
const OPEN = `l.ReturnedQty + l.ConsumedQty < l.Qty AND (i.IsReturnable OR i.TrackBy = 'Serial' OR s.SiteId IS NOT NULL OR s.SiteName IS NOT NULL)`;
const ENTRIES = `CASE WHEN i.TrackBy = 'Serial' THEN l.Qty - l.ReturnedQty - l.ConsumedQty ELSE 1 END`;

export const binCode = (enrollNo: string) => `BIN-${enrollNo}`;

/** The bin limit of an employee: own limit, else the setting; 0 = no limit. */
export async function binLimit(employeeId: number, tx?: Tx): Promise<{ limit: number; own: boolean }> {
  const b = await one('SELECT MaxItems FROM InvBins WHERE EmployeeId = @e', { e: employeeId }, tx);
  if (b && b.MaxItems !== null) return { limit: Number(b.MaxItems), own: true };
  return { limit: Number(await getSetting('BinLimit')) || 0, own: false };
}

export async function openEntries(employeeId: number, tx?: Tx): Promise<number> {
  const r = await one(`SELECT COALESCE(SUM(${ENTRIES}), 0) AS Cnt FROM InvIssueLines l JOIN InvIssues s ON s.Id = l.IssueId JOIN InvItems i ON i.Id = l.ItemId
    WHERE s.EmployeeId = @e AND ${OPEN}`, { e: employeeId }, tx);
  return Number(r?.Cnt ?? 0);
}

/** Entries a new issue adds to the bin: serial units each, returnable / site lines one each, consumables none. */
export async function entriesOf(lines: { itemId: number; qty: number }[], forSite: boolean, tx?: Tx): Promise<number> {
  if (!lines.length) return 0;
  const items = new Map((await query('SELECT Id, TrackBy, IsReturnable FROM InvItems WHERE Id = ANY(@ids)', { ids: lines.map((l) => l.itemId) }, tx)).map((i) => [i.Id as number, i]));
  return lines.reduce((a, l) => {
    const i = items.get(l.itemId);
    if (!i) return a;
    return a + (i.TrackBy === 'Serial' ? l.qty : i.IsReturnable || forSite ? 1 : 0);
  }, 0);
}

/** Refuses an issue / request that does not fit in the bin. adding = 0: the bin must not be full already. */
export async function assertBinRoom(employeeId: number, name: string, adding: number, tx?: Tx) {
  const { limit } = await binLimit(employeeId, tx);
  if (!limit) return;
  const open = await openEntries(employeeId, tx);
  if (adding === 0 ? open >= limit : open + adding > limit)
    throw new UserError(`Bin of ${name} is full: ${open} of ${limit} item(s) are still open${adding ? `, this adds ${adding}` : ''}. ` +
      'Clear the bin first (give items back / mark them installed at the site) or raise the bin limit.');
}

// ------------------------------------------------------------------ screens

/** All bins: open entries, limit, overdue, value — the fullest first. q = AC No / name / card. */
export async function bins(f: { q?: string; openOnly?: boolean } = {}) {
  const sc = scopeDepartments();
  const t = today();
  const emps = await query(`SELECT e.Id, e.EnrollNo, e.Name, e.IsActive, e.DepartmentId, COALESCE(d.Name, '') AS Department, b.MaxItems
    FROM DirEmployees e LEFT JOIN DirDepartments d ON d.Id = e.DepartmentId LEFT JOIN InvBins b ON b.EmployeeId = e.Id
    WHERE (@q = '' OR e.EnrollNo = @q OR e.Name ILIKE '%' || @q || '%' OR e.CardNo = @q OR upper(@q) = 'BIN-' || upper(e.EnrollNo))
      AND (CAST(@ds AS int[]) IS NULL OR e.DepartmentId = ANY(@ds))`, { q: (f.q ?? '').trim(), ds: sc ? [...sc] : null });
  const open = await query(`SELECT s.EmployeeId, SUM(${ENTRIES}) AS Cnt, SUM((l.Qty - l.ReturnedQty - l.ConsumedQty) * l.UnitCost) AS Value,
      COUNT(*) FILTER (WHERE l.DueDate < CAST(@t AS date)) AS Overdue, COUNT(*) FILTER (WHERE s.SiteId IS NOT NULL OR s.SiteName IS NOT NULL) AS AtSite
    FROM InvIssueLines l JOIN InvIssues s ON s.Id = l.IssueId JOIN InvItems i ON i.Id = l.ItemId
    WHERE s.EmployeeId IS NOT NULL AND ${OPEN} GROUP BY s.EmployeeId`, { t: sqlD(t) });
  const byEmp = new Map(open.map((o) => [o.EmployeeId as number, o]));
  const global = Number(await getSetting('BinLimit')) || 0;
  const rows = emps.map((e) => {
    const o = byEmp.get(e.Id);
    const limit = e.MaxItems !== null && e.MaxItems !== undefined ? Number(e.MaxItems) : global;
    const n = Number(o?.Cnt ?? 0);
    return {
      EmployeeId: e.Id, Bin: binCode(e.EnrollNo), EnrollNo: e.EnrollNo, Name: e.Name, Active: !!e.IsActive, Department: e.Department,
      Open: n, Limit: limit, OwnLimit: e.MaxItems !== null && e.MaxItems !== undefined, Full: limit > 0 && n >= limit,
      Value: round2(Number(o?.Value ?? 0)), Overdue: Number(o?.Overdue ?? 0), AtSite: Number(o?.AtSite ?? 0),
    };
  }).filter((r) => (f.openOnly ? r.Open > 0 : r.Active || r.Open > 0));
  return rows.sort((a, b) => b.Open - a.Open || a.Name.localeCompare(b.Name));
}

/**
 * One bin: the employee, limit, totals (taken / installed / returned / still open) and every issue line with its units.
 * costs = false for the employee portal.
 */
export async function bin(employeeId: number, costs = true) {
  const e = await one(`SELECT e.Id, e.EnrollNo, e.Name, e.IsActive, e.DepartmentId, COALESCE(d.Name, '') AS Department, e.CardNo
    FROM DirEmployees e LEFT JOIN DirDepartments d ON d.Id = e.DepartmentId WHERE e.Id = @id`, { id: employeeId });
  if (!e) throw new UserError('Employee not found.', 404);
  const sc = scopeDepartments();
  if (sc && (e.DepartmentId === null || !sc.has(e.DepartmentId))) throw new UserError('This employee is not in your department.', 403);
  const t = today();
  const lines = await query(`SELECT l.Id AS LineId, s.Id AS IssueId, s.IssueNo, to_char(s.IssuedOn, 'YYYY-MM-DD') AS IssuedOn, COALESCE(ws.Name, s.SiteName, '') AS Site,
      i.Id AS ItemId, i.Code, i.Name AS Item, i.Unit, i.TrackBy, i.IsReturnable, l.Qty, l.ReturnedQty, l.ConsumedQty, l.UnitCost,
      to_char(l.DueDate, 'YYYY-MM-DD') AS DueDate, (${OPEN}) AS IsOpen
    FROM InvIssueLines l JOIN InvIssues s ON s.Id = l.IssueId JOIN InvItems i ON i.Id = l.ItemId LEFT JOIN DirSites ws ON ws.Id = s.SiteId
    WHERE s.EmployeeId = @e ORDER BY s.IssuedOn DESC, l.Id`, { e: employeeId });
  const units = lines.length ? await query(`SELECT x.IssueLineId, u.Id, u.SerialNo, COALESCE(u.Tag, '') AS Tag, x.Status FROM InvIssueUnits x JOIN InvUnits u ON u.Id = x.UnitId
    WHERE x.IssueLineId = ANY(@ids) ORDER BY u.Id`, { ids: lines.map((l) => l.LineId) }) : [];
  const out = lines.map((l) => {
    const q = Number(l.Qty), ret = Number(l.ReturnedQty), used = Number(l.ConsumedQty);
    const open = l.IsOpen ? Math.max(0, q - ret - used) : 0;
    const overdue = open > 0 && !!l.DueDate && mustParse(l.DueDate) < t;
    return {
      LineId: l.LineId, IssueId: l.IssueId, IssueNo: l.IssueNo, IssuedOn: l.IssuedOn, Site: l.Site, ItemId: l.ItemId, Code: l.Code, Item: l.Item, Unit: l.Unit,
      Kind: l.TrackBy === 'Serial' ? 'Serial' : l.IsReturnable ? 'Returnable' : 'Consumable',
      Qty: q, Returned: ret, Installed: used, Open: open, DueDate: l.DueDate ?? '', Overdue: overdue,
      Status: open > 0 ? (l.Site ? 'At site' : 'Holds') : l.Site || l.IsReturnable || l.TrackBy === 'Serial' ? 'Cleared' : 'Used',
      ...(costs ? { UnitCost: Number(l.UnitCost), OpenValue: round2(open * Number(l.UnitCost)) } : {}),
      Units: units.filter((u) => u.IssueLineId === l.LineId).map((u) => ({ Id: u.Id, SerialNo: u.SerialNo, Tag: u.Tag, Status: u.Status })),
    };
  });
  const { limit, own } = await binLimit(employeeId);
  const openN = await openEntries(employeeId);
  const note = (await one('SELECT Note FROM InvBins WHERE EmployeeId = @e', { e: employeeId }))?.Note ?? '';
  return {
    EmployeeId: e.Id, Bin: binCode(e.EnrollNo), EnrollNo: e.EnrollNo, Name: e.Name, Active: !!e.IsActive, Department: e.Department,
    Limit: limit, OwnLimit: own, Open: openN, Full: limit > 0 && openN >= limit, Note: note,
    Totals: {
      Lines: out.length, Taken: out.reduce((a, l) => a + l.Qty, 0), Installed: out.reduce((a, l) => a + l.Installed, 0),
      Returned: out.reduce((a, l) => a + l.Returned, 0), OpenLines: out.filter((l) => l.Open > 0).length, Overdue: out.filter((l) => l.Overdue).length,
      ...(costs ? { OpenValue: round2(out.reduce((a, l) => a + (l.OpenValue ?? 0), 0)) } : {}),
    },
    Lines: out,
  };
}

/** Own bin limit (null = the setting, 0 = no limit) and note of an employee's bin. */
export async function saveBin(employeeId: number, b: { MaxItems?: unknown; Note?: unknown }, by: string) {
  if (!(await one('SELECT 1 FROM DirEmployees WHERE Id = @e', { e: employeeId }))) throw new UserError('Employee not found.', 404);
  const max = b.MaxItems === null || b.MaxItems === '' || b.MaxItems === undefined ? null : Math.round(qty(b.MaxItems, 'bin limit', false));
  await exec(`INSERT INTO InvBins (EmployeeId, MaxItems, Note, UpdatedBy) VALUES (@e, @m, @n, @by)
    ON CONFLICT (EmployeeId) DO UPDATE SET MaxItems = EXCLUDED.MaxItems, Note = EXCLUDED.Note, UpdatedBy = EXCLUDED.UpdatedBy, UpdatedAt = LOCALTIMESTAMP`,
  { e: employeeId, m: max, n: text(b.Note, 300), by });
}

// ------------------------------------------------------------------ scanning

export type Scan =
  | { kind: 'unit'; unit: any }
  | { kind: 'item'; item: any }
  | { kind: 'location'; location: { Id: number; Code: string; WarehouseId: number; Warehouse: string; IsSystem: boolean } }
  | { kind: 'employee'; employee: { Id: number; EnrollNo: string; Name: string; DepartmentId: number | null; Bin: string } };

/** What a scanned / typed code is: unit tag or serial, item barcode or code, bin, employee AC No or card. */
export async function resolve(code: string, tx?: Tx): Promise<Scan> {
  const c = String(code ?? '').trim();
  if (!c) throw new UserError('Scan or type a code.');
  const units = await query(`SELECT u.Id, u.ItemId, i.Code, i.Name AS Item, i.Unit, u.SerialNo, COALESCE(u.Tag, '') AS Tag, u.Status, u.WarehouseId,
      u.EmployeeId, e.EnrollNo, e.Name AS Employee, COALESCE(ws.Name, u.SiteName, '') AS Site, u.IssueLineId, l.IssueId
    FROM InvUnits u JOIN InvItems i ON i.Id = u.ItemId LEFT JOIN DirEmployees e ON e.Id = u.EmployeeId LEFT JOIN DirSites ws ON ws.Id = u.SiteId
      LEFT JOIN InvIssueLines l ON l.Id = u.IssueLineId
    WHERE lower(u.Tag) = lower(@c) OR lower(u.SerialNo) = lower(@c) ORDER BY (lower(u.Tag) = lower(@c)) DESC LIMIT 2`, { c }, tx);
  if (units.length === 1 || (units.length > 1 && units[0].Tag.toLowerCase() === c.toLowerCase()))
    return { kind: 'unit', unit: { ...units[0], Employee: units[0].Employee ?? '', EnrollNo: units[0].EnrollNo ?? '' } };
  if (units.length > 1) throw new UserError(`Serial ${c} is on more than one item: scan the unit's tag.`);
  const locId = /^LOC-(\d+)$/i.exec(c)?.[1];
  const loc = await one(`SELECT l.Id, l.Code, l.WarehouseId, w.Name AS Warehouse, l.IsSystem FROM InvLocations l JOIN InvWarehouses w ON w.Id = l.WarehouseId
    WHERE l.Id = @id OR lower(l.Tag) = lower(@c) LIMIT 1`, { id: Number(locId) || 0, c }, tx);
  if (loc) return { kind: 'location', location: { ...loc, IsSystem: !!loc.IsSystem } };
  const item = await one(`SELECT Id, Code, Name, Unit, TrackBy, IsReturnable, IsActive FROM InvItems WHERE lower(Barcode) = lower(@c) OR lower(Code) = lower(@c)
    ORDER BY (lower(Barcode) = lower(@c)) DESC LIMIT 1`, { c }, tx);
  if (item) return { kind: 'item', item: { ...item, IsReturnable: !!item.IsReturnable, IsActive: !!item.IsActive } };
  const no = /^bin-/i.test(c) ? c.slice(4) : c;
  const e = await one(`SELECT Id, EnrollNo, Name, DepartmentId FROM DirEmployees WHERE EnrollNo = @n OR (CardNo = @c AND CardNo <> '') ORDER BY (EnrollNo = @n) DESC LIMIT 1`, { n: no, c }, tx);
  if (e) return { kind: 'employee', employee: { ...e, Bin: binCode(e.EnrollNo) } };
  throw new UserError(`Nothing found for "${c}".`, 404);
}

/** Open lines of an item in an employee's bin (oldest first): what a scan-return of a quantity item takes from. */
export async function openLinesOf(employeeId: number, itemId: number, tx?: Tx) {
  return query(`SELECT l.Id AS LineId, s.Id AS IssueId, l.Qty - l.ReturnedQty - l.ConsumedQty AS Open
    FROM InvIssueLines l JOIN InvIssues s ON s.Id = l.IssueId JOIN InvItems i ON i.Id = l.ItemId
    WHERE s.EmployeeId = @e AND l.ItemId = @i AND l.ReturnedQty + l.ConsumedQty < l.Qty ORDER BY s.IssuedOn, l.Id`, { e: employeeId, i: itemId }, tx);
}

