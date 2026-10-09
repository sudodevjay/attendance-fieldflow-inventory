/** Masters of the inventory: categories, stores (warehouses), suppliers, items (with opening stock and Excel import). */
import ExcelJS from 'exceljs';
import { exec, one, query, transaction } from '../../db';
import { UserError } from '../../utils/errors';
import { scopeDepartments } from '../../utils/scope';
import { defaultWarehouse, idOrNull, money, mustText, nextItemCode, qty, text } from './common.service';
import { itemStock, post } from './stock.service';
import { whereIs } from './location.service';
import { registerExistingStock } from './unit.service';

// ------------------------------------------------------------------ lookups (the module's own: no access to attendance screens needed)

/** Everything the inventory screens pick from. Employees and departments come from attendance (active employees only). */
export async function lookups() {
  const sc = scopeDepartments();
  const employees = await query(`SELECT e.Id, e.EnrollNo, e.Name, e.DepartmentId, d.Name AS Department, e.Designation FROM DirEmployees e
    LEFT JOIN DirDepartments d ON d.Id = e.DepartmentId WHERE e.IsActive ORDER BY e.Name`);
  const departments = await query('SELECT Id, Name, ParentId FROM DirDepartments ORDER BY Name');
  return {
    employees: (sc ? employees.filter((e) => e.DepartmentId !== null && sc.has(e.DepartmentId)) : employees).map((e) => ({ ...e, Department: e.Department ?? '' })),
    departments: sc ? departments.filter((d) => sc.has(d.Id)) : departments,
    warehouses: await query('SELECT Id, Name, IsActive FROM InvWarehouses ORDER BY Name'),
    /** Locations (rack-row-column) of every store; RECEIVING first. */
    locations: (await query(`SELECT Id, WarehouseId, Code, IsSystem, IsActive FROM InvLocations ORDER BY WarehouseId, IsSystem DESC, Rack, length(RowNo), RowNo, length(ColNo), ColNo`))
      .map((l) => ({ ...l, IsSystem: !!l.IsSystem, IsActive: !!l.IsActive })),
    /** Work sites of attendance (material for a site). */
    sites: (await query('SELECT Id, Name, IsActive FROM DirSites ORDER BY Name')).map((s) => ({ ...s, IsActive: !!s.IsActive })),
    categories: await query('SELECT Id, Name FROM InvCategories ORDER BY Name'),
    suppliers: await query('SELECT Id, Name, IsActive, LeadTimeDays FROM InvSuppliers ORDER BY Name'),
    items: (await query(`SELECT i.Id, i.Code, i.Name, i.Unit, i.PurchasePrice, i.GstRate, i.IsReturnable, i.ReturnDays, i.PreferredSupplierId, i.IsActive,
      i.TrackBy, COALESCE(i.Barcode, '') AS Barcode FROM InvItems i ORDER BY i.Name`)).map((i) => ({ ...i, IsActive: !!i.IsActive, IsReturnable: !!i.IsReturnable })),
    stock: await query('SELECT ItemId, WarehouseId, Qty FROM InvStock WHERE Qty <> 0'),
  };
}

// ------------------------------------------------------------------ categories

export const categories = () => query(`SELECT c.Id, c.Name, (SELECT COUNT(*) FROM InvItems i WHERE i.CategoryId = c.Id) AS Items FROM InvCategories c ORDER BY c.Name`);

export async function saveCategory(id: number | null, b: { Name?: unknown }) {
  const name = mustText(b.Name, 100, 'category name');
  if (await one('SELECT Id FROM InvCategories WHERE lower(Name) = lower(@n) AND Id <> @id', { n: name, id: id ?? 0 })) throw new UserError('This category exists already.');
  if (id) { await exec('UPDATE InvCategories SET Name = @n WHERE Id = @id', { n: name, id }); return id; }
  return (await one('INSERT INTO InvCategories (Name) VALUES (@n) RETURNING Id', { n: name }))!.Id as number;
}

export const removeCategory = (id: number) => exec('DELETE FROM InvCategories WHERE Id = @id', { id });

// ------------------------------------------------------------------ stores

export async function warehouses() {
  return (await query(`SELECT w.Id, w.Name, w.Address, w.InchargeId, e.Name AS Incharge, w.IsActive,
      (SELECT COUNT(*) FROM InvStock s WHERE s.WarehouseId = w.Id AND s.Qty <> 0) AS Items,
      (SELECT COALESCE(SUM(s.Qty * s.AvgCost), 0) FROM InvStock s WHERE s.WarehouseId = w.Id) AS Value
    FROM InvWarehouses w LEFT JOIN DirEmployees e ON e.Id = w.InchargeId ORDER BY w.Name`))
    .map((w) => ({ ...w, IsActive: !!w.IsActive, Incharge: w.Incharge ?? '', Address: w.Address ?? '', Value: Math.round(Number(w.Value) * 100) / 100 }));
}

