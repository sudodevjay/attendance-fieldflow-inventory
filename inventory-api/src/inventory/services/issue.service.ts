/**
 * Material going out to people: requisitions (asked by an employee in the portal or by the store on their behalf,
 * approved by the HOD / store unless approval is off), issues (with or without a requisition) and returns of returnable
 * items. The employee and the department come from attendance (DirEmployees, DirDepartments); the name is kept on the
 * document so history stays readable when an employee is deleted.
 *
 * Work sites (attendance's DirSites): a requisition / issue can be for a site. Everything issued for a site is "at the
 * site" (Qty - ReturnedQty - ConsumedQty) until it is installed there (consume: InvSiteUsage) or given back, whether the
 * item is returnable or not; leftovers of consumables (cable, pipe) come back with the normal return.
 */
import { exec, one, query, transaction, type Tx } from '../../db';
import { notify } from '../../attendance';
import { sitesOf } from '../../attendance';
import { UserError } from '../../utils/errors';
import { scopeDepartments } from '../../utils/scope';
import { addDays, mustParse, sqlD, today } from '../../utils/time';
import { defaultWarehouse, getSetting, idOrNull, itemNames, lines, nextNo, qty, qtyText, raise, resolve, text } from './common.service';
import { assertBinRoom, entriesOf, openLinesOf, resolve as resolveCode } from './bin.service';
import { afterStockChange, lineLoc, post, round2, unitsOf, type Move } from './stock.service';
import { closeLineUnits, logUnits, openUnitsOf } from './unit.service';

export type ReqStatus = 'Pending' | 'Approved' | 'PartIssued' | 'Issued' | 'Rejected' | 'Cancelled';

async function employee(id: unknown, tx?: Tx) {
  const e = await one('SELECT Id, EnrollNo, Name, DepartmentId, IsActive FROM DirEmployees WHERE Id = @id', { id: Number(id) || 0 }, tx);
  if (!e) throw new UserError('Choose the employee.');
  if (!e.IsActive) throw new UserError(`${e.Name} is not an active employee.`);
  return e as { Id: number; EnrollNo: string; Name: string; DepartmentId: number | null };
}

/** The work site of a requisition / issue (null = none); a new document needs an active one. */
async function site(id: unknown, tx?: Tx) {
  const sid = idOrNull(id);
  if (sid === null) return null;
  const s = await one('SELECT Id, Name, IsActive FROM DirSites WHERE Id = @id', { id: sid }, tx);
  if (!s || !s.IsActive) throw new UserError('Choose an active work site.');
  return s as { Id: number; Name: string };
}

/** An HOD only reaches the documents of their departments. */
function assertDept(departmentId: number | null) {
  const sc = scopeDepartments();
  if (sc && (departmentId === null || !sc.has(departmentId))) throw new UserError('This is not a requisition of your department.', 403);
}

// ------------------------------------------------------------------ requisitions

export interface ReqInput { EmployeeId?: unknown; DepartmentId?: unknown; WarehouseId?: unknown; SiteId?: unknown; Purpose?: unknown; Lines?: unknown }

/** New requisition. From the portal the employee is the logged-in one; approval off = approved at once. */
export async function createRequisition(b: ReqInput, by: string, source: 'portal' | 'admin') {
  const items = lines(b.Lines);
  const r = await transaction(async (tx) => {
    const e = await employee(b.EmployeeId, tx);
    const dept = source === 'admin' ? idOrNull(b.DepartmentId) ?? e.DepartmentId : e.DepartmentId;
    if (source === 'admin') assertDept(dept);
    const w = idOrNull(b.WarehouseId) ?? (await defaultWarehouse(tx));
    if (!(await one('SELECT 1 FROM InvWarehouses WHERE Id = @id AND IsActive', { id: w }, tx))) throw new UserError('Choose an active store.');
    const names = await itemNames(items.map((l) => l.itemId), tx);
    const inactive = await query('SELECT Code, Name FROM InvItems WHERE Id = ANY(@ids) AND NOT IsActive', { ids: items.map((l) => l.itemId) }, tx);
    if (inactive.length || names.size !== items.length) throw new UserError(`This item cannot be requested: ${inactive.map((i) => i.Name).join(', ') || 'unknown item'}.`);
    const ws = await site(b.SiteId, tx);
    const adding = await entriesOf(items, !!ws, tx);
    if (adding) await assertBinRoom(e.Id, `${e.EnrollNo} ${e.Name}`, adding, tx);
    const approveNow = (await getSetting('Approval')) === 'none';
    const no = await nextNo('REQ', tx);
    const id = (await one(`INSERT INTO InvRequisitions (ReqNo, EmployeeId, EmployeeName, DepartmentId, WarehouseId, SiteId, SiteName, Purpose, Status, Source, RequestedBy, DecidedBy, DecidedOn)
      VALUES (@no, @e, @en, @d, @w, @si, @sn, @p, @st, @src, @by, @db, CASE WHEN @auto THEN LOCALTIMESTAMP END) RETURNING Id`, {
      no, e: e.Id, en: e.Name, d: dept, w, si: ws?.Id ?? null, sn: ws?.Name ?? null, p: text(b.Purpose, 300), st: approveNow ? 'Approved' : 'Pending', src: source, by,
      db: approveNow ? 'Auto (no approval needed)' : null, auto: approveNow,
    }, tx))!.Id as number;
    for (const l of items) await exec('INSERT INTO InvRequisitionLines (RequisitionId, ItemId, Qty) VALUES (@r, @i, @q)', { r: id, i: l.itemId, q: l.qty }, tx);
    return { id, no, approveNow, employee: e };
  });
  if (r.approveNow) await autoIssue(r.id);
  else await raise('NewReq', `req-new:${r.id}`, `New requisition ${r.no}`, `${r.employee.Name} asked for ${items.length} item(s).`, `/inventory/requisitions?id=${r.id}`);
  return { id: r.id, message: `Requisition ${r.no} saved${r.approveNow ? ' and approved' : '; it waits for approval'}.` };
}

