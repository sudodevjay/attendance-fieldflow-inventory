/**
 * Purchasing: purchase orders (Draft → Ordered → Partial → Received, or Closed / Cancelled) and goods receipts (GRN).
 * Receiving books the stock at the PO price (weighted average cost), updates the PO's received quantities and its status
 * by itself, remembers the last price on the item and closes the "late PO" alert. A receipt without a PO is possible too.
 */
import { exec, one, query, transaction, type Tx } from '../../db';
import { UserError } from '../../utils/errors';
import { addDays, mustParse, sqlD, today } from '../../utils/time';
import { stockArrived } from './automation.service';
import { idOrNull, itemNames, lines, money, nextNo, qty, qtyText, resolve, text } from './common.service';
import { lineLoc, post, round2, serialsOf } from './stock.service';

export type PoStatus = 'Draft' | 'Ordered' | 'Partial' | 'Received' | 'Closed' | 'Cancelled';

const lineTotal = (l: { Qty: number; UnitPrice: number; GstRate: number }) => round2(Number(l.Qty) * Number(l.UnitPrice) * (1 + Number(l.GstRate) / 100));

export async function list(status: string) {
  const rows = await query(`SELECT p.Id, p.PoNo, p.SupplierId, s.Name AS Supplier, p.WarehouseId, w.Name AS Warehouse, to_char(p.OrderDate, 'YYYY-MM-DD') AS OrderDate,
      to_char(p.ExpectedDate, 'YYYY-MM-DD') AS ExpectedDate, p.Status, p.IsAuto, p.Notes, p.CreatedBy,
      COALESCE((SELECT SUM(l.Qty * l.UnitPrice * (1 + l.GstRate / 100)) FROM InvPurchaseOrderLines l WHERE l.PoId = p.Id), 0) AS Total,
      (SELECT COUNT(*) FROM InvPurchaseOrderLines l WHERE l.PoId = p.Id) AS LineCount
    FROM InvPurchaseOrders p JOIN InvSuppliers s ON s.Id = p.SupplierId JOIN InvWarehouses w ON w.Id = p.WarehouseId
    WHERE (@s = '' OR p.Status = @s OR (@s = 'Open' AND p.Status IN ('Draft', 'Ordered', 'Partial')))
    ORDER BY p.Id DESC LIMIT 1000`, { s: status });
  const t = today();
  return rows.map((r) => ({
    ...r, IsAuto: !!r.IsAuto, Notes: r.Notes ?? '', ExpectedDate: r.ExpectedDate ?? '', Total: round2(Number(r.Total)),
    Late: ['Ordered', 'Partial'].includes(r.Status) && !!r.ExpectedDate && mustParse(r.ExpectedDate) < t,
  }));
}

export async function get(id: number, tx?: Tx) {
  const p = await one(`SELECT p.*, to_char(p.OrderDate, 'YYYY-MM-DD') AS OrderDate, to_char(p.ExpectedDate, 'YYYY-MM-DD') AS ExpectedDate,
      s.Name AS Supplier, s.Gstin AS SupplierGstin, s.Address AS SupplierAddress, s.Phone AS SupplierPhone, s.Email AS SupplierEmail, w.Name AS Warehouse
    FROM InvPurchaseOrders p JOIN InvSuppliers s ON s.Id = p.SupplierId JOIN InvWarehouses w ON w.Id = p.WarehouseId WHERE p.Id = @id`, { id }, tx);
  if (!p) throw new UserError('Purchase order not found.', 404);
  const lns = await query(`SELECT l.Id, l.ItemId, i.Code, i.Name, i.Unit, i.Hsn, l.Qty, l.ReceivedQty, l.UnitPrice, l.GstRate
    FROM InvPurchaseOrderLines l JOIN InvItems i ON i.Id = l.ItemId WHERE l.PoId = @id ORDER BY l.Id`, { id }, tx);
  const receipts = await query(`SELECT Id, GrnNo, to_char(ReceivedOn, 'YYYY-MM-DD') AS ReceivedOn, InvoiceNo, CreatedBy FROM InvReceipts WHERE PoId = @id ORDER BY Id`, { id }, tx);
  const Lines = lns.map((l) => ({ ...l, Pending: Math.max(0, Number(l.Qty) - Number(l.ReceivedQty)), Total: lineTotal(l) }));
  return { ...p, IsAuto: !!p.IsAuto, Lines, Receipts: receipts, Total: round2(Lines.reduce((a, l) => a + l.Total, 0)) };
}

