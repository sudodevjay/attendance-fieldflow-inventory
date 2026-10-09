/**
 * Inventory dashboard and reports. A report is a ReportResult (title, columns, rows) like the attendance reports, so the
 * same Excel / PDF export is used (services/export.service).
 */
import { one, query } from '../../db';
import type { ReportResult } from '../../export';
import { money } from '../../utils/format';
import { UserError } from '../../utils/errors';
import { withChildren } from '../../attendance';
import { scopeDepartments } from '../../utils/scope';
import { addDays, fmt, monthStart, mustParse, sqlD, today } from '../../utils/time';
import { alerts, getSettings, qtyText } from './common.service';
import { holdings, siteRegister, siteStock } from './issue.service';
import { balances, ledger, round2 } from './stock.service';
import { bins } from './bin.service';
import { units } from './unit.service';

export async function dashboard() {
  const t = today(), m = monthStart(t);
  const stock = await balances();
  const sc = scopeDepartments();
  const ds = sc ? [...sc] : null;
  const cnt = async (sql: string, p = {}) => Number((await one(sql, { ds, ...p }))?.c ?? 0);
  const consumption = await query(`SELECT COALESCE(d.Name, 'No department') AS Department, ROUND(SUM(-m.Qty * m.UnitCost), 2) AS Value, COUNT(DISTINCT m.RefId) AS Issues
    FROM InvMovements m LEFT JOIN DirDepartments d ON d.Id = m.DepartmentId
    WHERE m.Type IN ('Issue', 'Return') AND m.At >= CAST(@m AS timestamp) AND (CAST(@ds AS int[]) IS NULL OR m.DepartmentId = ANY(@ds))
    GROUP BY d.Name ORDER BY 2 DESC LIMIT 8`, { m: sqlD(m), ds });
  const top = await query(`SELECT i.Code, i.Name, i.Unit, SUM(-m.Qty) AS Qty, ROUND(SUM(-m.Qty * m.UnitCost), 2) AS Value FROM InvMovements m JOIN InvItems i ON i.Id = m.ItemId
    WHERE m.Type IN ('Issue', 'Return') AND m.At >= CAST(@m AS timestamp) AND (CAST(@ds AS int[]) IS NULL OR m.DepartmentId = ANY(@ds))
    GROUP BY i.Code, i.Name, i.Unit HAVING SUM(-m.Qty) > 0 ORDER BY 5 DESC LIMIT 8`, { m: sqlD(m), ds });
  const recent = await query(`SELECT to_char(m.At, 'YYYY-MM-DD HH24:MI') AS At, i.Name AS Item, i.Unit, m.Type, m.Qty, m.RefNo, w.Name AS Warehouse, COALESCE(e.Name, '') AS Employee
    FROM InvMovements m JOIN InvItems i ON i.Id = m.ItemId JOIN InvWarehouses w ON w.Id = m.WarehouseId LEFT JOIN DirEmployees e ON e.Id = m.EmployeeId
    WHERE (CAST(@ds AS int[]) IS NULL OR m.DepartmentId = ANY(@ds)) ORDER BY m.Id DESC LIMIT 12`, { ds });
  const monthIn = await one(`SELECT COALESCE(SUM(m.Qty * m.UnitCost), 0) AS Total FROM InvMovements m WHERE m.Type = 'Receipt' AND m.At >= CAST(@m AS timestamp)`, { m: sqlD(m) });
  const monthOut = await one(`SELECT COALESCE(SUM(-m.Qty * m.UnitCost), 0) AS Total FROM InvMovements m WHERE m.Type IN ('Issue', 'Return') AND m.At >= CAST(@m AS timestamp)
    AND (CAST(@ds AS int[]) IS NULL OR m.DepartmentId = ANY(@ds))`, { m: sqlD(m), ds });
  const held = await holdings({});
  const settings = await getSettings();
  return {
    date: fmt(t, 'dddd, dd MMMM yyyy'), month: fmt(m, 'MMMM yyyy'),
    cards: {
      items: stock.length, value: round2(stock.reduce((a, s) => a + s.Value, 0)),
      low: stock.filter((s) => s.Status === 'Low').length, out: stock.filter((s) => s.Status === 'Out' && Number(s.ReorderLevel) > 0).length,
      pendingReq: await cnt(`SELECT COUNT(*) c FROM InvRequisitions WHERE Status = 'Pending' AND (CAST(@ds AS int[]) IS NULL OR DepartmentId = ANY(@ds))`),
      toIssue: await cnt(`SELECT COUNT(*) c FROM InvRequisitions WHERE Status IN ('Approved', 'PartIssued') AND (CAST(@ds AS int[]) IS NULL OR DepartmentId = ANY(@ds))`),
      openPo: await cnt(`SELECT COUNT(*) c FROM InvPurchaseOrders WHERE Status IN ('Ordered', 'Partial')`),
      draftPo: await cnt(`SELECT COUNT(*) c FROM InvPurchaseOrders WHERE Status = 'Draft'`),
      latePo: await cnt(`SELECT COUNT(*) c FROM InvPurchaseOrders WHERE Status IN ('Ordered', 'Partial') AND ExpectedDate < CAST(@t AS date)`, { t: sqlD(t) }),
      held: held.length, overdue: held.filter((h) => h.OverdueDays > 0).length,
      monthIn: round2(Number(monthIn?.Total ?? 0)), monthOut: round2(Number(monthOut?.Total ?? 0)),
    },
    lowStock: stock.filter((s) => s.Status !== 'OK' && Number(s.ReorderLevel) > 0).slice(0, 12)
      .map((s) => ({ Id: s.Id, Code: s.Code, Name: s.Name, Unit: s.Unit, Qty: s.TotalQty, ReorderLevel: Number(s.ReorderLevel), OnOrder: s.OnOrder, Supplier: s.Supplier ?? '' })),
    consumption: consumption.map((c) => ({ ...c, Value: Number(c.Value) })), top, recent,
    alerts: sc ? { unread: 0, items: [] } : await alerts(false),
    automation: { autoPO: settings.AutoPO, approval: settings.Approval, autoIssue: settings.AutoIssue === '1', lastRun: settings.LastDailyRun },
  };
}