export async function requisitions(f: { status?: string; employeeId?: number | null; from?: string; to?: string }) {
  const sc = scopeDepartments();
  const rows = await query(`SELECT r.Id, r.ReqNo, r.EmployeeId, COALESCE(e.Name, r.EmployeeName) AS Employee, e.EnrollNo, r.DepartmentId, COALESCE(d.Name, '') AS Department,
      r.WarehouseId, w.Name AS Warehouse, r.SiteId, COALESCE(ws.Name, r.SiteName, '') AS Site, COALESCE(r.Purpose, '') AS Purpose, r.Status, r.Source, r.RequestedBy,
      to_char(r.CreatedAt, 'YYYY-MM-DD HH24:MI') AS CreatedAt, COALESCE(r.DecidedBy, '') AS DecidedBy, to_char(r.DecidedOn, 'YYYY-MM-DD HH24:MI') AS DecidedOn,
      COALESCE(r.DecisionNote, '') AS DecisionNote
    FROM InvRequisitions r LEFT JOIN DirEmployees e ON e.Id = r.EmployeeId LEFT JOIN DirDepartments d ON d.Id = r.DepartmentId JOIN InvWarehouses w ON w.Id = r.WarehouseId
      LEFT JOIN DirSites ws ON ws.Id = r.SiteId
    WHERE (@s = '' OR r.Status = @s OR (@s = 'Open' AND r.Status IN ('Pending', 'Approved', 'PartIssued')) OR (@s = 'ToIssue' AND r.Status IN ('Approved', 'PartIssued')))
      AND (CAST(@e AS int) IS NULL OR r.EmployeeId = @e)
      AND (CAST(NULLIF(@f, '') AS date) IS NULL OR r.CreatedAt >= CAST(NULLIF(@f, '') AS date))
      AND (CAST(NULLIF(@t, '') AS date) IS NULL OR r.CreatedAt < CAST(NULLIF(@t, '') AS date) + 1)
      AND (CAST(@ds AS int[]) IS NULL OR r.DepartmentId = ANY(@ds))
    ORDER BY r.Id DESC LIMIT 1000`, { s: f.status ?? '', e: f.employeeId ?? null, f: f.from ?? '', t: f.to ?? '', ds: sc ? [...sc] : null });
  const ids = rows.map((r) => r.Id as number);
  const lns = ids.length ? await reqLines(ids) : [];
  return rows.map((r) => ({ ...r, DecidedOn: r.DecidedOn ?? '', Lines: lns.filter((l) => l.RequisitionId === r.Id) }));
}

async function reqLines(ids: number[], tx?: Tx) {
  const rows = await query(`SELECT l.Id, l.RequisitionId, l.ItemId, i.Code, i.Name, i.Unit, i.IsReturnable, l.Qty, l.IssuedQty, r.WarehouseId,
      COALESCE(s.Qty, 0) AS InStock
    FROM InvRequisitionLines l JOIN InvRequisitions r ON r.Id = l.RequisitionId JOIN InvItems i ON i.Id = l.ItemId
      LEFT JOIN InvStock s ON s.ItemId = l.ItemId AND s.WarehouseId = r.WarehouseId
    WHERE l.RequisitionId = ANY(@ids) ORDER BY l.Id`, { ids }, tx);
  return rows.map((l) => ({ ...l, IsReturnable: !!l.IsReturnable, Pending: Math.max(0, Number(l.Qty) - Number(l.IssuedQty)) }));
}

export async function requisition(id: number) {
  const r = (await requisitionsById([id]))[0];
  if (!r) throw new UserError('Requisition not found.', 404);
  assertDept(r.DepartmentId);
  return r;
}

async function requisitionsById(ids: number[]) {
  const rows = await query(`SELECT r.*, COALESCE(e.Name, r.EmployeeName) AS Employee, e.EnrollNo, COALESCE(d.Name, '') AS Department, w.Name AS Warehouse,
      COALESCE(ws.Name, r.SiteName, '') AS Site, to_char(r.CreatedAt, 'YYYY-MM-DD HH24:MI') AS CreatedAt
    FROM InvRequisitions r LEFT JOIN DirEmployees e ON e.Id = r.EmployeeId LEFT JOIN DirDepartments d ON d.Id = r.DepartmentId JOIN InvWarehouses w ON w.Id = r.WarehouseId
      LEFT JOIN DirSites ws ON ws.Id = r.SiteId
    WHERE r.Id = ANY(@ids)`, { ids });
  const lns = await reqLines(ids);
  return rows.map((r) => ({ ...r, Lines: lns.filter((l) => l.RequisitionId === r.Id) }));
}

/** Approve (optionally with smaller quantities: Lines [{ LineId, Qty }]) or reject a pending requisition. */
export async function decide(id: number, b: { approve?: unknown; note?: unknown; Lines?: unknown }, by: string) {
  const approve = b.approve === true;
  const note = text(b.note, 300);
  if (!approve && !note) throw new UserError('Write why the requisition is rejected.');
  const r = await transaction(async (tx) => {
    const req = await one('SELECT Id, ReqNo, Status, EmployeeId, DepartmentId FROM InvRequisitions WHERE Id = @id FOR UPDATE', { id }, tx);
    if (!req) throw new UserError('Requisition not found.', 404);
    assertDept(req.DepartmentId);
    if (req.Status !== 'Pending') throw new UserError(`This requisition is ${req.Status.toLowerCase()} already.`);
    if (approve && Array.isArray(b.Lines)) {
      for (const l of b.Lines as any[]) {
        const n = qty(l.Qty, 'approved quantity', false);
        const cur = await one('SELECT Qty FROM InvRequisitionLines WHERE Id = @id AND RequisitionId = @r', { id: Number(l.LineId) || 0, r: id }, tx);
        if (!cur) throw new UserError('A line is not on this requisition.');
        if (n > Number(cur.Qty)) throw new UserError('The approved quantity cannot be more than asked for.');
        if (n === 0) await exec('DELETE FROM InvRequisitionLines WHERE Id = @id', { id: Number(l.LineId) }, tx);
        else await exec('UPDATE InvRequisitionLines SET Qty = @q WHERE Id = @id', { q: n, id: Number(l.LineId) }, tx);
      }
      if (!(await one('SELECT 1 FROM InvRequisitionLines WHERE RequisitionId = @id LIMIT 1', { id }, tx))) throw new UserError('Approve at least one item, or reject the requisition.');
    }
    await exec(`UPDATE InvRequisitions SET Status = @s, DecidedBy = @by, DecidedOn = LOCALTIMESTAMP, DecisionNote = @n WHERE Id = @id`,
      { s: approve ? 'Approved' : 'Rejected', by, n: note, id }, tx);
    await resolve([`req-new:${id}`, `req-wait:${id}`], tx);
    return req;
  });
  if (r.EmployeeId) await notify(r.EmployeeId, `Requisition ${r.ReqNo} ${approve ? 'approved' : 'rejected'}`,
    approve ? 'Collect the items from the store.' : note ?? '', 'store');
  const issued = approve ? await autoIssue(id) : '';
  return `${r.ReqNo} ${approve ? 'approved' : 'rejected'}.${issued ? ' ' + issued : ''}`;
}

