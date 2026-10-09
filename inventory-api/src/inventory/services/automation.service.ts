/**
 * What the inventory does by itself:
 *  - after every issue / adjustment: items at or below their re-order level get a "low stock" alert, and (AutoPO) a
 *    purchase order for their preferred supplier: added to that supplier's open automatic draft, or a new PO
 *    (draft, or already "ordered" with AutoPO = ordered). Stock + quantity on open POs counts, so nothing is ordered twice.
 *  - after goods arrive: low-stock alerts close, approved requisitions waiting for these items are issued (AutoIssue) or
 *    the store is told they can be issued now.
 *  - once a day (and when the dashboard opens and it has not run today): the re-order check for every item, POs past
 *    their expected date, returnable items not given back in time (reminder to the employee in the portal, again every
 *    few days), employees who left while still holding items (exit clearance), requisitions waiting too long for approval.
 */
import { exec, one, query, transaction } from '../../db';
import { notify } from '../../attendance';
import { fmt, mustParse, now, sqlD, today } from '../../utils/time';
import { defaultWarehouse, getSetting, qtyText, raise, resolve, setSetting } from './common.service';
import { autoIssue, holdings } from './issue.service';
import { save as savePo } from './purchase.service';
import { openOrderQty } from './stock.service';

/** Re-order check of these items (all items with a re-order level when omitted). Returns the POs made or extended. */
export async function reorderCheck(itemIds?: number[]): Promise<string[]> {
  const items = await query(`SELECT i.Id, i.Code, i.Name, i.Unit, i.ReorderLevel, i.ReorderQty, i.PurchasePrice, i.GstRate, i.PreferredSupplierId,
      s.IsActive AS SupplierActive, COALESCE((SELECT SUM(x.Qty) FROM InvStock x WHERE x.ItemId = i.Id), 0) AS Stock
    FROM InvItems i LEFT JOIN InvSuppliers s ON s.Id = i.PreferredSupplierId
    WHERE i.IsActive AND (CAST(@ids AS int[]) IS NULL OR i.Id = ANY(@ids))`, { ids: itemIds ?? null });
  if (!items.length) return [];
  const onOrder = await openOrderQty();
  const recovered: string[] = [];
  const toOrder = new Map<number, { itemId: number; qty: number; price: number; gst: number }[]>();
  for (const i of items) {
    const level = Number(i.ReorderLevel), stock = Number(i.Stock), ordered = onOrder.get(i.Id) ?? 0;
    if (level <= 0 || stock > level) { recovered.push(`low:${i.Id}`); continue; }
    await raise('LowStock', `low:${i.Id}`, `Low stock: ${i.Code} ${i.Name}`,
      `${qtyText(stock)} ${i.Unit} left, re-order level ${qtyText(level)}.${ordered ? ` ${qtyText(ordered)} on order.` : ''}${i.PreferredSupplierId ? '' : ' No preferred supplier set.'}`,
      `/inventory/items?id=${i.Id}`);
    if (stock + ordered > level || !i.PreferredSupplierId || !i.SupplierActive) continue;
    const q = Number(i.ReorderQty) > 0 ? Number(i.ReorderQty) : Math.max(1, Math.ceil(level * 2 - stock - ordered));
    const list = toOrder.get(i.PreferredSupplierId) ?? [];
    list.push({ itemId: i.Id, qty: q, price: Number(i.PurchasePrice), gst: Number(i.GstRate) });
    toOrder.set(i.PreferredSupplierId, list);
  }
  await resolve(recovered);
  const mode = await getSetting('AutoPO');
  if (mode === 'off' || !toOrder.size) return [];
  return transaction(async (tx) => {
    // One re-order at a time: two issues at the same moment must not make two POs.
    await exec('SELECT pg_advisory_xact_lock(740201)', {}, tx);
    const again = await openOrderQty(tx);
    const w = await defaultWarehouse(tx);
    const done: string[] = [];
    for (const [supplierId, list] of toOrder) {
      const fresh = list.filter((l) => !again.has(l.itemId) || again.get(l.itemId) === onOrder.get(l.itemId));
      if (!fresh.length) continue;
      const draft = mode === 'draft' ? await one(`SELECT Id, PoNo FROM InvPurchaseOrders WHERE IsAuto AND Status = 'Draft' AND SupplierId = @s AND WarehouseId = @w
        ORDER BY Id DESC LIMIT 1`, { s: supplierId, w }, tx) : null;
      let poId: number, poNo: string;
      if (draft) {
        poId = draft.Id; poNo = draft.PoNo;
        for (const l of fresh) {
          const n = await exec('UPDATE InvPurchaseOrderLines SET Qty = Qty + @q WHERE PoId = @p AND ItemId = @i', { q: l.qty, p: poId, i: l.itemId }, tx);
          if (!n) await exec('INSERT INTO InvPurchaseOrderLines (PoId, ItemId, Qty, UnitPrice, GstRate) VALUES (@p, @i, @q, @u, @g)', { p: poId, i: l.itemId, q: l.qty, u: l.price, g: l.gst }, tx);
        }
      } else {
        poId = await savePo(null, {
          SupplierId: supplierId, WarehouseId: w, Notes: 'Made by the automatic re-order.', Status: mode === 'ordered' ? 'Ordered' : undefined,
          Lines: fresh.map((l) => ({ ItemId: l.itemId, Qty: l.qty, UnitPrice: l.price, GstRate: l.gst })),
        }, 'Auto re-order', { auto: true, tx });
        poNo = (await one('SELECT PoNo FROM InvPurchaseOrders WHERE Id = @id', { id: poId }, tx))!.PoNo;
      }
      const sup = await one('SELECT Name FROM InvSuppliers WHERE Id = @id', { id: supplierId }, tx);
      await raise('AutoPO', `autopo:${poId}`, `Re-order ${poNo} for ${sup?.Name}`,
        mode === 'ordered' ? 'Placed automatically. Send it to the supplier.' : 'Draft made automatically. Check it and mark it as Ordered.', `/inventory/purchase?id=${poId}`, tx);
      done.push(poNo);
    }
    return done;
  });
}