export async function saveWarehouse(id: number | null, b: { Name?: unknown; Address?: unknown; InchargeId?: unknown; IsActive?: unknown }) {
  const p = { n: mustText(b.Name, 100, 'store name'), a: text(b.Address, 300), e: idOrNull(b.InchargeId), act: b.IsActive !== false, id: id ?? 0 };
  if (await one('SELECT Id FROM InvWarehouses WHERE lower(Name) = lower(@n) AND Id <> @id', p)) throw new UserError('A store with this name exists already.');
  if (!p.act && id && (await one('SELECT 1 FROM InvStock WHERE WarehouseId = @id AND Qty <> 0 LIMIT 1', p)))
    throw new UserError('This store still has stock. Transfer it to another store before switching it off.');
  if (id) {
    if (!(await exec('UPDATE InvWarehouses SET Name = @n, Address = @a, InchargeId = @e, IsActive = @act WHERE Id = @id', p))) throw new UserError('Store not found.', 404);
    return id;
  }
  return (await one('INSERT INTO InvWarehouses (Name, Address, InchargeId, IsActive) VALUES (@n, @a, @e, @act) RETURNING Id', p))!.Id as number;
}

export async function removeWarehouse(id: number) {
  if (await one('SELECT 1 FROM InvMovements WHERE WarehouseId = @id LIMIT 1', { id }))
    throw new UserError('This store has stock movements. Switch it off (not active) instead of deleting it.');
  await exec('DELETE FROM InvStock WHERE WarehouseId = @id; DELETE FROM InvWarehouses WHERE Id = @id', { id });
}

// ------------------------------------------------------------------ suppliers

export async function suppliers() {
  return (await query(`SELECT s.*, (SELECT COUNT(*) FROM InvPurchaseOrders p WHERE p.SupplierId = s.Id AND p.Status IN ('Ordered', 'Partial')) AS OpenPos,
      (SELECT COUNT(*) FROM InvItems i WHERE i.PreferredSupplierId = s.Id) AS Items FROM InvSuppliers s ORDER BY s.Name`))
    .map((s) => ({ ...s, IsActive: !!s.IsActive }));
}

export interface SupplierInput { Name?: unknown; ContactPerson?: unknown; Phone?: unknown; Email?: unknown; Gstin?: unknown; Address?: unknown; LeadTimeDays?: unknown; IsActive?: unknown }

export async function saveSupplier(id: number | null, b: SupplierInput) {
  const gstin = text(b.Gstin, 15)?.toUpperCase() ?? null;
  if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(gstin)) throw new UserError('The GSTIN is not valid (15 characters, e.g. 07ABCDE1234F1Z5).');
  const email = text(b.Email, 100);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError('The e-mail address is not valid.');
  const p = {
    n: mustText(b.Name, 150, 'supplier name'), c: text(b.ContactPerson, 100), ph: text(b.Phone, 30), em: email, g: gstin, a: text(b.Address, 300),
    lt: Math.min(365, Math.max(0, Math.round(Number(b.LeadTimeDays ?? 7)) || 0)), act: b.IsActive !== false, id: id ?? 0,
  };
  if (id) {
    if (!(await exec(`UPDATE InvSuppliers SET Name = @n, ContactPerson = @c, Phone = @ph, Email = @em, Gstin = @g, Address = @a, LeadTimeDays = @lt,
      IsActive = @act WHERE Id = @id`, p))) throw new UserError('Supplier not found.', 404);
    return id;
  }
  return (await one(`INSERT INTO InvSuppliers (Name, ContactPerson, Phone, Email, Gstin, Address, LeadTimeDays, IsActive)
    VALUES (@n, @c, @ph, @em, @g, @a, @lt, @act) RETURNING Id`, p))!.Id as number;
}

export async function removeSupplier(id: number) {
  if (await one('SELECT 1 FROM InvPurchaseOrders WHERE SupplierId = @id LIMIT 1', { id }))
    throw new UserError('This supplier has purchase orders. Switch it off (not active) instead of deleting it.');
  await exec('DELETE FROM InvSuppliers WHERE Id = @id', { id });
}

// ------------------------------------------------------------------ items