export async function cancelRequisition(id: number, by: string, employeeId?: number) {
  const req = await one('SELECT Id, ReqNo, Status, EmployeeId, DepartmentId FROM InvRequisitions WHERE Id = @id', { id });
  if (!req || (employeeId !== undefined && req.EmployeeId !== employeeId)) throw new UserError('Requisition not found.', 404);
  if (employeeId === undefined) assertDept(req.DepartmentId);
  const allowed = employeeId !== undefined ? ['Pending'] : ['Pending', 'Approved', 'PartIssued'];
  if (!allowed.includes(req.Status)) throw new UserError(`A ${req.Status.toLowerCase()} requisition cannot be cancelled.`);
  await exec(`UPDATE InvRequisitions SET Status = @s, DecidedBy = COALESCE(DecidedBy, @by), DecidedOn = COALESCE(DecidedOn, LOCALTIMESTAMP),
    DecisionNote = COALESCE(DecisionNote, 'Cancelled') WHERE Id = @id`, { s: req.Status === 'PartIssued' ? 'Issued' : 'Cancelled', by, id });
  await resolve([`req-new:${id}`, `req-wait:${id}`, `req-can:${id}`]);
  return `${req.ReqNo} cancelled.`;
}

/** Issues what is still pending on an approved requisition (Lines [{ LineId, Qty }] = only these). */
export async function issueRequisition(id: number, b: { Lines?: unknown; Note?: unknown; LocationId?: unknown }, by: string) {
  const req = (await requisitionsById([id]))[0];
  if (!req) throw new UserError('Requisition not found.', 404);
  if (!['Approved', 'PartIssued'].includes(req.Status)) throw new UserError(req.Status === 'Pending' ? 'Approve the requisition first.' : `This requisition is ${req.Status.toLowerCase()}.`);
  const wanted = Array.isArray(b.Lines) ? new Map((b.Lines as any[]).map((l) => [Number(l.LineId), qty(l.Qty, 'quantity', false)])) : null;
  const out = req.Lines.map((l: any) => ({ lineId: l.Id as number, itemId: l.ItemId as number, qty: Math.min(l.Pending, wanted ? wanted.get(l.Id) ?? 0 : l.Pending) }))
    .filter((l: any) => l.qty > 0);
  if (wanted) for (const l of req.Lines) if ((wanted.get(l.Id) ?? 0) > l.Pending + 1e-9) throw new UserError(`${l.Code} ${l.Name}: only ${qtyText(l.Pending)} ${l.Unit} still to issue.`);
  if (!out.length) throw new UserError('Nothing to issue.');
  return issue({
    EmployeeId: req.EmployeeId, DepartmentId: req.DepartmentId, WarehouseId: req.WarehouseId, Note: b.Note ?? req.Purpose, requisitionId: id, LocationId: b.LocationId,
    siteOf: req.SiteId || req.SiteName ? { Id: req.SiteId ?? null, Name: req.Site || req.SiteName || null } : null,
    Lines: out.map((l: any) => ({ ItemId: l.itemId, Qty: l.qty, reqLineId: l.lineId })),
  }, by);
}

/**
 * The AutoIssue setting: an approved requisition is issued at once when every pending line is in stock. Returns a
 * message, '' when nothing was issued (setting off, not enough stock: the store then gets "can issue" later).
 */
export async function autoIssue(id: number): Promise<string> {
  if ((await getSetting('AutoIssue')) !== '1') return '';
  const req = (await requisitionsById([id]))[0];
  if (!req || !['Approved', 'PartIssued'].includes(req.Status)) return '';
  if (req.Lines.some((l: any) => l.Pending > Number(l.InStock))) return '';
  try {
    const r = await issueRequisition(id, {}, 'Auto issue');
    return r.message;
  } catch (e: any) {
    if (e instanceof UserError) return '';
    throw e;
  }
}

// ------------------------------------------------------------------ issues

export interface IssueInput {
  EmployeeId?: unknown; DepartmentId?: unknown; WarehouseId?: unknown; SiteId?: unknown; Note?: unknown; Lines?: unknown;
  /** Location the goods are taken from (also per line); empty = where they lie (RECEIVING first, then the fullest). */
  LocationId?: unknown;
  /** set by issueRequisition */
  requisitionId?: number;
  /** set by issueRequisition: the requisition's site (kept even when the site was made inactive meanwhile; null = none) */
  siteOf?: { Id: number | null; Name: string | null } | null;
}