export interface PoInput { SupplierId?: unknown; WarehouseId?: unknown; OrderDate?: unknown; ExpectedDate?: unknown; Notes?: unknown; Lines?: unknown; Status?: unknown }

/** New PO or change of a Draft (supplier, store, dates, lines). */
export async function save(id: number | null, b: PoInput, by: string, opts: { auto?: boolean; tx?: Tx } = {}) {
  const items = lines(b.Lines, { price: true });
  const gst = new Map((Array.isArray(b.Lines) ? b.Lines : []).map((l: any) => [Number(l.ItemId), l.GstRate]));
  const run = async (tx: Tx) => {
    const sup = await one('SELECT Id, IsActive, LeadTimeDays FROM InvSuppliers WHERE Id = @id', { id: Number(b.SupplierId) || 0 }, tx);
    if (!sup) throw new UserError('Choose the supplier.');
    if (!sup.IsActive) throw new UserError('This supplier is not active.');
    const w = await one('SELECT Id FROM InvWarehouses WHERE Id = @id AND IsActive', { id: Number(b.WarehouseId) || 0 }, tx);
    if (!w) throw new UserError('Choose the store the goods go to.');
    const orderDate = b.OrderDate ? mustParse(String(b.OrderDate)) : today();
    const expected = b.ExpectedDate ? mustParse(String(b.ExpectedDate)) : addDays(orderDate, Number(sup.LeadTimeDays) || 0);
    if (expected < orderDate) throw new UserError('The expected date cannot be before the order date.');
    const names = await itemNames(items.map((l) => l.itemId), tx);
    const itemGst = new Map((await query('SELECT Id, GstRate FROM InvItems WHERE Id = ANY(@ids)', { ids: items.map((l) => l.itemId) }, tx)).map((r) => [r.Id, Number(r.GstRate)]));
    for (const l of items) if (!names.has(l.itemId)) throw new UserError('An item on the order does not exist.');
    const p = { s: sup.Id, w: w.Id, od: sqlD(orderDate), ed: sqlD(expected), n: text(b.Notes, 500), by, auto: !!opts.auto };
    let poId = id;
    if (poId) {
      const cur = await one('SELECT Status FROM InvPurchaseOrders WHERE Id = @id FOR UPDATE', { id: poId }, tx);
      if (!cur) throw new UserError('Purchase order not found.', 404);
      if (cur.Status !== 'Draft') throw new UserError('Only a draft can be changed. Cancel or close the order instead.');
      await exec('UPDATE InvPurchaseOrders SET SupplierId = @s, WarehouseId = @w, OrderDate = CAST(@od AS date), ExpectedDate = CAST(@ed AS date), Notes = @n WHERE Id = @id', { ...p, id: poId }, tx);
      await exec('DELETE FROM InvPurchaseOrderLines WHERE PoId = @id', { id: poId }, tx);
    } else {
      const no = await nextNo('PO', tx);
      poId = (await one(`INSERT INTO InvPurchaseOrders (PoNo, SupplierId, WarehouseId, OrderDate, ExpectedDate, Notes, CreatedBy, IsAuto)
        VALUES (@no, @s, @w, CAST(@od AS date), CAST(@ed AS date), @n, @by, @auto) RETURNING Id`, { ...p, no }, tx))!.Id as number;
    }
    for (const l of items) {
      const g = gst.get(l.itemId);
      await exec('INSERT INTO InvPurchaseOrderLines (PoId, ItemId, Qty, UnitPrice, GstRate) VALUES (@p, @i, @q, @u, @g)',
        { p: poId, i: l.itemId, q: l.qty, u: l.price, g: g === undefined || g === '' ? itemGst.get(l.itemId) ?? 0 : money(g, 'GST rate') }, tx);
    }
    if (b.Status === 'Ordered') await exec("UPDATE InvPurchaseOrders SET Status = 'Ordered' WHERE Id = @id", { id: poId }, tx);
    return poId;
  };
  return opts.tx ? run(opts.tx) : transaction(run);
}

