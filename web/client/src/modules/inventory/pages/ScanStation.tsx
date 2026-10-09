/**
 * Scan Station at the store counter. Find: scan anything (unit tag, item barcode, bin label, employee card) to see what
 * it is and where it is. Give back: scan the bin / employee card, then the items — a unit's tag returns that unit, an
 * item's barcode returns the quantity from that bin; good items go back into stock.
 */
import { useState } from 'react';
import { api, qs } from '../../../api';
import { useApp } from '../../../app';
import { Button, Field, Input, Note, Page, Select, Tabs } from '../../../ui';
import { ScanBox } from '../scan';
import { Badge, useInv } from '../shared';
import { BinView } from './Bins';
import { LocationDialog } from './Locations';
import { UnitDialog } from './Units';

type Mode = 'return' | 'find';
interface Logged { ok: boolean; text: string; at: string }

export function ScanStation() {
  const { me } = useInv();
  const [mode, setMode] = useState<Mode>(me.manage ? 'return' : 'find');
  return (
    <Page title="Scan Station" icon="scan" bodyClass="flex flex-col gap-3">
      <Tabs tabs={[...(me.manage ? [{ key: 'return' as Mode, label: 'Give back to store' }] : []), { key: 'find' as Mode, label: 'Find (what is this?)' }]} value={mode} onChange={setMode} />
      {mode === 'return' ? <GiveBack /> : <Find />}
    </Page>
  );
}

function GiveBack() {
  const [bin, setBin] = useState<{ Id: number; Name: string; Bin: string } | null>(null);
  const [loc, setLoc] = useState<{ Id: number; Code: string } | null>(null);
  const [condition, setCondition] = useState('Good');
  const [q, setQ] = useState('1');
  const [log, setLog] = useState<Logged[]>([]);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const add = (ok: boolean, text: string) => setLog((l) => [{ ok, text, at: new Date().toLocaleTimeString() }, ...l].slice(0, 100));
  const scan = async (code: string) => {
    setBusy(true);
    try {
      const r = await api.post('/inventory/scan/return', { Code: code, EmployeeId: bin?.Id, Qty: q || 1, Condition: condition, LocationId: loc?.Id });
      if (r.scan.kind === 'employee') setBin({ Id: r.scan.employee.Id, Name: `${r.scan.employee.EnrollNo} ${r.scan.employee.Name}`, Bin: r.scan.employee.Bin });
      else if (r.scan.kind === 'location') { setLoc({ Id: r.scan.location.Id, Code: r.scan.location.Code }); add(true, r.message); }
      else { add(true, r.message); setQ('1'); setRefresh((n) => n + 1); }
    } catch (e: any) {
      add(false, `${code}: ${e.message}`);
    } finally { setBusy(false); }
  };
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,26rem)_1fr]">
      <div className="space-y-3">
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <ScanBox autoFocus busy={busy} onScan={scan} placeholder="Scan bin / card, then each item" />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Field label="Condition"><Select value={condition} onChange={(e) => setCondition(e.target.value)}>
              <option value="Good">Good (back in stock)</option><option value="Damaged">Damaged</option><option value="Lost">Lost</option></Select></Field>
            <Field label="Quantity" hint="Quantity items only"><Input type="number" min={0} step="any" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm">
            {bin ? <><span>Bin: <b>{bin.Bin}</b> · {bin.Name}</span><Button onClick={() => setBin(null)}>Change</Button></> : <span className="text-slate-500">No bin chosen: tagged units can still be scanned (they know who has them).</span>}
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <span>Goes back to: <b>{loc ? loc.Code : 'RECEIVING'}</b></span>{loc && <Button onClick={() => setLoc(null)}>Back to RECEIVING</Button>}
            <span className="text-xs text-slate-500">(scan a rack label to put it straight there)</span>
          </div>
        </div>
        <Note>Tagged unit (RFID / QR): just scan it. Quantity item (pens, wires …): scan the bin label or the employee card first, set the quantity, then scan the item's barcode / code.</Note>
        <ul className="max-h-[50vh] space-y-1 overflow-auto rounded-lg border border-slate-200 bg-white p-2 text-sm">
          {!log.length && <li className="text-slate-400">Nothing scanned yet.</li>}
          {log.map((l, i) => <li key={i} className={l.ok ? 'text-emerald-700' : 'text-red-700'}><span className="text-xs text-slate-400">{l.at}</span> {l.ok ? '✓' : '✗'} {l.text}</li>)}
        </ul>
      </div>
      <div className="min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        {bin ? <BinView key={`${bin.Id}-${refresh}`} employeeId={bin.Id} /> : <p className="text-sm text-slate-500">Scan a bin label or an employee card to see their bin here.</p>}
      </div>
    </div>
  );
}

function Find() {
  const app = useApp();
  const [r, setR] = useState<any>(null);
  const [unit, setUnit] = useState<number | null>(null);
  const [loc, setLoc] = useState<number | null>(null);
  const scan = (code: string) => app.run(async () => setR(await api.get('/inventory/scan' + qs({ code }))));
  return (
    <div className="space-y-3">
      <div className="max-w-xl rounded-lg border border-slate-200 bg-white p-3 shadow-sm"><ScanBox autoFocus onScan={scan} /></div>
      {r?.kind === 'unit' && (
        <div className="max-w-xl rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
          <div className="text-base font-semibold text-brand-900">{r.unit.Code} — {r.unit.Item}</div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1"><span>Serial <b>{r.unit.SerialNo}</b></span><span>Tag <b>{r.unit.Tag || '—'}</b></span><Badge value={r.unit.Status} /></div>
          <div className="mt-1 text-slate-600">{r.unit.Status === 'Issued' ? `With ${r.unit.EnrollNo} ${r.unit.Employee}${r.unit.Site ? ` for ${r.unit.Site}` : ''}`
            : r.unit.Status === 'Installed' ? `Installed at ${r.unit.Site}` : r.unit.Status === 'InStore' ? `In the store at ${r.unit.Location || 'RECEIVING'}` : ''}</div>
          <Button className="mt-2" onClick={() => setUnit(r.unit.Id)}>History</Button>
        </div>
      )}
      {r?.kind === 'item' && (
        <div className="max-w-xl rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
          <div className="text-base font-semibold text-brand-900">{r.item.Code} — {r.item.Name}</div>
          <div className="mt-1 text-slate-600">{r.item.TrackBy === 'Serial' ? 'Tracked by serial: scan a unit\'s own tag to see that unit.' : r.item.IsReturnable ? 'Returnable item' : 'Consumable'}</div>
          <a className="mt-2 inline-block text-brand-700 underline" href={`/inventory/items?id=${r.item.Id}`}>Stock and movements</a>
        </div>
      )}
      {r?.kind === 'location' && (
        <div className="max-w-xl rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
          <div className="text-base font-semibold text-brand-900">{r.location.Warehouse} · {r.location.Code}</div>
          <Button className="mt-2" onClick={() => setLoc(r.location.Id)}>What is on it</Button>
        </div>
      )}
      {loc && <LocationDialog id={loc} onClose={() => setLoc(null)} />}
      {r?.kind === 'employee' && <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"><BinView employeeId={r.employee.Id} /></div>}
      {unit && <UnitDialog id={unit} onClose={() => setUnit(null)} />}
    </div>
  );
}
