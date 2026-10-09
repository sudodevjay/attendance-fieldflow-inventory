/** Inventory dashboard: stock value, what needs attention (alerts), consumption by department, latest movements. */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api';
import { useApp } from '../../../app';
import { Button, Card, Page } from '../../../ui';
import { Badge, inr, qty, Stat, useInv } from '../shared';

export function InvDashboard() {
  const app = useApp();
  const { me } = useInv();
  const navigate = useNavigate();
  const [d, setD] = useState<any>(null);
  const load = useCallback(() => api.get('/inventory/dashboard').then(setD), []);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const mark = async (ids: number[] | 'all', dismiss = false) => { if (await app.run(() => api.post('/inventory/alerts/read', { ids, dismiss }))) await load(); };
  const runChecks = async () => {
    const r = await app.run(() => api.post('/inventory/automation/run'));
    if (!r) return;
    await app.alert(`Checks done at ${r.ranAt}.\n\nRe-order POs: ${r.reordered.length ? r.reordered.join(', ') : 'none needed'}\nLate POs: ${r.latePos}\nOverdue returns: ${r.overdue} (reminders sent: ${r.reminded})\nExit clearance: ${r.exitClearance}\nRequisitions waiting for approval: ${r.waitingRequisitions}`, 'Automation');
    await load();
  };

  if (!d) return <Page title="Inventory Dashboard" icon="home"><div className="text-slate-500">Loading…</div></Page>;
  const c = d.cards;
  return (
    <Page title="Inventory Dashboard" icon="home" toolbar={
      <>
        <span className="text-xs text-slate-500">{d.date}</span>
        <span className="flex-1" />
        {me.head && <Button icon="sync" onClick={runChecks}>Run automatic checks now</Button>}
        <Button icon="refresh" onClick={() => app.run(load)}>Refresh</Button>
      </>
    } bodyClass="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Stock value" value={inr(c.value)} sub={`${c.items} active items`} onClick={() => navigate('/inventory/items')} />
        <Stat label="Low / out of stock" value={`${c.low} / ${c.out}`} tone={c.low + c.out ? 'amber' : 'green'} sub="at or below re-order level" onClick={() => navigate('/inventory/items?status=Reorder')} />
        <Stat label="Requisitions to approve" value={c.pendingReq} tone={c.pendingReq ? 'amber' : 'slate'} sub={`${c.toIssue} approved, to issue`} onClick={() => navigate('/inventory/requisitions')} />
        <Stat label="Open purchase orders" value={c.openPo} tone={c.latePo ? 'red' : 'blue'} sub={`${c.latePo} late · ${c.draftPo} draft`} onClick={() => navigate('/inventory/purchase')} />
        <Stat label="Returnables with staff" value={c.held} tone={c.overdue ? 'red' : 'slate'} sub={`${c.overdue} overdue`} onClick={() => navigate('/inventory/issues?tab=holdings')} />
        <Stat label={`${d.month}`} value={inr(c.monthOut)} tone="green" sub={`issued · received ${inr(c.monthIn)}`} onClick={() => navigate('/inventory/reports')} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {!me.scoped && (
          <Card title={`Alerts (${d.alerts.items.length})`} className="xl:col-span-2" actions={d.alerts.items.length > 0 && me.manage && <Button variant="ghost" onClick={() => mark('all')}>Mark all read</Button>}>
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto scroll-thin">
              {d.alerts.items.map((a: any) => (
                <li key={a.Id} className={`flex items-start gap-3 px-3 py-2 ${a.IsRead ? '' : 'bg-amber-50/50'}`}>
                  <Badge value={a.Kind === 'LowStock' ? 'Low' : a.Kind === 'LatePO' || a.Kind === 'Overdue' ? 'Late' : a.Kind === 'ExitClearance' ? 'Overdue' : 'Pending'} />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { if (!a.IsRead) mark([a.Id]); if (a.Link) navigate(a.Link); }}>
                    <div className="font-medium text-slate-800">{a.Title}</div>
                    {a.Body && <div className="text-xs text-slate-600">{a.Body}</div>}
                  </button>
                  <span className="shrink-0 text-[11px] text-slate-400">{a.When}</span>
                  {me.manage && <button type="button" className="shrink-0 text-xs text-slate-400 hover:text-red-600" onClick={() => mark([a.Id], true)} title="Dismiss">Dismiss</button>}
                </li>
              ))}
              {!d.alerts.items.length && <li className="px-3 py-6 text-center text-slate-400">Nothing needs attention.</li>}
            </ul>
          </Card>
        )}
        <Card title="Automation">
          <ul className="space-y-1.5 p-3 text-[13px]">
            <li>Automatic re-order: <b>{d.automation.autoPO === 'off' ? 'off' : d.automation.autoPO === 'draft' ? 'makes draft POs' : 'places POs'}</b></li>
            <li>Requisition approval: <b>{d.automation.approval === 'hod' ? 'HOD / store approves' : 'none (approved at once)'}</b></li>
            <li>Auto issue when in stock: <b>{d.automation.autoIssue ? 'on' : 'off'}</b></li>
            <li className="text-slate-500">Daily checks last ran: {d.automation.lastRun || 'not yet'}</li>
            {me.head && <li><Button className="mt-1" icon="settings" onClick={() => navigate('/inventory/masters?tab=settings')}>Change</Button></li>}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Re-order needed">
          <Mini rows={d.lowStock} empty="Every item is above its re-order level." cols={[
            { h: 'Item', c: (r: any) => <button type="button" className="text-left text-brand-700 hover:underline" onClick={() => navigate(`/inventory/items?id=${r.Id}`)}>{r.Name}</button> },
            { h: 'Stock', c: (r: any) => `${qty(r.Qty)} ${r.Unit}`, right: true }, { h: 'Level', c: (r: any) => qty(r.ReorderLevel), right: true },
            { h: 'On order', c: (r: any) => qty(r.OnOrder), right: true },
          ]} />
        </Card>
        <Card title={`Consumption by department — ${d.month}`}>
          <Bars rows={d.consumption} />
        </Card>
        <Card title={`Most issued — ${d.month}`}>
          <Mini rows={d.top} empty="Nothing issued this month." cols={[
            { h: 'Item', c: (r: any) => r.Name }, { h: 'Qty', c: (r: any) => `${qty(r.Qty)} ${r.Unit}`, right: true }, { h: 'Value', c: (r: any) => inr(r.Value), right: true },
          ]} />
        </Card>
      </div>

      <Card title="Latest stock movements">
        <Mini rows={d.recent} empty="No movements yet." cols={[
          { h: 'When', c: (r: any) => r.At }, { h: 'Type', c: (r: any) => r.Type }, { h: 'Item', c: (r: any) => r.Item },
          { h: 'Qty', c: (r: any) => <span className={Number(r.Qty) < 0 ? 'text-red-700' : 'text-emerald-700'}>{Number(r.Qty) > 0 ? '+' : ''}{qty(r.Qty)} {r.Unit}</span>, right: true },
          { h: 'Store', c: (r: any) => r.Warehouse }, { h: 'Employee', c: (r: any) => r.Employee }, { h: 'Doc', c: (r: any) => r.RefNo ?? '' },
        ]} />
      </Card>
    </Page>
  );
}