export interface ItemInput {
  Code?: unknown; Name?: unknown; CategoryId?: unknown; Unit?: unknown; Hsn?: unknown; GstRate?: unknown; PurchasePrice?: unknown;
  ReorderLevel?: unknown; ReorderQty?: unknown; PreferredSupplierId?: unknown; IsReturnable?: unknown; ReturnDays?: unknown;
  Description?: unknown; IsActive?: unknown;
  /** Qty (counted) | Serial (every unit with its serial number / RFID / QR tag); not given = unchanged (new item: Qty). */
  TrackBy?: unknown;
  /** QR / barcode on the item's pack: scanning it picks the item. */
  Barcode?: unknown;
  /** New item only: stock it already has (and where it lies: empty = RECEIVING). */
  OpeningQty?: unknown; OpeningWarehouseId?: unknown; OpeningLocationId?: unknown;
}

function itemParams(b: ItemInput) {
  const gst = Number(b.GstRate ?? 18);
  if (![0, 0.25, 3, 5, 12, 18, 28].includes(gst)) throw new UserError('GST rate: 0, 0.25, 3, 5, 12, 18 or 28 %.');
  const hsn = text(b.Hsn, 10);
  if (hsn && !/^\d{4,8}$/.test(hsn)) throw new UserError('HSN / SAC code: 4 to 8 digits.');
  return {
    n: mustText(b.Name, 150, 'item name'), cat: idOrNull(b.CategoryId), u: text(b.Unit, 20) ?? 'Nos', h: hsn, g: gst,
    pp: money(b.PurchasePrice, 'purchase price'), rl: qty(b.ReorderLevel ?? 0, 're-order level', false), rq: qty(b.ReorderQty ?? 0, 're-order quantity', false),
    sup: idOrNull(b.PreferredSupplierId), ret: !!b.IsReturnable || b.TrackBy === 'Serial',
    rd: b.IsReturnable || b.TrackBy === 'Serial' ? Math.min(3650, Math.max(0, Math.round(Number(b.ReturnDays ?? 0)) || 0)) : 0,
    ds: text(b.Description, 500), act: b.IsActive !== false, bc: text(b.Barcode, 100),
  };
}

export async function saveItem(id: number | null, b: ItemInput, by: string) {
  const p = itemParams(b);
  const opening = id ? 0 : qty(b.OpeningQty ?? 0, 'opening stock', false);
  if (b.TrackBy !== undefined && b.TrackBy !== 'Qty' && b.TrackBy !== 'Serial') throw new UserError('Tracking: Qty or Serial.');
  return transaction(async (tx) => {
    const code = (text(b.Code, 30)?.toUpperCase()) ?? (id ? null : await nextItemCode(tx));
    if (!code) throw new UserError('Enter the item code.');
    if (await one('SELECT Id FROM InvItems WHERE Code = @c AND Id <> @id', { c: code, id: id ?? 0 }, tx)) throw new UserError(`The item code ${code} is used already.`);
    if (p.bc && await one('SELECT Code FROM InvItems WHERE (lower(Barcode) = lower(@b) OR lower(Code) = lower(@b)) AND Id <> @id', { b: p.bc, id: id ?? 0 }, tx))
      throw new UserError(`The barcode ${p.bc} belongs to another item.`);
    if (id) {
      const cur = await one('SELECT TrackBy FROM InvItems WHERE Id = @id FOR UPDATE', { id }, tx);
      if (!cur) throw new UserError('Item not found.', 404);
      const track = (b.TrackBy as string | undefined) ?? cur.TrackBy;
      if (cur.TrackBy === 'Serial' && track === 'Qty' && await one('SELECT 1 FROM InvUnits WHERE ItemId = @id LIMIT 1', { id }, tx))
        throw new UserError('This item has serial units; it cannot go back to quantity tracking. Switch it off and make a new item instead.');
      await exec(`UPDATE InvItems SET Code = @c, Name = @n, CategoryId = @cat, Unit = @u, Hsn = @h, GstRate = @g, PurchasePrice = @pp,
        ReorderLevel = @rl, ReorderQty = @rq, PreferredSupplierId = @sup, IsReturnable = (@ret OR @tr = 'Serial'), ReturnDays = @rd, Description = @ds,
        IsActive = @act, TrackBy = @tr, Barcode = @bc WHERE Id = @id`, { ...p, c: code, id, tr: track }, tx);
      if (cur.TrackBy !== 'Serial' && track === 'Serial') await registerExistingStock(id, by, tx);
      return id;
    }
    const newId = (await one(`INSERT INTO InvItems (Code, Name, CategoryId, Unit, Hsn, GstRate, PurchasePrice, ReorderLevel, ReorderQty,
      PreferredSupplierId, IsReturnable, ReturnDays, Description, IsActive, TrackBy, Barcode)
      VALUES (@c, @n, @cat, @u, @h, @g, @pp, @rl, @rq, @sup, @ret, @rd, @ds, @act, @tr, @bc) RETURNING Id`,
    { ...p, c: code, tr: b.TrackBy === 'Serial' ? 'Serial' : 'Qty' }, tx))!.Id as number;
    if (opening > 0) {
      const w = idOrNull(b.OpeningWarehouseId) ?? (await defaultWarehouse(tx));
      await post({ itemId: newId, warehouseId: w, type: 'Opening', qty: opening, unitCost: p.pp, refType: 'Item', refId: newId, refNo: code, note: 'Opening stock', by,
        locationId: Number(b.OpeningLocationId) || null }, tx);
    }
    return newId;
  });
}