/** Draft → Ordered (sent to the supplier); Cancelled (nothing received yet); Closed (the rest will not come). */
export async function setStatus(id: number, status: string) {
  const cur = await one('SELECT Status, PoNo FROM InvPurchaseOrders WHERE Id = @id', { id });
  if (!cur) throw new UserError('Purchase order not found.', 404);
  const allowed: Record<string, PoStatus[]> = { Ordered: ['Draft'], Cancelled: ['Draft', 'Ordered'], Closed: ['Ordered', 'Partial'], Draft: ['Ordered'] };
  if (!allowed[status]) throw new UserError('Unknown status.');
  if (!allowed[status].includes(cur.Status)) throw new UserError(`A ${cur.Status.toLowerCase()} order cannot be set to ${status.toLowerCase()}.`);
  if ((status === 'Cancelled' || status === 'Draft') && (await one('SELECT 1 FROM InvReceipts WHERE PoId = @id LIMIT 1', { id })))
    throw new UserError('Goods were received on this order already. Close it instead.');
  await exec('UPDATE InvPurchaseOrders SET Status = @s WHERE Id = @id', { s: status, id });
  // The "re-order draft made" alert is done once the draft was looked at (ordered / cancelled).
  await resolve(status === 'Draft' ? [] : [`autopo:${id}`, ...(status === 'Cancelled' || status === 'Closed' ? [`po-late:${id}`] : [])]);
  return `${cur.PoNo}: ${status}.`;
}

export async function remove(id: number) {
  const cur = await one('SELECT Status FROM InvPurchaseOrders WHERE Id = @id', { id });
  if (!cur) return;
  if (!['Draft', 'Cancelled'].includes(cur.Status)) throw new UserError('Only a draft or cancelled order can be deleted.');
  if (await one('SELECT 1 FROM InvReceipts WHERE PoId = @id LIMIT 1', { id })) throw new UserError('Goods were received on this order.');
  await exec('DELETE FROM InvPurchaseOrders WHERE Id = @id', { id });
}

// ------------------------------------------------------------------ goods receipt

export interface ReceiveInput { InvoiceNo?: unknown; ReceivedOn?: unknown; Note?: unknown; Lines?: unknown }