/** Issue slip: stock goes out at the average cost; returnable items get a due date (item's return days). */
export async function issue(b: IssueInput, by: string) {
  const items = lines(b.Lines);
  const reqLine = new Map((b.Lines as any[]).map((l) => [Number(l.ItemId), l.reqLineId as number | undefined]));
  const dueOverride = new Map((b.Lines as any[]).filter((l) => l.DueDate).map((l) => [Number(l.ItemId), mustParse(String(l.DueDate), 'due date')]));
  const r = await transaction(async (tx) => {
    const e = await employee(b.EmployeeId, tx);
    const dept = idOrNull(b.DepartmentId) ?? e.DepartmentId;
    assertDept(dept);
    const w = await one('SELECT Id FROM InvWarehouses WHERE Id = @id AND IsActive', { id: Number(b.WarehouseId) || 0 }, tx);
    if (!w) throw new UserError('Choose the store the goods come from.');
    const info = new Map((await query('SELECT Id, IsReturnable, ReturnDays, IsActive, Name, TrackBy FROM InvItems WHERE Id = ANY(@ids)', { ids: items.map((l) => l.itemId) }, tx)).map((i) => [i.Id as number, i]));
    const ws = b.siteOf !== undefined ? b.siteOf : await site(b.SiteId, tx);
    const adding = await entriesOf(items, !!ws?.Name, tx);
    if (adding) await assertBinRoom(e.Id, `${e.EnrollNo} ${e.Name}`, adding, tx);
    const no = await nextNo('ISS', tx);
    const id = (await one(`INSERT INTO InvIssues (IssueNo, RequisitionId, EmployeeId, EmployeeName, DepartmentId, WarehouseId, SiteId, SiteName, IssuedBy, Note)
      VALUES (@no, @r, @e, @en, @d, @w, @si, @sn, @by, @n) RETURNING Id`,
    { no, r: b.requisitionId ?? null, e: e.Id, en: e.Name, d: dept, w: w.Id, si: ws?.Id ?? null, sn: ws?.Name ?? null, by, n: text(b.Note, 300) }, tx))!.Id as number;
    for (const l of items) {
      const it = info.get(l.itemId);
      if (!it) throw new UserError('An item does not exist.');
      const mv: Move = { itemId: l.itemId, warehouseId: w.Id, type: 'Issue', qty: -l.qty, refType: 'Issue', refId: id, refNo: no, employeeId: e.Id, departmentId: dept,
        note: `${e.EnrollNo} ${e.Name}${ws?.Name ? ` for site ${ws.Name}` : ''}`, by, units: unitsOf(b.Lines, l.itemId), locationId: lineLoc(b, l.itemId, 'LocationId') };
      const cost = await post(mv, tx);
      const due = it.IsReturnable ? dueOverride.get(l.itemId) ?? (it.ReturnDays > 0 ? addDays(today(), it.ReturnDays) : null) : null;
      const lineId = (await one('INSERT INTO InvIssueLines (IssueId, ItemId, Qty, UnitCost, DueDate) VALUES (@i, @it, @q, @c, CAST(@due AS date)) RETURNING Id',
        { i: id, it: l.itemId, q: l.qty, c: cost, due: due === null ? null : sqlD(due) }, tx))!.Id as number;
      if (mv.picked?.length) {
        await exec('INSERT INTO InvIssueUnits (IssueLineId, UnitId) SELECT @l, u FROM unnest(CAST(@ids AS int[])) u', { l: lineId, ids: mv.picked }, tx);
        await exec(`UPDATE InvUnits SET IssueLineId = @l, EmployeeId = @e, SiteId = @si, SiteName = @sn, UpdatedAt = LOCALTIMESTAMP WHERE Id = ANY(@ids)`,
          { l: lineId, e: e.Id, si: ws?.Id ?? null, sn: ws?.Name ?? null, ids: mv.picked }, tx);
        await logUnits(mv.picked, { event: 'Issued', refNo: no, warehouseId: w.Id, employeeId: e.Id, employeeName: e.Name, siteName: ws?.Name ?? null, by }, tx);
      }
      const rl = reqLine.get(l.itemId);
      if (rl) await exec('UPDATE InvRequisitionLines SET IssuedQty = IssuedQty + @q WHERE Id = @id', { q: l.qty, id: rl }, tx);
    }
    if (b.requisitionId) {
      const left = await one('SELECT COUNT(*) c FROM InvRequisitionLines WHERE RequisitionId = @id AND IssuedQty < Qty', { id: b.requisitionId }, tx);
      await exec('UPDATE InvRequisitions SET Status = @s WHERE Id = @id', { s: left!.c ? 'PartIssued' : 'Issued', id: b.requisitionId }, tx);
      await resolve([`req-can:${b.requisitionId}`], tx);
    }
    return { id, no, employee: e, site: ws?.Name ?? null };
  });
  await notify(r.employee.Id, `Items issued to you (${r.no})`, `${items.length} item(s) from the store${r.site ? ` for site ${r.site}` : ''}.`, 'store');
  await afterStockChange(items.map((l) => l.itemId));
  return { id: r.id, message: `Issue ${r.no} saved.` };
}

export async function issues(f: { from: string; to: string; employeeId?: number | null; departmentId?: number | null; siteId?: number | null }) {
  const from = mustParse(f.from), to = mustParse(f.to);
  const sc = scopeDepartments();
  const rows = await query(`SELECT s.Id, s.IssueNo, s.RequisitionId, r.ReqNo, s.EmployeeId, COALESCE(e.Name, s.EmployeeName) AS Employee, e.EnrollNo,
      s.DepartmentId, COALESCE(d.Name, '') AS Department, w.Name AS Warehouse, s.SiteId, COALESCE(ws.Name, s.SiteName, '') AS Site,
      to_char(s.IssuedOn, 'YYYY-MM-DD HH24:MI') AS IssuedOn, s.IssuedBy, COALESCE(s.Note, '') AS Note
    FROM InvIssues s LEFT JOIN InvRequisitions r ON r.Id = s.RequisitionId LEFT JOIN DirEmployees e ON e.Id = s.EmployeeId
      LEFT JOIN DirDepartments d ON d.Id = s.DepartmentId JOIN InvWarehouses w ON w.Id = s.WarehouseId LEFT JOIN DirSites ws ON ws.Id = s.SiteId
    WHERE s.IssuedOn >= CAST(@f AS timestamp) AND s.IssuedOn < CAST(@t AS timestamp)
      AND (CAST(@e AS int) IS NULL OR s.EmployeeId = @e) AND (CAST(@d AS int) IS NULL OR s.DepartmentId = @d)
      AND (CAST(@si AS int) IS NULL OR s.SiteId = @si) AND (CAST(@ds AS int[]) IS NULL OR s.DepartmentId = ANY(@ds))
    ORDER BY s.Id DESC LIMIT 2000`, { f: sqlD(from), t: sqlD(addDays(to, 1)), e: f.employeeId ?? null, d: f.departmentId ?? null, si: f.siteId ?? null, ds: sc ? [...sc] : null });
  const ids = rows.map((r) => r.Id as number);
  const lns = ids.length ? await issueLines(ids) : [];
  return rows.map((r) => {
    const l = lns.filter((x) => x.IssueId === r.Id);
    const forSite = !!r.Site;
    return { ...r, ReqNo: r.ReqNo ?? '', Lines: l, Value: round2(l.reduce((a, x) => a + x.Qty * x.UnitCost, 0)), Outstanding: l.some((x) => x.Outstanding > 0),
      ForSite: forSite, AtSite: forSite && l.some((x) => x.Open > 0) };
  });
}

/**
 * Lines of issues. Open = neither given back nor installed at a site (for a site issue: still at the site);
 * Outstanding = open and returnable (the employee holds it).
 */