function Mini({ rows, cols, empty }: { rows: any[]; cols: { h: string; c: (r: any) => React.ReactNode; right?: boolean }[]; empty: string }) {
  return (
    <div className="max-h-72 overflow-auto scroll-thin">
      <table className="w-full text-[12.5px]">
        <thead className="sticky top-0 bg-slate-50 text-[11px] text-slate-500">
          <tr>{cols.map((c) => <th key={c.h} className={`px-2 py-1 font-medium ${c.right ? 'text-right' : 'text-left'}`}>{c.h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => <tr key={i} className="border-t border-slate-100">{cols.map((c) => <td key={c.h} className={`px-2 py-1 ${c.right ? 'text-right tabular-nums' : ''}`}>{c.c(r)}</td>)}</tr>)}
          {!rows.length && <tr><td colSpan={cols.length} className="px-2 py-5 text-center text-slate-400">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Horizontal bars: value issued per department. */
function Bars({ rows }: { rows: { Department: string; Value: number; Issues: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.Value));
  if (!rows.length) return <div className="px-3 py-6 text-center text-slate-400">Nothing issued this month.</div>;
  return (
    <ul className="space-y-2 p-3">
      {rows.map((r) => (
        <li key={r.Department}>
          <div className="flex justify-between text-xs"><span className="truncate text-slate-700">{r.Department}</span><span className="tabular-nums text-slate-600">{inr(r.Value)}</span></div>
          <div className="mt-0.5 h-2 rounded bg-slate-100"><div className="h-2 rounded bg-brand-600" style={{ width: `${Math.max(2, (r.Value / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}