/** Goods received on a PO: Lines = [{ LineId, Qty, UnitPrice? }]. Over-delivery up to the ordered quantity only. */
export async function receive(poId: number, b: ReceiveInput, by: string) {
  if (!Array.isArray(b.Lines)) throw new UserError('Enter the received quantities.');
  const input = (b.Lines as any[]).filter((l) => Number(l.Qty) > 0).map((l) => ({ lineId: Number(l.LineId), qty: qty(l.Qty, 'received quantity'), price: l.UnitPrice }));
  if (!input.length) throw new UserError('Enter the quantity received of at least one item.');
  const r = await transaction(async (tx) => {
    const po = await one('SELECT Id, PoNo, Status, SupplierId, WarehouseId FROM InvPurchaseOrders WHERE Id = @id FOR UPDATE', { id: poId }, tx);
    if (!po) throw new UserError('Purchase order not found.', 404);
    if (po.Status === 'Draft') throw new UserError('Mark the order as Ordered (sent to the supplier) before receiving goods.');
    if (!['Ordered', 'Partial'].includes(po.Status)) throw new UserError(`This order is ${po.Status.toLowerCase()}; nothing more can be received on it.`);
    const poLines = new Map((await query('SELECT Id, ItemId, Qty, ReceivedQty, UnitPrice FROM InvPurchaseOrderLines WHERE PoId = @id', { id: poId }, tx)).map((l) => [l.Id as number, l]));
    const on = b.ReceivedOn ? mustParse(String(b.ReceivedOn)) : today();
    const no = await nextNo('GRN', tx);
    const grn = (await one(`INSERT INTO InvReceipts (GrnNo, PoId, SupplierId, WarehouseId, ReceivedOn, InvoiceNo, Note, CreatedBy)
      VALUES (@no, @po, @s, @w, CAST(@on AS date), @inv, @n, @by) RETURNING Id`,
    { no, po: poId, s: po.SupplierId, w: po.WarehouseId, on: sqlD(on), inv: text(b.InvoiceNo, 50), n: text(b.Note, 300), by }, tx))!.Id as number;
    const names = await itemNames([...poLines.values()].map((l) => l.ItemId), tx);
    for (const l of input) {
      const pl = poLines.get(l.lineId);
      if (!pl) throw new UserError('A line is not on this order.');
      const pending = Number(pl.Qty) - Number(pl.ReceivedQty);
      if (l.qty > pending + 1e-9) {
        const it = names.get(pl.ItemId);
        throw new UserError(`${it?.Code} ${it?.Name}: only ${qtyText(pending)} ${it?.Unit} still to come on this order, ${qtyText(l.qty)} entered.`);
      }
      const price = l.price === undefined || l.price === '' ? Number(pl.UnitPrice) : money(l.price);
      await exec('INSERT INTO InvReceiptLines (ReceiptId, PoLineId, ItemId, Qty, UnitPrice) VALUES (@r, @pl, @i, @q, @u)', { r: grn, pl: pl.Id, i: pl.ItemId, q: l.qty, u: price }, tx);
      await exec('UPDATE InvPurchaseOrderLines SET ReceivedQty = ReceivedQty + @q WHERE Id = @id', { q: l.qty, id: pl.Id }, tx);
      await exec('UPDATE InvItems SET PurchasePrice = @u WHERE Id = @i AND @u > 0', { u: price, i: pl.ItemId }, tx);
      await post({ itemId: pl.ItemId, warehouseId: po.WarehouseId, type: 'Receipt', qty: l.qty, unitCost: price, refType: 'Receipt', refId: grn, refNo: no,
        note: `${po.PoNo}${b.InvoiceNo ? ' / inv. ' + String(b.InvoiceNo).slice(0, 40) : ''}`, by,
        serials: Array.isArray(b.Lines) ? (b.Lines as any[]).find((x) => Number(x?.LineId) === l.lineId)?.Serials : undefined,
        locationId: Number(Array.isArray(b.Lines) ? (b.Lines as any[]).find((x) => Number(x?.LineId) === l.lineId)?.LocationId : 0) || Number((b as any).LocationId) || null }, tx);
    }
    const left = await one('SELECT COUNT(*) c FROM InvPurchaseOrderLines WHERE PoId = @id AND ReceivedQty < Qty', { id: poId }, tx);
    const status: PoStatus = left!.c ? 'Partial' : 'Received';
    await exec('UPDATE InvPurchaseOrders SET Status = @s WHERE Id = @id', { s: status, id: poId }, tx);
    if (status === 'Received') await resolve([`po-late:${poId}`], tx);
    return { grn, no, status, items: input.map((l) => poLines.get(l.lineId)!.ItemId as number), warehouseId: po.WarehouseId as number };
  });
  await afterReceipt(r.items, r.warehouseId);
  return { id: r.grn, message: `Goods receipt ${r.no} saved. The order is ${r.status === 'Received' ? 'fully received' : 'partly received'}.` };
}