async function issueLines(ids: number[], tx?: Tx) {
  const t = today();
  const rows = await query(`SELECT l.Id, l.IssueId, l.ItemId, i.Code, i.Name, i.Unit, i.IsReturnable, i.TrackBy, l.Qty, l.UnitCost, l.ReturnedQty, l.ConsumedQty,
      to_char(l.DueDate, 'YYYY-MM-DD') AS DueDate,
      COALESCE((SELECT string_agg(lc.Code || ' ×' || rtrim(to_char(-m.Qty, 'FM999999990.###'), '.'), ', ' ORDER BY lc.Code)
        FROM InvMovements m JOIN InvLocations lc ON lc.Id = m.LocationId
        WHERE m.RefType = 'Issue' AND m.RefId = l.IssueId AND m.ItemId = l.ItemId AND m.Type = 'Issue'), '') AS PickedFrom
    FROM InvIssueLines l JOIN InvItems i ON i.Id = l.ItemId WHERE l.IssueId = ANY(@ids) ORDER BY l.Id`, { ids }, tx);
  const units = await openUnitsOf(rows.filter((l) => l.TrackBy === 'Serial').map((l) => l.Id as number), tx);
  return rows.map((l) => {
    const open = Math.max(0, Number(l.Qty) - Number(l.ReturnedQty) - Number(l.ConsumedQty));
    const outstanding = l.IsReturnable ? open : 0;
    return { ...l, IsReturnable: !!l.IsReturnable, DueDate: l.DueDate ?? '', Qty: Number(l.Qty), UnitCost: Number(l.UnitCost), ReturnedQty: Number(l.ReturnedQty),
      ConsumedQty: Number(l.ConsumedQty), Open: open, Outstanding: outstanding, Overdue: outstanding > 0 && !!l.DueDate && mustParse(l.DueDate) < t,
      Units: units.filter((u) => u.IssueLineId === l.Id).map((u) => ({ Id: u.Id as number, SerialNo: u.SerialNo as string, Tag: u.Tag as string, Status: u.Status as string })) };
  });
}

/**
 * Items given back: Lines [{ LineId, Qty, Condition: Good | Damaged | Lost }]. Good goes back into stock at the issue cost;
 * damaged / lost only close the line (the note says why) so the employee no longer holds it.
 */
export async function returnItems(issueId: number, b: { Lines?: unknown; Note?: unknown; LocationId?: unknown }, by: string) {
  if (!Array.isArray(b.Lines)) throw new UserError('Enter the quantities given back.');
  const input = (b.Lines as any[]).filter((l) => Number(l.Qty) > 0 || (Array.isArray(l.Units) && l.Units.length)).map((l) => {
    const units = Array.isArray(l.Units) && l.Units.length ? (l.Units as unknown[]).map(Number) : undefined;
    return {
      lineId: Number(l.LineId), qty: units ? units.length : qty(l.Qty), units,
      condition: (['Good', 'Damaged', 'Lost'].includes(l.Condition) ? l.Condition : 'Good') as 'Good' | 'Damaged' | 'Lost',
    };
  });
  if (!input.length) throw new UserError('Enter the quantity given back of at least one item.');
  const r = await transaction(async (tx) => {
    const s = await one('SELECT Id, IssueNo, EmployeeId, DepartmentId, WarehouseId FROM InvIssues WHERE Id = @id FOR UPDATE', { id: issueId }, tx);
    if (!s) throw new UserError('Issue not found.', 404);
    assertDept(s.DepartmentId);
    const lns = new Map((await issueLines([issueId], tx)).map((l) => [l.Id as number, l]));
    for (const l of input) {
      const il = lns.get(l.lineId);
      if (!il) throw new UserError('A line is not on this issue.');
      const open = il.Open;
      if (l.qty > open + 1e-9) throw new UserError(`${il.Code} ${il.Name}: only ${qtyText(open)} ${il.Unit} can come back${il.ConsumedQty ? ' (the rest is installed at the site)' : ''}.`);
      await exec('UPDATE InvIssueLines SET ReturnedQty = ReturnedQty + @q WHERE Id = @id', { q: l.qty, id: l.lineId }, tx);
      const note = `${l.condition === 'Good' ? 'Returned' : `${l.condition} ${qtyText(l.qty)} ${il.Unit}`} (${s.IssueNo})${b.Note ? ': ' + String(b.Note).slice(0, 200) : ''}`;
      const units = il.TrackBy === 'Serial' ? await closeLineUnits(l.lineId, l.qty, l.units, l.condition === 'Good' ? 'Returned' : l.condition, tx) : undefined;
      if (units && l.condition !== 'Good') {
        await exec(`UPDATE InvUnits SET Status = @s, EmployeeId = NULL, UpdatedAt = LOCALTIMESTAMP WHERE Id = ANY(@ids)`, { s: l.condition, ids: units }, tx);
        await logUnits(units, { event: l.condition, refNo: s.IssueNo, employeeId: s.EmployeeId, note: b.Note ? String(b.Note) : null, by }, tx);
      }
      if (l.condition === 'Good')
        await post({ itemId: il.ItemId, warehouseId: s.WarehouseId, type: 'Return', qty: l.qty, unitCost: il.UnitCost, refType: 'Issue', refId: issueId, refNo: s.IssueNo,
          employeeId: s.EmployeeId, departmentId: s.DepartmentId, note, by, units, locationId: Number(b.LocationId) || null }, tx);
      else
        await exec(`INSERT INTO InvMovements (ItemId, WarehouseId, Type, Qty, UnitCost, BalanceAfter, RefType, RefId, RefNo, EmployeeId, DepartmentId, Note, CreatedBy)
          VALUES (@i, @w, 'Return', 0, @c, COALESCE((SELECT Qty FROM InvStock WHERE ItemId = @i AND WarehouseId = @w), 0), 'Issue', @r, @rn, @e, @d, @n, @by)`,
        { i: il.ItemId, w: s.WarehouseId, c: il.UnitCost, r: issueId, rn: s.IssueNo, e: s.EmployeeId, d: s.DepartmentId, n: note, by }, tx);
      if (l.qty >= open - 1e-9) await resolve([`overdue:${l.lineId}`], tx);
    }
    return s;
  });
  if (r.EmployeeId && !(await one(`SELECT 1 FROM InvIssueLines l JOIN InvIssues s ON s.Id = l.IssueId JOIN InvItems i ON i.Id = l.ItemId
    WHERE s.EmployeeId = @e AND i.IsReturnable AND l.ReturnedQty + l.ConsumedQty < l.Qty LIMIT 1`, { e: r.EmployeeId }))) await resolve([`exit:${r.EmployeeId}`]);
  return `Return on ${r.IssueNo} saved.`;
}