/** Goods came into a store: close low-stock alerts, move waiting requisitions on. */
export async function stockArrived(itemIds: number[], warehouseId: number) {
  await reorderCheck(itemIds);
  const waiting = await query(`SELECT DISTINCT r.Id, r.ReqNo, COALESCE(e.Name, r.EmployeeName) AS Employee FROM InvRequisitions r
    JOIN InvRequisitionLines l ON l.RequisitionId = r.Id LEFT JOIN DirEmployees e ON e.Id = r.EmployeeId
    WHERE r.Status IN ('Approved', 'PartIssued') AND r.WarehouseId = @w AND l.IssuedQty < l.Qty AND l.ItemId = ANY(@ids) ORDER BY r.Id`, { w: warehouseId, ids: itemIds });
  const auto = (await getSetting('AutoIssue')) === '1';
  for (const r of waiting) {
    if (auto && (await autoIssue(r.Id))) continue;
    const short = await one(`SELECT 1 FROM InvRequisitionLines l LEFT JOIN InvStock s ON s.ItemId = l.ItemId AND s.WarehouseId = @w
      WHERE l.RequisitionId = @r AND l.Qty - l.IssuedQty > COALESCE(s.Qty, 0) LIMIT 1`, { r: r.Id, w: warehouseId });
    if (!short) await raise('CanIssue', `req-can:${r.Id}`, `Requisition ${r.ReqNo} can be issued now`, `The goods for ${r.Employee} have arrived.`, `/inventory/requisitions?id=${r.Id}`);
  }
}

// ------------------------------------------------------------------ daily checks

let running: Promise<DailyResult> | null = null;

export interface DailyResult { ranAt: string; reordered: string[]; latePos: number; overdue: number; reminded: number; exitClearance: number; waitingRequisitions: number }

export function runDaily(): Promise<DailyResult> {
  if (!running) running = daily().finally(() => { running = null; });
  return running;
}

/** Runs the daily checks when they have not run today (dashboard open, timer). */
export async function maybeRunDaily() {
  try {
    if ((await getSetting('LastDailyRun')) !== sqlD(today())) await runDaily();
  } catch (e) { console.error('inventory daily checks failed:', e); }
}

