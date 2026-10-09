import type { Request, Response } from 'express';
import { one, query, transaction } from '../db';
import { INVENTORY_TABLES } from './schema';
import * as exporter from '../export';
import { HEADS } from '../gateway';
import { UserError } from '../utils/errors';
import { bodyIds, idParam, numQuery, sendFile } from '../utils/http';
import { fmt, now, today } from '../utils/time';
import * as auto from './services/automation.service';
import * as bins from './services/bin.service';
import * as common from './services/common.service';
import * as issues from './services/issue.service';
import * as locs from './services/location.service';
import * as masters from './services/masters.service';
import * as purchase from './services/purchase.service';
import * as reports from './services/report.service';
import * as stock from './services/stock.service';
import * as units from './services/unit.service';

const by = (req: Request) => req.user ?? 'Store';
const str = (v: unknown) => (v === undefined ? '' : String(v));
const ok = (res: Response) => res.json({ ok: true });

/** What the logged-in user may do in the inventory (the screens hide the rest). */
export const me = (req: Request, res: Response) => {
  const role = req.role ?? 'Viewer';
  const head = HEADS.includes(role);
  const manage = head || role === 'StoreKeeper';
  res.json({ role, manage, head, approve: head || role === 'HOD', scoped: role === 'HOD' });
};

export const lookups = async (_req: Request, res: Response) => res.json(await masters.lookups());
export async function dashboard(req: Request, res: Response) {
  if (!req.role || req.role !== 'HOD') await auto.maybeRunDaily();
  res.json(await reports.dashboard());
}

// ---- alerts, settings, automation
export const alerts = async (req: Request, res: Response) => res.json(await common.alerts(req.query.all === '1'));
export async function markAlerts(req: Request, res: Response) {
  await common.markAlerts(req.body?.ids === 'all' ? 'all' : bodyIds(req), !!req.body?.dismiss);
  ok(res);
}
export const settings = async (_req: Request, res: Response) => res.json(await common.getSettings());
export async function saveSettings(req: Request, res: Response) {
  await common.saveSettings(req.body ?? {});
  res.json(await common.getSettings());
}
export const runChecks = async (_req: Request, res: Response) => res.json(await auto.runDaily());

// ---- masters
export const categories = async (_req: Request, res: Response) => res.json(await masters.categories());
export const saveCategory = async (req: Request, res: Response) => res.json({ id: await masters.saveCategory(req.params.id ? idParam(req) : null, req.body) });
export async function removeCategory(req: Request, res: Response) { await masters.removeCategory(idParam(req)); ok(res); }

export const warehouses = async (_req: Request, res: Response) => res.json(await masters.warehouses());
export const saveWarehouse = async (req: Request, res: Response) => res.json({ id: await masters.saveWarehouse(req.params.id ? idParam(req) : null, req.body) });
export async function removeWarehouse(req: Request, res: Response) { await masters.removeWarehouse(idParam(req)); ok(res); }

export const suppliers = async (_req: Request, res: Response) => res.json(await masters.suppliers());
export const saveSupplier = async (req: Request, res: Response) => res.json({ id: await masters.saveSupplier(req.params.id ? idParam(req) : null, req.body) });
export async function removeSupplier(req: Request, res: Response) { await masters.removeSupplier(idParam(req)); ok(res); }

export const items = async (req: Request, res: Response) => res.json(await stock.balances({
  warehouseId: numQuery(req.query.warehouse), categoryId: numQuery(req.query.category), q: str(req.query.q), status: str(req.query.status),
  includeInactive: req.query.inactive === '1',
}));
export const item = async (req: Request, res: Response) => res.json(await masters.item(idParam(req)));
export const saveItem = async (req: Request, res: Response) => res.json({ id: await masters.saveItem(req.params.id ? idParam(req) : null, req.body, by(req)) });
export async function removeItem(req: Request, res: Response) { await masters.removeItem(idParam(req)); ok(res); }
export async function importItems(req: Request, res: Response) {
  if (!req.file) throw new UserError('Choose the Excel file.');
  res.json({ message: await masters.importItems(req.file.buffer, by(req)) });
}
export const importTemplate = async (_req: Request, res: Response) => sendFile(res, await masters.importTemplate(), 'Inventory_Items_Template.xlsx');

// ---- stock
export const ledger = async (req: Request, res: Response) => res.json(await stock.ledger({
  from: str(req.query.from), to: str(req.query.to), itemId: numQuery(req.query.item), warehouseId: numQuery(req.query.warehouse), type: str(req.query.type),
}));
export const stockDocs = async (req: Request, res: Response) => res.json(await stock.stockDocs(str(req.query.kind)));
export const transfer = async (req: Request, res: Response) => res.json(await stock.transfer(req.body, by(req)));
export const adjust = async (req: Request, res: Response) => res.json(await stock.adjust(req.body, by(req)));
export const count = async (req: Request, res: Response) => res.json(await stock.count(req.body, by(req)));