/** Goods received without a purchase order (cash purchase, free samples, returns from a site ...). */
export async function directReceipt(b: { SupplierId?: unknown; WarehouseId?: unknown; InvoiceNo?: unknown; ReceivedOn?: unknown; Note?: unknown; Lines?: unknown }, by: string) {
  const items = lines(b.Lines, { price: true });
  const r = await transaction(async (tx) => {
    const w = await one('SELECT Id FROM InvWarehouses WHERE Id = @id AND IsActive', { id: Number(b.WarehouseId) || 0 }, tx);
    if (!w) throw new UserError('Choose the store the goods go to.');
    const sup = idOrNull(b.SupplierId);
    const on = b.ReceivedOn ? mustParse(String(b.ReceivedOn)) : today();
    const no = await nextNo('GRN', tx);
    const grn = (await one(`INSERT INTO InvReceipts (GrnNo, SupplierId, WarehouseId, ReceivedOn, InvoiceNo, Note, CreatedBy)
      VALUES (@no, @s, @w, CAST(@on AS date), @inv, @n, @by) RETURNING Id`,
    { no, s: sup, w: w.Id, on: sqlD(on), inv: text(b.InvoiceNo, 50), n: text(b.Note, 300), by }, tx))!.Id as number;
    for (const l of items) {
      await exec('INSERT INTO InvReceiptLines (ReceiptId, ItemId, Qty, UnitPrice) VALUES (@r, @i, @q, @u)', { r: grn, i: l.itemId, q: l.qty, u: l.price }, tx);
      if (l.price > 0) await exec('UPDATE InvItems SET PurchasePrice = @u WHERE Id = @i', { u: l.price, i: l.itemId }, tx);
      await post({ itemId: l.itemId, warehouseId: w.Id, type: 'Receipt', qty: l.qty, unitCost: l.price, refType: 'Receipt', refId: grn, refNo: no,
        note: text(b.Note, 300) ?? (b.InvoiceNo ? `inv. ${String(b.InvoiceNo).slice(0, 40)}` : 'Receipt without PO'), by, serials: serialsOf(b.Lines, l.itemId),
        locationId: lineLoc(b, l.itemId, 'LocationId') }, tx);
    }
    return { grn, no, warehouseId: w.Id as number };
  });
  await afterReceipt(items.map((l) => l.itemId), r.warehouseId);
  return { id: r.grn, message: `Goods receipt ${r.no} saved.` };
}

/** New stock: low-stock alerts may be over, waiting requisitions may now be issued. */
async function afterReceipt(itemIds: number[], warehouseId: number) {
  try {
    await stockArrived(itemIds, warehouseId);
  } catch (e) { console.error('inventory automation after receipt failed:', e); }
}

export async function receipts(from: string, to: string) {
  const f = mustParse(from), t = mustParse(to);
  const rows = await query(`SELECT r.Id, r.GrnNo, to_char(r.ReceivedOn, 'YYYY-MM-DD') AS ReceivedOn, r.PoId, p.PoNo, COALESCE(s.Name, '') AS Supplier, w.Name AS Warehouse,
      COALESCE(r.InvoiceNo, '') AS InvoiceNo, COALESCE(r.Note, '') AS Note, r.CreatedBy,
      COALESCE((SELECT SUM(l.Qty * l.UnitPrice) FROM InvReceiptLines l WHERE l.ReceiptId = r.Id), 0) AS Value
    FROM InvReceipts r LEFT JOIN InvPurchaseOrders p ON p.Id = r.PoId LEFT JOIN InvSuppliers s ON s.Id = r.SupplierId JOIN InvWarehouses w ON w.Id = r.WarehouseId
    WHERE r.ReceivedOn BETWEEN CAST(@f AS date) AND CAST(@t AS date) ORDER BY r.Id DESC LIMIT 2000`, { f: sqlD(f), t: sqlD(t) });
  const ids = rows.map((r) => r.Id as number);
  const lns = ids.length ? await query(`SELECT l.ReceiptId, i.Code, i.Name, i.Unit, l.Qty, l.UnitPrice FROM InvReceiptLines l JOIN InvItems i ON i.Id = l.ItemId
    WHERE l.ReceiptId = ANY(@ids) ORDER BY l.Id`, { ids }) : [];
  return rows.map((r) => ({ ...r, PoNo: r.PoNo ?? '', Value: round2(Number(r.Value)), Lines: lns.filter((l) => l.ReceiptId === r.Id) }));
}