// ------------------------------------------------------------------ reports

export const REPORTS = [
  { key: 'stock', name: 'Stock Summary (quantity and value)', params: ['warehouse', 'category'] },
  { key: 'reorder', name: 'Re-order / Low Stock', params: [] },
  { key: 'ledger', name: 'Stock Ledger (all movements)', params: ['from', 'to', 'item', 'warehouse', 'type'] },
  { key: 'consumption', name: 'Department-wise Consumption', params: ['from', 'to', 'department'] },
  { key: 'employee', name: 'Employee-wise Issues', params: ['from', 'to', 'employee', 'department'] },
  { key: 'holdings', name: 'Returnable Items with Employees', params: ['employee'] },
  { key: 'site', name: 'Site-wise Material (issued, installed, returned, at site)', params: ['site'] },
  { key: 'site-register', name: 'Site Material Register (who took / installed / returned what)', params: ['from', 'to', 'site', 'employee'] },
  { key: 'locations', name: 'Stock by Location (rack / row / column)', params: ['warehouse', 'item'] },
  { key: 'bins', name: 'Employee Bins (open items, limit)', params: [] },
  { key: 'units', name: 'Serial Units (where every tagged unit is)', params: ['item', 'warehouse'] },
  { key: 'purchase', name: 'Purchase Register (goods received)', params: ['from', 'to', 'supplier'] },
  { key: 'movement', name: 'Item Movement Summary (opening, in, out, closing)', params: ['from', 'to', 'warehouse'] },
] as const;

export interface ReportParams { from?: string; to?: string; warehouse?: string; category?: string; item?: string; type?: string; department?: string; employee?: string; supplier?: string; site?: string }

const n = (v: unknown) => (v === undefined || v === '' || v === null ? null : Number(v));
const period = (p: ReportParams) => {
  const f = mustParse(p.from ?? ''), t = mustParse(p.to ?? '');
  if (t < f) throw new UserError("The 'To' date cannot be before the 'From' date.");
  return { f, t, text: `${fmt(f, 'dd-MM-yyyy')} to ${fmt(t, 'dd-MM-yyyy')}` };
};

/** Departments of a report: the chosen one with its sub-departments, limited to the HOD's. */
async function deptFilter(p: ReportParams): Promise<number[] | null> {
  const sc = scopeDepartments();
  if (!p.department) return sc ? [...sc] : null;
  const ids = await withChildren(Number(p.department));
  return sc ? ids.filter((i) => sc.has(i)) : ids;
}