export async function removeItem(id: number) {
  if (await one('SELECT 1 FROM InvMovements WHERE ItemId = @id LIMIT 1', { id }) || await one('SELECT 1 FROM InvPurchaseOrderLines WHERE ItemId = @id LIMIT 1', { id }))
    throw new UserError('This item has stock movements or orders. Switch it off (not active) instead of deleting it.');
  await exec('DELETE FROM InvStock WHERE ItemId = @id; DELETE FROM InvItems WHERE Id = @id', { id });
}

/** One item with its stock per store and its latest 200 movements. */
export async function item(id: number) {
  const i = await one(`SELECT i.*, c.Name AS Category, s.Name AS Supplier FROM InvItems i LEFT JOIN InvCategories c ON c.Id = i.CategoryId
    LEFT JOIN InvSuppliers s ON s.Id = i.PreferredSupplierId WHERE i.Id = @id`, { id });
  if (!i) throw new UserError('Item not found.', 404);
  const moves = await query(`SELECT m.Id, to_char(m.At, 'YYYY-MM-DD HH24:MI') AS At, w.Name AS Warehouse, COALESCE(lc.Code, '') AS Location, m.Type, m.Qty, m.UnitCost, m.BalanceAfter, m.RefNo,
      COALESCE(e.Name, '') AS Employee, COALESCE(d.Name, '') AS Department, m.Note, m.CreatedBy
    FROM InvMovements m JOIN InvWarehouses w ON w.Id = m.WarehouseId LEFT JOIN DirEmployees e ON e.Id = m.EmployeeId LEFT JOIN DirDepartments d ON d.Id = m.DepartmentId
      LEFT JOIN InvLocations lc ON lc.Id = m.LocationId
    WHERE m.ItemId = @id ORDER BY m.At DESC, m.Id DESC LIMIT 200`, { id });
  const units = await query(`SELECT Status, COUNT(*) AS Cnt, COUNT(*) FILTER (WHERE Tag IS NULL) AS Untagged FROM InvUnits WHERE ItemId = @id GROUP BY Status`, { id });
  return { ...i, IsActive: !!i.IsActive, IsReturnable: !!i.IsReturnable, Stock: await itemStock(id), Movements: moves, Locations: await whereIs(id),
    Units: units.map((u) => ({ Status: u.Status, N: Number(u.Cnt), Untagged: Number(u.Untagged) })) };
}

// ------------------------------------------------------------------ Excel

const HEADERS = ['Code', 'Name', 'Category', 'Unit', 'HSN', 'GST %', 'Purchase Price', 'Re-order Level', 'Re-order Qty', 'Supplier', 'Returnable', 'Return Days', 'Opening Qty', 'Store',
  'Tracking', 'Barcode'];

/** Empty sheet with the import columns and one example row. */
export async function importTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Items');
  ws.addRow(HEADERS).font = { bold: true };
  ws.addRow(['', 'A4 Paper Ream 75 GSM', 'Stationery', 'Ream', '4802', 12, 260, 10, 25, '', 'No', 0, 40, 'Main Store', 'Qty', '']);
  ws.addRow(['DRL-01', 'Cordless Drill 18V', 'Tools & Equipment', 'Nos', '8467', 18, 6500, 1, 2, '', 'Yes', 30, 3, 'Main Store', 'Qty', '']);
  ws.addRow(['BB-01', 'Boom Barrier 6 m', 'Tools & Equipment', 'Nos', '8479', 18, 85000, 0, 0, '', 'Yes', 0, 2, 'Main Store', 'Serial', '']);
  ws.columns.forEach((c, i) => (c.width = Math.max(10, HEADERS[i].length + 4)));
  ws.getColumn(2).width = 32;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z%]/g, '');