/** Returnable items still with employees (who holds what, since when, due when). */
export async function holdings(f: { employeeId?: number | null; overdueOnly?: boolean } = {}) {
  const sc = scopeDepartments();
  const t = today();
  const rows = await query(`SELECT l.Id AS LineId, s.Id AS IssueId, s.IssueNo, to_char(s.IssuedOn, 'YYYY-MM-DD') AS IssuedOn, s.EmployeeId,
      COALESCE(e.Name, s.EmployeeName) AS Employee, e.EnrollNo, COALESCE(e.IsActive, FALSE) AS EmployeeActive, s.DepartmentId, COALESCE(d.Name, '') AS Department,
      i.Code, i.Name AS Item, i.Unit, l.Qty - l.ReturnedQty - l.ConsumedQty AS Qty, l.UnitCost, to_char(l.DueDate, 'YYYY-MM-DD') AS DueDate,
      COALESCE(ws.Name, s.SiteName, '') AS Site
    FROM InvIssueLines l JOIN InvIssues s ON s.Id = l.IssueId JOIN InvItems i ON i.Id = l.ItemId
      LEFT JOIN DirEmployees e ON e.Id = s.EmployeeId LEFT JOIN DirDepartments d ON d.Id = s.DepartmentId LEFT JOIN DirSites ws ON ws.Id = s.SiteId
    WHERE i.IsReturnable AND l.ReturnedQty + l.ConsumedQty < l.Qty AND (CAST(@e AS int) IS NULL OR s.EmployeeId = @e)
      AND (CAST(@ds AS int[]) IS NULL OR s.DepartmentId = ANY(@ds))
    ORDER BY l.DueDate NULLS LAST, s.IssuedOn`, { e: f.employeeId ?? null, ds: sc ? [...sc] : null });
  const out = rows.map((r) => {
    const overdueDays = r.DueDate ? Math.round((t - mustParse(r.DueDate)) / 86_400_000) : 0;
    return { ...r, EmployeeActive: !!r.EmployeeActive, DueDate: r.DueDate ?? '', Qty: Number(r.Qty), Value: round2(Number(r.Qty) * Number(r.UnitCost)), OverdueDays: Math.max(0, overdueDays) };
  });
  return f.overdueOnly ? out.filter((r) => r.OverdueDays > 0) : out;
}

// ------------------------------------------------------------------ work sites

/**
 * Installed / used at the site: Lines [{ LineId, Qty }] of a site issue. The stock left the store with the issue, so
 * only the line (ConsumedQty) and the site's usage register (InvSiteUsage) change. employeeId: from the portal / app,
 * only on the employee's own issues.
 */
export async function consume(issueId: number, b: { Lines?: unknown; UsedOn?: unknown; Note?: unknown }, by: string, employeeId?: number) {
  if (!Array.isArray(b.Lines)) throw new UserError('Enter the quantities installed at the site.');
  const input = (b.Lines as any[]).filter((l) => Number(l.Qty) > 0 || (Array.isArray(l.Units) && l.Units.length)).map((l) => {
    const units = Array.isArray(l.Units) && l.Units.length ? (l.Units as unknown[]).map(Number) : undefined;
    return { lineId: Number(l.LineId), qty: units ? units.length : qty(l.Qty), units };
  });
  if (!input.length) throw new UserError('Enter the quantity installed of at least one item.');
  const usedOn = b.UsedOn ? mustParse(String(b.UsedOn), 'date') : today();
  if (usedOn > today()) throw new UserError('The date cannot be in the future.');
  const note = text(b.Note, 300);
  const s = await transaction(async (tx) => {
    const s = await one('SELECT Id, IssueNo, EmployeeId, DepartmentId, SiteId, SiteName FROM InvIssues WHERE Id = @id FOR UPDATE', { id: issueId }, tx);
    if (!s || (employeeId !== undefined && s.EmployeeId !== employeeId)) throw new UserError('Issue not found.', 404);
    if (employeeId === undefined) assertDept(s.DepartmentId);
    if (!s.SiteId && !s.SiteName) throw new UserError(`${s.IssueNo} is not for a work site.`);
    const lns = new Map((await issueLines([issueId], tx)).map((l) => [l.Id as number, l]));
    for (const l of input) {
      const il = lns.get(l.lineId);
      if (!il) throw new UserError('A line is not on this issue.');
      if (l.qty > il.Open + 1e-9) throw new UserError(`${il.Code} ${il.Name}: only ${qtyText(il.Open)} ${il.Unit} is still at the site.`);
      await exec('UPDATE InvIssueLines SET ConsumedQty = ConsumedQty + @q WHERE Id = @id', { q: l.qty, id: l.lineId }, tx);
      if (il.TrackBy === 'Serial') {
        const units = await closeLineUnits(l.lineId, l.qty, l.units, 'Installed', tx);
        await exec(`UPDATE InvUnits SET Status = 'Installed', EmployeeId = NULL, SiteId = @si, SiteName = @sn, UpdatedAt = LOCALTIMESTAMP WHERE Id = ANY(@ids)`,
          { si: s.SiteId, sn: s.SiteName, ids: units }, tx);
        await logUnits(units, { event: 'Installed', refNo: s.IssueNo, employeeId: s.EmployeeId, siteName: s.SiteName, note, by }, tx);
      }
      await exec(`INSERT INTO InvSiteUsage (IssueLineId, IssueId, SiteId, SiteName, ItemId, Qty, UnitCost, UsedOn, Note, RecordedBy)
        VALUES (@l, @i, @si, @sn, @it, @q, @c, CAST(@d AS date), @n, @by)`,
      { l: l.lineId, i: issueId, si: s.SiteId, sn: s.SiteName, it: il.ItemId, q: l.qty, c: il.UnitCost, d: sqlD(usedOn), n: note, by }, tx);
      if (l.qty >= il.Open - 1e-9) await resolve([`overdue:${l.lineId}`], tx);
    }
    return s;
  });
  if (s.EmployeeId && !(await one(`SELECT 1 FROM InvIssueLines l JOIN InvIssues s ON s.Id = l.IssueId JOIN InvItems i ON i.Id = l.ItemId
    WHERE s.EmployeeId = @e AND i.IsReturnable AND l.ReturnedQty + l.ConsumedQty < l.Qty LIMIT 1`, { e: s.EmployeeId }))) await resolve([`exit:${s.EmployeeId}`]);
  return `Installed at ${s.SiteName ?? 'the site'} saved (${s.IssueNo}).`;
}