export async function report(key: string, p: ReportParams): Promise<ReportResult> {
  switch (key) {
    case 'stock': {
      const rows = await balances({ warehouseId: n(p.warehouse), categoryId: n(p.category) });
      const w = p.warehouse ? (await one('SELECT Name FROM InvWarehouses WHERE Id = @id', { id: Number(p.warehouse) }))?.Name : 'All stores';
      return {
        title: 'Stock Summary', subtitle: `${w} — as on ${fmt(today(), 'dd-MM-yyyy')} — total value ${money(rows.reduce((a, r) => a + r.Value, 0))}`,
        columns: ['Code', 'Item', 'Category', 'Unit', 'Quantity', 'Avg Cost', 'Value', 'Re-order Level', 'On Order', 'Status'],
        rows: rows.map((r) => [r.Code, r.Name, r.Category ?? '', r.Unit, qtyText(r.Qty), money(r.AvgCost), money(r.Value), qtyText(Number(r.ReorderLevel)), qtyText(r.OnOrder), r.Status]),
        statusColumns: [],
      };
    }
    case 'reorder': {
      const rows = (await balances({ status: 'Reorder' }));
      return {
        title: 'Re-order / Low Stock', subtitle: `as on ${fmt(today(), 'dd-MM-yyyy')}`,
        columns: ['Code', 'Item', 'Unit', 'In Stock', 'Re-order Level', 'On Order', 'Suggested Qty', 'Preferred Supplier', 'Last Price'],
        rows: rows.map((r) => {
          const need = Number(r.ReorderQty) > 0 ? Number(r.ReorderQty) : Math.max(0, Math.ceil(Number(r.ReorderLevel) * 2 - r.TotalQty - r.OnOrder));
          return [r.Code, r.Name, r.Unit, qtyText(r.TotalQty), qtyText(Number(r.ReorderLevel)), qtyText(r.OnOrder), r.TotalQty + r.OnOrder > Number(r.ReorderLevel) ? '0' : qtyText(need), r.Supplier ?? '', money(Number(r.PurchasePrice))];
        }),
        statusColumns: [],
      };
    }
    case 'ledger': {
      const { text } = period(p);
      const rows = await ledger({ from: p.from!, to: p.to!, itemId: n(p.item), warehouseId: n(p.warehouse), type: p.type ?? '', departmentIds: scopeDepartments() ? [...scopeDepartments()!] : null });
      return {
        title: 'Stock Ledger', subtitle: text,
        columns: ['Date', 'Doc No', 'Type', 'Code', 'Item', 'Store', 'In', 'Out', 'Balance', 'Rate', 'Value', 'Employee', 'Department', 'Note', 'By'],
        rows: rows.map((r) => [r.At, r.RefNo ?? '', r.Type, r.Code, r.Item, r.Warehouse, Number(r.Qty) > 0 ? qtyText(Number(r.Qty)) : '', Number(r.Qty) < 0 ? qtyText(-Number(r.Qty)) : '',
          qtyText(Number(r.BalanceAfter)), money(Number(r.UnitCost)), money(Math.abs(Number(r.Value))), r.Employee, r.Department, r.Note ?? '', r.CreatedBy ?? '']),
        statusColumns: [],
      };
    }
    case 'consumption': {
      const { f, t, text } = period(p);
      const ds = await deptFilter(p);
      const rows = await query(`SELECT COALESCE(d.Name, 'No department') AS Department, i.Code, i.Name, i.Unit, SUM(-m.Qty) AS Qty, SUM(-m.Qty * m.UnitCost) AS Value
        FROM InvMovements m JOIN InvItems i ON i.Id = m.ItemId LEFT JOIN DirDepartments d ON d.Id = m.DepartmentId
        WHERE m.Type IN ('Issue', 'Return') AND m.At >= CAST(@f AS timestamp) AND m.At < CAST(@t AS timestamp) AND (CAST(@ds AS int[]) IS NULL OR m.DepartmentId = ANY(@ds))
        GROUP BY d.Name, i.Code, i.Name, i.Unit HAVING SUM(-m.Qty) <> 0 ORDER BY 1, 6 DESC`, { f: sqlD(f), t: sqlD(addDays(t, 1)), ds });
      const total = rows.reduce((a, r) => a + Number(r.Value), 0);
      return {
        title: 'Department-wise Consumption', subtitle: `${text} — total ${money(total)}`,
        columns: ['Department', 'Code', 'Item', 'Unit', 'Quantity', 'Value'],
        rows: rows.map((r) => [r.Department, r.Code, r.Name, r.Unit, qtyText(Number(r.Qty)), money(Number(r.Value))]),
        statusColumns: [],
      };
    }
    case 'employee': {
      const { f, t, text } = period(p);
      const ds = await deptFilter(p);
      const rows = await query(`SELECT COALESCE(e.EnrollNo, '') AS EnrollNo, COALESCE(e.Name, s.EmployeeName, '') AS Employee, COALESCE(d.Name, '') AS Department,
          s.IssueNo, to_char(s.IssuedOn, 'YYYY-MM-DD') AS IssuedOn, COALESCE(ws.Name, s.SiteName, '') AS Site, i.Code, i.Name, i.Unit, l.Qty, l.ReturnedQty, l.ConsumedQty,
          l.Qty * l.UnitCost AS Value, to_char(l.DueDate, 'YYYY-MM-DD') AS DueDate
        FROM InvIssueLines l JOIN InvIssues s ON s.Id = l.IssueId JOIN InvItems i ON i.Id = l.ItemId LEFT JOIN DirEmployees e ON e.Id = s.EmployeeId LEFT JOIN DirDepartments d ON d.Id = s.DepartmentId
          LEFT JOIN DirSites ws ON ws.Id = s.SiteId
        WHERE s.IssuedOn >= CAST(@f AS timestamp) AND s.IssuedOn < CAST(@t AS timestamp) AND (CAST(@e AS int) IS NULL OR s.EmployeeId = @e)
          AND (CAST(@ds AS int[]) IS NULL OR s.DepartmentId = ANY(@ds))
        ORDER BY 2, s.IssuedOn`, { f: sqlD(f), t: sqlD(addDays(t, 1)), e: n(p.employee), ds });
      return {
        title: 'Employee-wise Issues', subtitle: text,
        columns: ['AC No', 'Employee', 'Department', 'Issue No', 'Date', 'Site', 'Code', 'Item', 'Unit', 'Issued', 'Installed at Site', 'Returned', 'Value', 'Due Back'],
        rows: rows.map((r) => [r.EnrollNo, r.Employee, r.Department, r.IssueNo, r.IssuedOn, r.Site, r.Code, r.Name, r.Unit, qtyText(Number(r.Qty)),
          r.Site ? qtyText(Number(r.ConsumedQty)) : '', qtyText(Number(r.ReturnedQty)), money(Number(r.Value)), r.DueDate ?? '']),
        statusColumns: [],
      };
    }
    case 'holdings': {
      const rows = await holdings({ employeeId: n(p.employee) });
      return {
        title: 'Returnable Items with Employees', subtitle: `as on ${fmt(today(), 'dd-MM-yyyy')} — ${rows.length} line(s), ${rows.filter((r) => r.OverdueDays > 0).length} overdue`,
        columns: ['AC No', 'Employee', 'Active', 'Department', 'Issue No', 'Issued On', 'Code', 'Item', 'Qty', 'Value', 'Due Back', 'Days Late'],
        rows: rows.map((r) => [r.EnrollNo ?? '', r.Employee, r.EmployeeActive ? 'Yes' : 'LEFT', r.Department, r.IssueNo, r.IssuedOn, r.Code, r.Item, `${qtyText(r.Qty)} ${r.Unit}`, money(r.Value), r.DueDate, r.OverdueDays ? String(r.OverdueDays) : '']),
        statusColumns: [],
      };
    }
    case 'site': {
      const rows = await siteStock({ siteId: n(p.site) });
      const name = p.site ? rows[0]?.Site ?? (await one('SELECT Name FROM DirSites WHERE Id = @id', { id: Number(p.site) }))?.Name ?? '' : 'All sites';
      return {
        title: 'Site-wise Material', subtitle: `${name} — as on ${fmt(today(), 'dd-MM-yyyy')} — installed ${money(rows.reduce((a, r) => a + r.InstalledValue, 0))}, still at site ${money(rows.reduce((a, r) => a + r.AtSiteValue, 0))}`,
        columns: ['Site', 'Code', 'Item', 'Unit', 'Issued', 'Installed', 'Returned', 'At Site', 'Installed Value', 'At Site Value', 'Last Issue'],
        rows: rows.map((r) => [r.Site, r.Code, r.Name, r.Unit, qtyText(r.Issued), qtyText(r.Installed), qtyText(r.Returned), qtyText(r.AtSite), money(r.InstalledValue), money(r.AtSiteValue), r.LastIssued]),
        statusColumns: [],
      };
    }
    case 'site-register': {
      const { text } = period(p);
      const rows = await siteRegister({ from: p.from!, to: p.to!, siteId: n(p.site), employeeId: n(p.employee) });
      return {
        title: 'Site Material Register', subtitle: text,
        columns: ['Date', 'Site', 'What', 'Issue No', 'AC No', 'Employee', 'Code', 'Item', 'Qty', 'Value', 'By', 'Note'],
        rows: rows.map((r) => [r.At, r.Site, r.Kind, r.IssueNo, r.EnrollNo, r.Employee, r.Code, r.Item, `${qtyText(r.Qty)} ${r.Unit}`, money(r.Value), r.By, r.Note]),
        statusColumns: [],
      };
    }
    case 'locations': {
      const rows = await query(`SELECT w.Name AS Warehouse, l.Code, i.Code AS ItemCode, i.Name, i.Unit, s.Qty, s.Qty * COALESCE(st.AvgCost, 0) AS Value,
          (SELECT string_agg(u.SerialNo, ', ' ORDER BY u.Id) FROM InvUnits u WHERE u.LocationId = l.Id AND u.ItemId = i.Id AND u.Status = 'InStore') AS Serials
        FROM InvLocStock s JOIN InvLocations l ON l.Id = s.LocationId JOIN InvWarehouses w ON w.Id = l.WarehouseId JOIN InvItems i ON i.Id = s.ItemId
          LEFT JOIN InvStock st ON st.ItemId = s.ItemId AND st.WarehouseId = l.WarehouseId
        WHERE s.Qty <> 0 AND (CAST(@w AS int) IS NULL OR l.WarehouseId = @w) AND (CAST(@i AS int) IS NULL OR s.ItemId = @i)
        ORDER BY w.Name, l.IsSystem DESC, l.Rack, length(l.RowNo), l.RowNo, length(l.ColNo), l.ColNo, i.Name`, { w: n(p.warehouse), i: n(p.item) });
      return {
        title: 'Stock by Location', subtitle: `as on ${fmt(today(), 'dd-MM-yyyy')} — ${rows.length} row(s), value ${money(rows.reduce((a, r) => a + Number(r.Value), 0))}`,
        columns: ['Store', 'Location', 'Code', 'Item', 'Qty', 'Value', 'Serial numbers'],
        rows: rows.map((r) => [r.Warehouse, r.Code, r.ItemCode, r.Name, `${qtyText(Number(r.Qty))} ${r.Unit}`, money(Number(r.Value)), r.Serials ?? '']),
        statusColumns: [],
      };
    }
    case 'bins': {
      const rows = (await bins({ openOnly: true }));
      return {
        title: 'Employee Bins', subtitle: `as on ${fmt(today(), 'dd-MM-yyyy')} — ${rows.length} bin(s) with open items, ${rows.filter((r) => r.Full).length} full`,
        columns: ['Bin', 'AC No', 'Employee', 'Active', 'Department', 'Open Items', 'Limit', 'Full', 'Overdue', 'At Site', 'Value'],
        rows: rows.map((r) => [r.Bin, r.EnrollNo, r.Name, r.Active ? 'Yes' : 'LEFT', r.Department, String(r.Open), r.Limit ? String(r.Limit) : 'No limit', r.Full ? 'FULL' : '',
          r.Overdue ? String(r.Overdue) : '', r.AtSite ? String(r.AtSite) : '', money(r.Value)]),
        statusColumns: [],
      };
    }
    case 'units': {
      const rows = await units({ itemId: n(p.item), warehouseId: n(p.warehouse) });
      return {
        title: 'Serial Units', subtitle: `as on ${fmt(today(), 'dd-MM-yyyy')} — ${rows.length} unit(s), ${rows.filter((r) => !r.Tag).length} without tag`,
        columns: ['Code', 'Item', 'Serial No', 'Tag', 'Status', 'Store', 'With (AC No)', 'Employee', 'Site', 'Issue No', 'Cost'],
        rows: rows.map((r) => [r.Code, r.Item, r.SerialNo, r.Tag, r.Status, r.Warehouse, r.EnrollNo, r.Employee, r.Site, r.IssueNo, money(r.Cost)]),
        statusColumns: [],
      };
    }
    case 'purchase': {
      const { f, t, text } = period(p);
      const rows = await query(`SELECT r.GrnNo, to_char(r.ReceivedOn, 'YYYY-MM-DD') AS ReceivedOn, COALESCE(po.PoNo, '') AS PoNo, COALESCE(s.Name, '') AS Supplier, COALESCE(s.Gstin, '') AS Gstin,
          COALESCE(r.InvoiceNo, '') AS InvoiceNo, i.Code, i.Name, i.Hsn, i.Unit, l.Qty, l.UnitPrice, l.Qty * l.UnitPrice AS Taxable,
          COALESCE(pl.GstRate, i.GstRate) AS GstRate
        FROM InvReceiptLines l JOIN InvReceipts r ON r.Id = l.ReceiptId JOIN InvItems i ON i.Id = l.ItemId LEFT JOIN InvPurchaseOrders po ON po.Id = r.PoId
          LEFT JOIN InvPurchaseOrderLines pl ON pl.Id = l.PoLineId LEFT JOIN InvSuppliers s ON s.Id = r.SupplierId
        WHERE r.ReceivedOn BETWEEN CAST(@f AS date) AND CAST(@t AS date) AND (CAST(@s AS int) IS NULL OR r.SupplierId = @s)
        ORDER BY r.ReceivedOn, r.Id, l.Id`, { f: sqlD(f), t: sqlD(t), s: n(p.supplier) });
      const taxable = rows.reduce((a, r) => a + Number(r.Taxable), 0);
      const gst = rows.reduce((a, r) => a + Number(r.Taxable) * Number(r.GstRate) / 100, 0);
      return {
        title: 'Purchase Register', subtitle: `${text} — taxable ${money(taxable)}, GST ${money(gst)}, total ${money(taxable + gst)}`,
        columns: ['GRN No', 'Date', 'PO No', 'Supplier', 'GSTIN', 'Invoice', 'Code', 'Item', 'HSN', 'Qty', 'Rate', 'Taxable', 'GST %', 'GST', 'Total'],
        rows: rows.map((r) => {
          const g = Number(r.Taxable) * Number(r.GstRate) / 100;
          return [r.GrnNo, r.ReceivedOn, r.PoNo, r.Supplier, r.Gstin, r.InvoiceNo, r.Code, r.Name, r.Hsn ?? '', `${qtyText(Number(r.Qty))} ${r.Unit}`, money(Number(r.UnitPrice)),
            money(Number(r.Taxable)), String(Number(r.GstRate)), money(g), money(Number(r.Taxable) + g)];
        }),
        statusColumns: [],
      };
    }
    case 'movement': {
      const { f, t, text } = period(p);
      const w = n(p.warehouse);
      const rows = await query(`SELECT i.Code, i.Name, i.Unit,
          COALESCE(SUM(m.Qty) FILTER (WHERE m.At < CAST(@f AS timestamp)), 0) AS Opening,
          COALESCE(SUM(m.Qty) FILTER (WHERE m.At >= CAST(@f AS timestamp) AND m.At < CAST(@t AS timestamp) AND m.Qty > 0 AND m.Type <> 'Move'), 0) AS InQty,
          COALESCE(SUM(-m.Qty) FILTER (WHERE m.At >= CAST(@f AS timestamp) AND m.At < CAST(@t AS timestamp) AND m.Qty < 0 AND m.Type <> 'Move'), 0) AS OutQty,
          COALESCE(SUM(m.Qty) FILTER (WHERE m.At < CAST(@t AS timestamp)), 0) AS Closing
        FROM InvItems i LEFT JOIN InvMovements m ON m.ItemId = i.Id AND (CAST(@w AS int) IS NULL OR m.WarehouseId = @w)
        GROUP BY i.Id, i.Code, i.Name, i.Unit HAVING COUNT(m.Id) > 0 ORDER BY i.Name`, { f: sqlD(f), t: sqlD(addDays(t, 1)), w });
      return {
        title: 'Item Movement Summary', subtitle: text,
        columns: ['Code', 'Item', 'Unit', 'Opening', 'In', 'Out', 'Closing'],
        rows: rows.map((r) => [r.Code, r.Name, r.Unit, qtyText(Number(r.Opening)), qtyText(Number(r.InQty)), qtyText(Number(r.OutQty)), qtyText(Number(r.Closing))]),
        statusColumns: [],
      };
    }
    default: throw new UserError('Unknown report.', 404);
  }
}