async function daily(): Promise<DailyResult> {
  const t = today();
  const reordered = await reorderCheck();

  // Purchase orders past their expected date.
  const late = await query(`SELECT p.Id, p.PoNo, s.Name AS Supplier, to_char(p.ExpectedDate, 'YYYY-MM-DD') AS ExpectedDate FROM InvPurchaseOrders p
    JOIN InvSuppliers s ON s.Id = p.SupplierId WHERE p.Status IN ('Ordered', 'Partial') AND p.ExpectedDate < CAST(@t AS date)`, { t: sqlD(t) });
  for (const p of late)
    await raise('LatePO', `po-late:${p.Id}`, `${p.PoNo} from ${p.Supplier} is late`, `Expected on ${fmt(mustParse(p.ExpectedDate), 'dd MMM yyyy')}. Follow up with the supplier.`, `/inventory/purchase?id=${p.Id}`);

  // Returnable items not given back in time: alert for the store, reminder for the employee every few days.
  const every = Number(await getSetting('OverdueReminderDays')) || 7;
  const held = await holdings({});
  let reminded = 0;
  for (const h of held.filter((x) => x.OverdueDays > 0)) {
    await raise('Overdue', `overdue:${h.LineId}`, `Not returned: ${h.Item} (${h.Employee})`,
      `${qtyText(h.Qty)} ${h.Unit} due back on ${fmt(mustParse(h.DueDate), 'dd MMM yyyy')} (${h.IssueNo}), ${h.OverdueDays} day(s) late.`, '/inventory/issues?tab=holdings');
    if (!h.EmployeeId || !h.EmployeeActive) continue;
    const line = await one('SELECT to_char(RemindedOn, \'YYYY-MM-DD\') AS RemindedOn FROM InvIssueLines WHERE Id = @id', { id: h.LineId });
    if (line?.RemindedOn && (t - mustParse(line.RemindedOn)) / 86_400_000 < every) continue;
    await notify(h.EmployeeId, `Please return ${h.Item}`, `It was due back to the store on ${fmt(mustParse(h.DueDate), 'dd MMM yyyy')} (${h.IssueNo}).`, 'store');
    await exec('UPDATE InvIssueLines SET RemindedOn = CAST(@t AS date) WHERE Id = @id', { t: sqlD(t), id: h.LineId });
    reminded++;
  }

  // Employees switched off in attendance (left the company) who still hold returnable items.
  const leavers = new Map<number, { name: string; items: number }>();
  for (const h of held) if (h.EmployeeId && !h.EmployeeActive) {
    const x = leavers.get(h.EmployeeId) ?? { name: h.Employee, items: 0 };
    x.items++;
    leavers.set(h.EmployeeId, x);
  }
  for (const [id, x] of leavers)
    await raise('ExitClearance', `exit:${id}`, `Exit clearance: ${x.name}`, `Left the company but still holds ${x.items} returnable item(s). Recover them or write them off.`,
      '/inventory/issues?tab=holdings');

  // Requisitions waiting for a decision.
  const days = Number(await getSetting('PendingReminderDays')) || 2;
  const waiting = await query(`SELECT r.Id, r.ReqNo, COALESCE(e.Name, r.EmployeeName) AS Employee, COALESCE(d.Name, '') AS Department FROM InvRequisitions r
    LEFT JOIN DirEmployees e ON e.Id = r.EmployeeId LEFT JOIN DirDepartments d ON d.Id = r.DepartmentId
    WHERE r.Status = 'Pending' AND r.CreatedAt < LOCALTIMESTAMP - make_interval(days => @d)`, { d: days });
  for (const r of waiting)
    await raise('PendingReq', `req-wait:${r.Id}`, `${r.ReqNo} waits for approval`, `${r.Employee}${r.Department ? ' (' + r.Department + ')' : ''}: more than ${days} day(s) without a decision.`,
      `/inventory/requisitions?id=${r.Id}`);

  await setSetting('LastDailyRun', sqlD(t));
  return { ranAt: fmt(now(), 'yyyy-MM-dd HH:mm'), reordered, latePos: late.length, overdue: held.filter((x) => x.OverdueDays > 0).length, reminded, exitClearance: leavers.size, waitingRequisitions: waiting.length };
}

let timer: NodeJS.Timeout | null = null;

/** Timer of the daily checks: every 30 minutes it looks whether they ran today (the server may sleep on Render's free plan). */
export function startJobs() {
  if (timer) return;
  setTimeout(maybeRunDaily, 15_000).unref();
  timer = setInterval(maybeRunDaily, 30 * 60_000);
  timer.unref();
}