const cell = (c: ExcelJS.Cell) => {
  const v = c.value as any;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return String(v.result ?? v.text ?? (v.richText ? v.richText.map((r: any) => r.text).join('') : ''));
  return String(v).trim();
};

/**
 * Adds / updates items from the first sheet (the template's columns; only Name is required). A new category / supplier is
 * created when the name is not known; the opening quantity is only booked for items that are new.
 */
export async function importItems(file: Buffer, by: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(file as any); } catch { throw new UserError('This is not an Excel (.xlsx) file.'); }
  const ws = wb.worksheets[0];
  if (!ws) throw new UserError('The file has no sheet.');
  const head = new Map<string, number>();
  ws.getRow(1).eachCell((c, col) => head.set(norm(cell(c)), col));
  if (!head.has('name')) throw new UserError("The first row must have the column names of the template (at least 'Name').");
  const col = (...n: string[]) => n.map((x) => head.get(x) ?? 0).find((x) => x > 0) ?? 0;
  const c = {
    code: col('code', 'itemcode'), name: col('name', 'itemname'), cat: col('category'), unit: col('unit', 'uom'), hsn: col('hsn', 'hsnsac'), gst: col('gst%', 'gst', 'gstrate'),
    price: col('purchaseprice', 'price', 'rate'), level: col('reorderlevel', 'minstock'), rq: col('reorderqty'), sup: col('supplier'),
    ret: col('returnable'), rd: col('returndays'), open: col('openingqty', 'opening', 'stock'), store: col('store', 'warehouse'),
    track: col('tracking', 'trackby'), bc: col('barcode', 'qr', 'qrcode'),
  };
  const cats = new Map((await query('SELECT Id, Name FROM InvCategories')).map((r) => [String(r.Name).toLowerCase(), r.Id as number]));
  const sups = new Map((await query('SELECT Id, Name FROM InvSuppliers')).map((r) => [String(r.Name).toLowerCase(), r.Id as number]));
  const stores = new Map((await query('SELECT Id, Name FROM InvWarehouses')).map((r) => [String(r.Name).toLowerCase(), r.Id as number]));
  const errors: string[] = [];
  let added = 0, updated = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (n: number) => (n > 0 ? cell(row.getCell(n)) : '');
    if (!get(c.name) && !get(c.code)) continue;
    try {
      const idOf = async (map: Map<string, number>, name: string, table: 'InvCategories' | 'InvSuppliers') => {
        if (!name) return null;
        let id = map.get(name.toLowerCase());
        if (!id) { id = (await one(`INSERT INTO ${table} (Name) VALUES (@n) RETURNING Id`, { n: name.slice(0, 100) }))!.Id as number; map.set(name.toLowerCase(), id); }
        return id;
      };
      const code = get(c.code).toUpperCase();
      const existing = code ? await one('SELECT Id FROM InvItems WHERE Code = @c', { c: code }) : null;
      const store = get(c.store);
      if (store && !stores.has(store.toLowerCase())) throw new UserError(`unknown store "${store}"`);
      const b: ItemInput = {
        Code: code, Name: get(c.name), CategoryId: await idOf(cats, get(c.cat), 'InvCategories'), Unit: get(c.unit) || 'Nos', Hsn: get(c.hsn),
        GstRate: get(c.gst) === '' ? 18 : Number(get(c.gst).replace('%', '')), PurchasePrice: get(c.price) || 0, ReorderLevel: get(c.level) || 0,
        ReorderQty: get(c.rq) || 0, PreferredSupplierId: await idOf(sups, get(c.sup), 'InvSuppliers'), IsReturnable: /^(y|yes|1|true)$/i.test(get(c.ret)),
        ReturnDays: get(c.rd) || 0, OpeningQty: existing ? 0 : get(c.open) || 0, OpeningWarehouseId: store ? stores.get(store.toLowerCase()) : undefined,
        TrackBy: !get(c.track) ? undefined : /^(s|serial|yes|y|1|rfid|tag)/i.test(get(c.track)) ? 'Serial' : 'Qty',
        Barcode: c.bc ? get(c.bc) : undefined,
      };
      await saveItem(existing?.Id ?? null, b, by);
      if (existing) updated++; else added++;
    } catch (e: any) {
      if (!(e instanceof UserError)) throw e;
      errors.push(`Row ${r}: ${e.message}`);
    }
  }
  const msg = `${added} item(s) added, ${updated} updated.`;
  return errors.length ? `${msg}\n${errors.length} row(s) skipped:\n${errors.slice(0, 15).join('\n')}${errors.length > 15 ? '\n…' : ''}` : msg;
}