/** Material per site and item: issued for the site, installed there, given back, still at the site. */
export async function siteStock(f: { siteId?: number | null; openOnly?: boolean } = {}) {
  const sc = scopeDepartments();
  const rows = await query(`SELECT s.SiteId, COALESCE(ws.Name, s.SiteName) AS Site, i.Id AS ItemId, i.Code, i.Name, i.Unit,
      SUM(l.Qty) AS Issued, SUM(l.ConsumedQty) AS Installed, SUM(l.ReturnedQty) AS Returned, SUM(l.Qty - l.ReturnedQty - l.ConsumedQty) AS AtSite,
      SUM(l.ConsumedQty * l.UnitCost) AS InstalledValue, SUM((l.Qty - l.ReturnedQty - l.ConsumedQty) * l.UnitCost) AS AtSiteValue,
      to_char(MAX(s.IssuedOn), 'YYYY-MM-DD') AS LastIssued
    FROM InvIssueLines l JOIN InvIssues s ON s.Id = l.IssueId JOIN InvItems i ON i.Id = l.ItemId LEFT JOIN DirSites ws ON ws.Id = s.SiteId
    WHERE (s.SiteId IS NOT NULL OR s.SiteName IS NOT NULL) AND (CAST(@si AS int) IS NULL OR s.SiteId = @si)
      AND (CAST(@ds AS int[]) IS NULL OR s.DepartmentId = ANY(@ds))
    GROUP BY s.SiteId, COALESCE(ws.Name, s.SiteName), i.Id, i.Code, i.Name, i.Unit
    ORDER BY 2, i.Name`, { si: f.siteId ?? null, ds: sc ? [...sc] : null });
  const out = rows.map((r) => ({
    ...r, Issued: Number(r.Issued), Installed: Number(r.Installed), Returned: Number(r.Returned), AtSite: Number(r.AtSite),
    InstalledValue: round2(Number(r.InstalledValue)), AtSiteValue: round2(Number(r.AtSiteValue)),
  }));
  return f.openOnly ? out.filter((r) => r.AtSite > 0) : out;
}

/** Everything that happened at the sites: issued for, installed at, given back from (damaged / lost: quantity in the note). */
export async function siteRegister(f: { from: string; to: string; siteId?: number | null; employeeId?: number | null }) {
  const from = mustParse(f.from), to = mustParse(f.to);
  const sc = scopeDepartments();
  const rows = await query(`SELECT x.*, to_char(x.At, CASE WHEN x.Kind = 'Installed' THEN 'YYYY-MM-DD' ELSE 'YYYY-MM-DD HH24:MI' END) AS AtText FROM (
      SELECT s.IssuedOn AS At, 'Issued' AS Kind, s.Id AS IssueId, s.IssueNo, s.SiteId, COALESCE(ws.Name, s.SiteName) AS Site, s.EmployeeId, s.DepartmentId,
        l.ItemId, l.Qty, l.Qty * l.UnitCost AS Value, s.IssuedBy AS ByWhom, COALESCE(s.Note, '') AS Note
      FROM InvIssueLines l JOIN InvIssues s ON s.Id = l.IssueId LEFT JOIN DirSites ws ON ws.Id = s.SiteId
      WHERE s.SiteId IS NOT NULL OR s.SiteName IS NOT NULL
      UNION ALL
      SELECT CAST(u.UsedOn AS timestamp), 'Installed', s.Id, s.IssueNo, s.SiteId, COALESCE(ws.Name, u.SiteName, s.SiteName), s.EmployeeId, s.DepartmentId,
        u.ItemId, u.Qty, u.Qty * u.UnitCost, u.RecordedBy, COALESCE(u.Note, '')
      FROM InvSiteUsage u JOIN InvIssues s ON s.Id = u.IssueId LEFT JOIN DirSites ws ON ws.Id = s.SiteId
      UNION ALL
      SELECT m.At, 'Returned', s.Id, s.IssueNo, s.SiteId, COALESCE(ws.Name, s.SiteName), s.EmployeeId, s.DepartmentId,
        m.ItemId, m.Qty, m.Qty * m.UnitCost, m.CreatedBy, COALESCE(m.Note, '')
      FROM InvMovements m JOIN InvIssues s ON s.Id = m.RefId LEFT JOIN DirSites ws ON ws.Id = s.SiteId
      WHERE m.RefType = 'Issue' AND m.Type = 'Return' AND (s.SiteId IS NOT NULL OR s.SiteName IS NOT NULL)
    ) x
    WHERE x.At >= CAST(@f AS timestamp) AND x.At < CAST(@t AS timestamp) AND (CAST(@si AS int) IS NULL OR x.SiteId = @si)
      AND (CAST(@e AS int) IS NULL OR x.EmployeeId = @e) AND (CAST(@ds AS int[]) IS NULL OR x.DepartmentId = ANY(@ds))
    ORDER BY x.At, x.IssueNo`, { f: sqlD(from), t: sqlD(addDays(to, 1)), si: f.siteId ?? null, e: f.employeeId ?? null, ds: sc ? [...sc] : null });
  if (!rows.length) return [];
  const emps = new Map((await query('SELECT Id, EnrollNo, Name FROM DirEmployees WHERE Id = ANY(@ids)', { ids: [...new Set(rows.map((r) => r.EmployeeId).filter(Boolean))] }))
    .map((e) => [e.Id as number, e]));
  const names = new Map((await query('SELECT Id, Code, Name, Unit FROM InvItems WHERE Id = ANY(@ids)', { ids: [...new Set(rows.map((r) => r.ItemId))] })).map((i) => [i.Id as number, i]));
  const docs = new Map((await query('SELECT Id, EmployeeName FROM InvIssues WHERE Id = ANY(@ids)', { ids: [...new Set(rows.map((r) => r.IssueId))] })).map((d) => [d.Id as number, d.EmployeeName]));
  return rows.map((r) => {
    const e = emps.get(r.EmployeeId), it = names.get(r.ItemId);
    return {
      At: r.AtText as string, Kind: r.Kind as string, IssueId: r.IssueId as number, IssueNo: r.IssueNo as string,
      Site: r.Site as string, EnrollNo: e?.EnrollNo ?? '', Employee: e?.Name ?? docs.get(r.IssueId) ?? '', Code: it?.Code ?? '', Item: it?.Name ?? '', Unit: it?.Unit ?? '',
      Qty: Number(r.Qty), Value: round2(Number(r.Value)), By: r.ByWhom ?? '', Note: r.Note as string,
    };
  });
}