// ---- requisitions, issues, returns
export const requisitions = async (req: Request, res: Response) => res.json(await issues.requisitions({
  status: str(req.query.status), employeeId: numQuery(req.query.employee), from: str(req.query.from), to: str(req.query.to),
}));
export const requisition = async (req: Request, res: Response) => res.json(await issues.requisition(idParam(req)));
export const createRequisition = async (req: Request, res: Response) => res.json(await issues.createRequisition(req.body, by(req), 'admin'));
export const decide = async (req: Request, res: Response) => res.json({ message: await issues.decide(idParam(req), req.body ?? {}, by(req)) });
export const cancelRequisition = async (req: Request, res: Response) => res.json({ message: await issues.cancelRequisition(idParam(req), by(req)) });
export const issueRequisition = async (req: Request, res: Response) => res.json(await issues.issueRequisition(idParam(req), req.body ?? {}, by(req)));

export const issueList = async (req: Request, res: Response) => res.json(await issues.issues({
  from: str(req.query.from) || fmt(today(), 'yyyy-MM-01'), to: str(req.query.to) || fmt(today(), 'yyyy-MM-dd'),
  employeeId: numQuery(req.query.employee), departmentId: numQuery(req.query.department), siteId: numQuery(req.query.site),
}));
export const issue = async (req: Request, res: Response) => res.json(await issues.issue({ ...req.body, requisitionId: undefined }, by(req)));
export const returnItems = async (req: Request, res: Response) => res.json({ message: await issues.returnItems(idParam(req), req.body ?? {}, by(req)) });
export const consume = async (req: Request, res: Response) => res.json({ message: await issues.consume(idParam(req), req.body ?? {}, by(req)) });
export const siteStock = async (req: Request, res: Response) => res.json(await issues.siteStock({ siteId: numQuery(req.query.site), openOnly: req.query.open === '1' }));
export const siteRegister = async (req: Request, res: Response) => res.json(await issues.siteRegister({
  from: str(req.query.from) || fmt(today(), 'yyyy-MM-01'), to: str(req.query.to) || fmt(today(), 'yyyy-MM-dd'),
  siteId: numQuery(req.query.site), employeeId: numQuery(req.query.employee),
}));
export const holdings = async (req: Request, res: Response) => res.json(await issues.holdings({ employeeId: numQuery(req.query.employee), overdueOnly: req.query.overdue === '1' }));

// ---- employee bins, serial units, scanning
export const binList = async (req: Request, res: Response) => res.json(await bins.bins({ q: str(req.query.q), openOnly: req.query.open === '1' }));
export const bin = async (req: Request, res: Response) => res.json(await bins.bin(idParam(req)));
export async function saveBin(req: Request, res: Response) {
  await bins.saveBin(idParam(req), req.body ?? {}, by(req));
  res.json(await bins.bin(idParam(req)));
}
export const unitList = async (req: Request, res: Response) => res.json(await units.units({
  itemId: numQuery(req.query.item), status: str(req.query.status), warehouseId: numQuery(req.query.warehouse), q: str(req.query.q), untagged: req.query.untagged === '1',
}));
export const unit = async (req: Request, res: Response) => res.json(await units.unit(idParam(req)));
export async function saveUnit(req: Request, res: Response) {
  await transaction((tx) => units.saveUnit(idParam(req), req.body ?? {}, by(req), tx));
  res.json(await units.unit(idParam(req)));
}
export async function tagNext(req: Request, res: Response) {
  const id = await transaction((tx) => units.tagNext(req.body ?? {}, by(req), tx));
  res.json(await units.unit(id));
}
export const scan = async (req: Request, res: Response) => res.json(await bins.resolve(str(req.query.code)));
export const scanReturn = async (req: Request, res: Response) => res.json(await issues.scanReturn(req.body ?? {}, by(req)));

// ---- locations (rack / row / column)
export const locationList = async (req: Request, res: Response) => res.json(await locs.locations({ warehouseId: numQuery(req.query.warehouse), q: str(req.query.q) }));
export const location = async (req: Request, res: Response) => res.json(await locs.location(idParam(req)));
export const createRack = async (req: Request, res: Response) => res.json({ message: await locs.createRack(req.body ?? {}) });
export async function saveLocation(req: Request, res: Response) { await locs.saveLocation(idParam(req), req.body ?? {}); res.json(await locs.location(idParam(req))); }
export async function removeLocation(req: Request, res: Response) { await locs.removeLocation(idParam(req)); ok(res); }
export const moveStock = async (req: Request, res: Response) => res.json(await locs.move(req.body ?? {}, by(req)));
export const whereIs = async (req: Request, res: Response) => res.json(await locs.whereIs(Number(req.query.item) || 0));
export const toPutAway = async (_req: Request, res: Response) => res.json(await locs.toPutAway());

