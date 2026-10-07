/**
 * Site Attendance: work sites (GPS position + radius) where employees may check in from the app / portal with a selfie,
 * and the site check-ins with their selfie next to the employee's own photo, the distance and a map link.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, getToken, isoDate, qs } from '../api';
import { useApp } from '../app';
import { DataTable } from '../DataTable';
import { Button, Check, Field, Input, Modal, Note, Page, Select, Tabs } from '../ui';

type Tab = 'punches' | 'sites';
const mapUrl = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;

export function Sites() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'punches');
  return (
    <Page title="Site Attendance (GPS + selfie)" icon="photo" bodyClass="flex flex-col">
      <Tabs tabs={[{ key: 'punches', label: 'Site Check-ins' }, { key: 'sites', label: 'Work Sites' }]} value={tab} onChange={setTab} />
      {tab === 'punches' ? <Punches /> : <SiteList />}
    </Page>
  );
}

function Punches() {
  const app = useApp();
  const [from, setFrom] = useState(isoDate());
  const [to, setTo] = useState(isoDate());
  const [site, setSite] = useState('');
  const [sites, setSites] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [view, setView] = useState<any | null>(null);
  useEffect(() => { api.get('/sites').then(setSites); }, []);
  const load = useCallback(() => api.get('/sites/punches' + qs({ from, to, site })).then(setRows), [from, to, site]);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const photo = (id: number, who = '') => `/api/sites/punches/${id}/photo?token=${getToken()}${who ? `&who=${who}` : ''}`;

  return (
    <>
      <div className="flex flex-wrap items-end gap-2 py-2">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Site">
          <Select value={site} onChange={(e) => setSite(e.target.value)} className="w-48">
            <option value="">All sites</option>{sites.map((s) => <option key={s.Id} value={s.Id}>{s.Name}</option>)}
          </Select>
        </Field>
        <Button icon="refresh" onClick={() => app.run(load)}>Refresh</Button>
        <span className="pb-2 text-xs text-slate-500">{rows.length} check-in(s). Click a row to compare the selfie with the employee's photo.</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <DataTable rows={rows} rowKey={(r) => r.Id} onDoubleClick={setView} empty="No site check-ins."
          rowClass={(r) => (r.PunchDeleted ? 'text-slate-400 line-through' : '')}
          columns={[
            { key: 'Photo', header: 'Selfie', render: (r) => (r.HasPhoto
              ? <button type="button" onClick={(e) => { e.stopPropagation(); setView(r); }}><img src={photo(r.Id)} alt={`Selfie of ${r.Name}`} loading="lazy" className="h-14 w-14 rounded object-cover" /></button> : '') },
            { key: 'PunchTime', header: 'Time' },
            { key: 'IsCheckOut', header: 'In / Out', render: (r) => (r.IsCheckOut ? 'Out' : 'In') },
            { key: 'EnrollNo', header: 'AC No' }, { key: 'Name', header: 'Name' }, { key: 'Department', header: 'Department' },
            { key: 'SiteName', header: 'Site' },
            { key: 'DistanceMeters', header: 'Distance', align: 'right', render: (r) => `${r.DistanceMeters} m` },
            { key: 'AccuracyMeters', header: 'GPS ±', align: 'right', render: (r) => `${r.AccuracyMeters} m` },
            { key: 'Map', header: 'Map', render: (r) => <a className="text-brand-700 underline" href={mapUrl(r.Latitude, r.Longitude)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open</a> },
            { key: 'Source', header: 'From', render: (r) => (r.Source === 'app' ? 'App' : 'Browser') },
          ]} />
      </div>
      {view && (
        <Modal title={`${view.Name} — ${view.PunchTime} at ${view.SiteName}`} onClose={() => setView(null)} width="max-w-2xl">
          <div className="grid grid-cols-2 gap-3 text-center text-xs text-slate-500">
            <div><img src={photo(view.Id)} alt="Selfie at the site" className="mx-auto max-h-80 rounded" /><div className="mt-1">Selfie at the site</div></div>
            <div>{view.HasEmployeePhoto ? <img src={photo(view.Id, 'employee')} alt="Employee photo" className="mx-auto max-h-80 rounded" /> : <div className="py-16">No employee photo on file</div>}
              <div className="mt-1">Employee photo (Employees screen)</div></div>
          </div>
          <div className="mt-3 text-sm">
            {view.DistanceMeters} m from the site, GPS ±{view.AccuracyMeters} m, {view.Source === 'app' ? 'mobile app' : 'browser'}.{' '}
            <a className="text-brand-700 underline" href={mapUrl(view.Latitude, view.Longitude)} target="_blank" rel="noreferrer">Show on map</a>
            {view.PunchDeleted && <Note tone="warn">This punch was deleted in the AC Log.</Note>}
          </div>
        </Modal>
      )}
    </>
  );
}

const EMPTY = { Name: '', Address: '', Latitude: '', Longitude: '', RadiusMeters: 200, AllEmployees: true, IsActive: true, EmployeeIds: [] as number[] };

function SiteList() {
  const app = useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [edit, setEdit] = useState<any | null>(null);
  const load = useCallback(() => api.get('/sites').then(setRows), []);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const write = app.can('attendance', true);

  const remove = async (r: any) => {
    if (!(await app.confirm(`Delete the site "${r.Name}"? Its past check-ins stay.`))) return;
    if (await app.run(() => api.del(`/sites/${r.Id}`))) await load();
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 py-2">
        {write && <Button variant="primary" icon="add" onClick={() => setEdit({ ...EMPTY })}>Add site</Button>}
        <span className="text-xs text-slate-500">Employees can check in only within the radius of a site (turn this on in Employee Portal → Portal Settings). Add the office too if office staff check in from the phone.</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <DataTable rows={rows} rowKey={(r) => r.Id} onDoubleClick={(r) => write && setEdit({ ...r })} empty="No work sites yet. Add one."
          rowClass={(r) => (r.IsActive ? '' : 'text-slate-400')}
          columns={[
            { key: 'Name', header: 'Site' }, { key: 'Address', header: 'Address' },
            { key: 'Position', header: 'Location', render: (r) => <a className="text-brand-700 underline" href={mapUrl(r.Latitude, r.Longitude)} target="_blank" rel="noreferrer">{r.Latitude.toFixed(5)}, {r.Longitude.toFixed(5)}</a> },
            { key: 'RadiusMeters', header: 'Radius', align: 'right', render: (r) => `${r.RadiusMeters} m` },
            { key: 'AllEmployees', header: 'Employees', render: (r) => (r.AllEmployees ? 'All' : `${r.EmployeeIds.length} selected`) },
            { key: 'IsActive', header: 'Active', render: (r) => (r.IsActive ? 'Yes' : 'No') },
            ...(write ? [{ key: 'Actions', header: '', render: (r: any) => (
              <span className="flex gap-1"><Button icon="edit" onClick={() => setEdit({ ...r })}>Edit</Button><Button variant="danger" icon="trash" onClick={() => remove(r)}>Delete</Button></span>) }] : []),
          ]} />
      </div>
      {edit && <SiteDialog site={edit} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await load(); }} />}
    </>
  );
}

/** Accepts "28.61, 77.20" or a Google Maps link (…@28.61,77.20… or ?q=28.61,77.20). */
export function parseLatLng(text: string): [number, number] | null {
  const m = /(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/.exec(text);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function SiteDialog({ site, onClose, onSaved }: { site: any; onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const [f, setF] = useState<any>(site);
  const [emps, setEmps] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  const [locating, setLocating] = useState(false);
  useEffect(() => { api.get('/employees/options?active=1').then(setEmps); }, []);
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));

  const here = () => {
    if (!navigator.geolocation) return app.alert('This browser cannot give the location.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocating(false); setF((x: any) => ({ ...x, Latitude: p.coords.latitude.toFixed(6), Longitude: p.coords.longitude.toFixed(6) })); app.alert(`Location taken (±${Math.round(p.coords.accuracy)} m).`); },
      (e) => { setLocating(false); app.alert('The location could not be read: ' + e.message); },
      { enableHighAccuracy: true, timeout: 30_000, maximumAge: 0 },
    );
  };
  const paste = (text: string) => {
    const p = parseLatLng(text);
    if (p) setF((x: any) => ({ ...x, Latitude: String(p[0]), Longitude: String(p[1]) }));
  };
  const save = async () => {
    const r = await app.run(() => (f.Id ? api.put(`/sites/${f.Id}`, f) : api.post('/sites', f)));
    if (r) onSaved();
  };
  const toggle = (id: number) => set('EmployeeIds', f.EmployeeIds.includes(id) ? f.EmployeeIds.filter((x: number) => x !== id) : [...f.EmployeeIds, id]);
  const shown = emps.filter((e) => !filter || `${e.EnrollNo} ${e.Name}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Modal title={f.Id ? `Edit site — ${site.Name}` : 'Add work site'} onClose={onClose} width="max-w-xl"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="save" onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Site name"><Input value={f.Name} onChange={(e) => set('Name', e.target.value)} placeholder="e.g. Sector 62 Project" /></Field>
        <Field label="Address (optional)"><Input value={f.Address ?? ''} onChange={(e) => set('Address', e.target.value)} /></Field>
        <Field label="Location" hint="Stand at the site and press “Use my current location”, or paste the coordinates / a Google Maps link.">
          <div className="flex flex-wrap gap-2">
            <Input className="w-36" value={f.Latitude} onChange={(e) => set('Latitude', e.target.value)} onPaste={(e) => { const t = e.clipboardData.getData('text'); if (parseLatLng(t)) { e.preventDefault(); paste(t); } }} placeholder="Latitude" aria-label="Latitude" />
            <Input className="w-36" value={f.Longitude} onChange={(e) => set('Longitude', e.target.value)} placeholder="Longitude" aria-label="Longitude" />
            <Button icon="flag" busy={locating} onClick={here}>Use my current location</Button>
            {f.Latitude && f.Longitude && <a className="self-center text-sm text-brand-700 underline" href={mapUrl(f.Latitude, f.Longitude)} target="_blank" rel="noreferrer">Check on map</a>}
          </div>
        </Field>
        <Field label="Radius (metres)" hint="How far from the point a check-in is accepted. 100–300 m suits most sites; GPS in phones is exact to about 10–50 m.">
          <Input type="number" min={20} max={5000} className="w-32" value={f.RadiusMeters} onChange={(e) => set('RadiusMeters', e.target.value)} />
        </Field>
        <Check label="Active" checked={f.IsActive} onChange={(v) => set('IsActive', v)} />
        <Check label="All employees may check in here" checked={f.AllEmployees} onChange={(v) => set('AllEmployees', v)} />
        {!f.AllEmployees && (
          <div className="rounded border border-slate-200 p-2">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Search employees (${f.EmployeeIds.length} selected)`} aria-label="Search employees" />
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto scroll-thin">
              {shown.map((e) => <Check key={e.Id} label={`${e.EnrollNo} — ${e.Name}`} checked={f.EmployeeIds.includes(e.Id)} onChange={() => toggle(e.Id)} />)}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