// ------------------------------------------------------------------ employee portal

/** Items an employee may ask for: active ones, whether the store has them (no costs); the work sites they work at. */
export async function catalog(employeeId: number) {
  const w = await defaultWarehouse().catch(() => null);
  const items = await query(`SELECT i.Id, i.Code, i.Name, i.Unit, i.IsReturnable, c.Name AS Category, COALESCE(SUM(s.Qty), 0) AS Qty
    FROM InvItems i LEFT JOIN InvCategories c ON c.Id = i.CategoryId LEFT JOIN InvStock s ON s.ItemId = i.Id
    WHERE i.IsActive GROUP BY i.Id, c.Name ORDER BY i.Name`);
  return {
    warehouseId: w,
    warehouses: await query('SELECT Id, Name FROM InvWarehouses WHERE IsActive ORDER BY Name'),
    sites: (await sitesOf(employeeId)).map((s) => ({ Id: s.Id, Name: s.Name })),
    items: items.map((i) => ({ Id: i.Id, Code: i.Code, Name: i.Name, Unit: i.Unit, Category: i.Category ?? '', IsReturnable: !!i.IsReturnable, InStock: Number(i.Qty) > 0 })),
  };
}

export async function myRequisitions(employeeId: number) {
  const ids = (await query('SELECT Id FROM InvRequisitions WHERE EmployeeId = @e ORDER BY Id DESC LIMIT 200', { e: employeeId })).map((r) => r.Id as number);
  if (!ids.length) return [];
  return (await requisitionsById(ids)).sort((a, b) => b.Id - a.Id).map((r) => ({
    Id: r.Id, ReqNo: r.ReqNo, CreatedAt: r.CreatedAt, Status: r.Status, Purpose: r.Purpose ?? '', Warehouse: r.Warehouse, Site: r.Site, DecisionNote: r.DecisionNote ?? '',
    Lines: r.Lines.map((l: any) => ({ Code: l.Code, Name: l.Name, Unit: l.Unit, Qty: Number(l.Qty), IssuedQty: Number(l.IssuedQty) })),
  }));
}

/** Site material the employee still has at a site (to record what was installed there from the portal / app). */
export async function mySiteMaterial(employeeId: number) {
  const ids = (await query(`SELECT DISTINCT l.IssueId FROM InvIssueLines l JOIN InvIssues s ON s.Id = l.IssueId
    WHERE s.EmployeeId = @e AND (s.SiteId IS NOT NULL OR s.SiteName IS NOT NULL) AND l.ReturnedQty + l.ConsumedQty < l.Qty`, { e: employeeId })).map((r) => r.IssueId as number);
  if (!ids.length) return [];
  const docs = await query(`SELECT s.Id, s.IssueNo, to_char(s.IssuedOn, 'YYYY-MM-DD') AS IssuedOn, COALESCE(ws.Name, s.SiteName) AS Site
    FROM InvIssues s LEFT JOIN DirSites ws ON ws.Id = s.SiteId WHERE s.Id = ANY(@ids) ORDER BY s.Id DESC`, { ids });
  const lns = await issueLines(ids);
  return docs.map((d) => ({
    ...d, Lines: lns.filter((l) => l.IssueId === d.Id && l.Open > 0)
      .map((l) => ({ LineId: l.Id, Code: l.Code, Name: l.Name, Unit: l.Unit, Qty: l.Qty, Installed: l.ConsumedQty, Returned: l.ReturnedQty, Open: l.Open })),
  }));
}

// ------------------------------------------------------------------ scan station

/**
 * Giving back by scanning: a unit's tag / serial returns that unit from whoever holds it; an item's barcode / code takes
 * `Qty` back from the employee's bin (oldest issue first). Condition Good puts it back in stock.
 */
export async function scanReturn(b: { Code?: unknown; EmployeeId?: unknown; Qty?: unknown; Condition?: unknown; Note?: unknown; LocationId?: unknown }, by: string) {
  const found = await resolveCode(String(b.Code ?? ''));
  const condition = ['Good', 'Damaged', 'Lost'].includes(String(b.Condition)) ? String(b.Condition) : 'Good';
  if (found.kind === 'employee') return { scan: found, message: `Bin ${found.employee.Bin} — ${found.employee.Name}: now scan the items.` };
  if (found.kind === 'location') return { scan: found, message: `Goods now go back to ${found.location.Code}.` };
  if (found.kind === 'unit') {
    const u = found.unit;
    if (u.Status !== 'Issued' || !u.IssueId) throw new UserError(`${u.Code} ${u.SerialNo} is ${u.Status === 'InStore' ? 'in the store already' : u.Status.toLowerCase()}, not out with anybody.`);
    await returnItems(u.IssueId, { Note: b.Note, LocationId: b.LocationId, Lines: [{ LineId: u.IssueLineId, Units: [u.Id], Condition: condition }] }, by);
    return { scan: found, message: `${u.Code} ${u.SerialNo} back from ${u.EnrollNo} ${u.Employee}${condition === 'Good' ? '' : ` (${condition.toLowerCase()})`}.` };
  }
  const it = found.item;
  if (it.TrackBy === 'Serial') throw new UserError(`${it.Name} is tracked by serial: scan the tag of the unit.`);
  const empId = idOrNull(b.EmployeeId);
  if (!empId) throw new UserError('Scan the bin / employee card first, then the item.');
  let left = qty(b.Qty ?? 1);
  const open = await openLinesOf(empId, it.Id);
  const have = open.reduce((a, l) => a + Number(l.Open), 0);
  if (left > have + 1e-9) throw new UserError(`The bin has only ${qtyText(have)} ${it.Unit} of ${it.Name}.`);
  const byIssue = new Map<number, { LineId: number; Qty: number; Condition: string }[]>();
  for (const l of open) {
    if (left <= 1e-9) break;
    const take = Math.min(left, Number(l.Open));
    left = Math.round((left - take) * 1000) / 1000;
    byIssue.set(l.IssueId, [...(byIssue.get(l.IssueId) ?? []), { LineId: l.LineId, Qty: take, Condition: condition }]);
  }
  for (const [issueId, lns] of byIssue) await returnItems(issueId, { Note: b.Note, LocationId: b.LocationId, Lines: lns }, by);
  return { scan: found, message: `${qtyText(qty(b.Qty ?? 1))} ${it.Unit} ${it.Name} back${condition === 'Good' ? ' in stock' : ` (${condition.toLowerCase()})`}.` };
}