// ---- purchase
export const poList = async (req: Request, res: Response) => res.json(await purchase.list(str(req.query.status)));
export const po = async (req: Request, res: Response) => res.json(await purchase.get(idParam(req)));
export const savePo = async (req: Request, res: Response) => res.json({ id: await purchase.save(req.params.id ? idParam(req) : null, req.body, by(req)) });
export const poStatus = async (req: Request, res: Response) => res.json({ message: await purchase.setStatus(idParam(req), str(req.body?.status)) });
export async function removePo(req: Request, res: Response) { await purchase.remove(idParam(req)); ok(res); }
export const receive = async (req: Request, res: Response) => res.json(await purchase.receive(idParam(req), req.body ?? {}, by(req)));
export async function reorderNow(_req: Request, res: Response) {
  const done = await auto.reorderCheck();
  res.json({ message: done.length ? `Re-order: ${done.join(', ')} made / extended.` : 'Nothing to re-order: every item with a preferred supplier is above its level or on order.' });
}
export const receipts = async (req: Request, res: Response) => res.json(await purchase.receipts(
  str(req.query.from) || fmt(today(), 'yyyy-MM-01'), str(req.query.to) || fmt(today(), 'yyyy-MM-dd')));
export const directReceipt = async (req: Request, res: Response) => res.json(await purchase.directReceipt(req.body, by(req)));

// ---- reports
export const reportList = (_req: Request, res: Response) => res.json(reports.REPORTS);
export const report = async (req: Request, res: Response) => res.json(await reports.report(String(req.params.key), req.query as reports.ReportParams));
export async function reportFile(req: Request, res: Response) {
  const r = await reports.report(String(req.params.key), req.query as reports.ReportParams);
  const pdf = req.query.format === 'pdf';
  sendFile(res, pdf ? await exporter.pdf(r) : await exporter.excel(r), `${r.title.replace(/[^\w]+/g, '_')}_${fmt(today(), 'yyyyMMdd')}.${pdf ? 'pdf' : 'xlsx'}`);
}

// ---- backup of the inventory database (SuperAdmin): every Inv table as JSON
export async function backup(req: Request, res: Response) {
  if (req.role !== 'SuperAdmin') throw new UserError('Only a SuperAdmin can download the backup.', 403);
  const tables: Record<string, unknown[]> = {};
  for (const t of INVENTORY_TABLES) tables[t] = await query(`SELECT * FROM ${t}`);
  const name = `ZkInventory_${fmt(now(), 'yyyyMMdd_HHmm')}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(JSON.stringify({ kind: 'zk-inventory-backup', version: 1, createdAt: fmt(now(), 'yyyy-MM-dd HH:mm:ss'), tables }));
}

// ---- employee portal (/api/portal/store)
const emp = (req: Request) => req.employeeId!;
export const portalCatalog = async (req: Request, res: Response) => res.json(await issues.catalog(emp(req)));
export const portalRequisitions = async (req: Request, res: Response) => res.json(await issues.myRequisitions(emp(req)));
export async function portalCreate(req: Request, res: Response) {
  const e = await one('SELECT Name, EnrollNo FROM DirEmployees WHERE Id = @id', { id: emp(req) });
  res.json(await issues.createRequisition({ ...req.body, EmployeeId: emp(req), DepartmentId: undefined }, `${e?.EnrollNo} ${e?.Name}`, 'portal'));
}
export const portalCancel = async (req: Request, res: Response) => res.json({ message: await issues.cancelRequisition(idParam(req), 'Employee', emp(req)) });
export const portalHoldings = async (req: Request, res: Response) => res.json(await issues.holdings({ employeeId: emp(req) }));
export const portalBin = async (req: Request, res: Response) => res.json(await bins.bin(emp(req), false));
export const portalSiteMaterial = async (req: Request, res: Response) => res.json(await issues.mySiteMaterial(emp(req)));
export async function portalConsume(req: Request, res: Response) {
  const e = await one('SELECT Name, EnrollNo FROM DirEmployees WHERE Id = @id', { id: emp(req) });
  res.json({ message: await issues.consume(idParam(req), req.body ?? {}, `${e?.EnrollNo} ${e?.Name}`, emp(req)) });
}
