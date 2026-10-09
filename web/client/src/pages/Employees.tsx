/**
 * Employee List: department tree, grid, detail tabs (Basic Information / Addition / AC Options, and the web HR tabs HR Profile /
 * Salary Structure / Documents), photo, device upload.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, isoDate, qs } from '../api';
import { useApp } from '../app';
import { DataTable } from '../DataTable';
import { DeptTree, type Dept } from '../DeptTree';
import { Button, Check, Field, FINGER_NAMES, Icon, Input, Note, Page, Select, Tabs } from '../ui';
import { DocumentsTab, EMPTY_PROFILE, HrProfileTab, SalaryTab, type Profile, type SalaryRow } from './EmployeeHr';
import { EmployeeItemsTab } from '../modules/inventory/EmployeeItemsTab';

interface Row { Id: number; EnrollNo: string; BadgeNo: string | null; Name: string; Gender: string | null; Designation: string | null; Phone: string | null; Department: string | null; IsActive: boolean }

const EMPTY = {
  Id: 0, EnrollNo: '', Name: '', BadgeNo: '', Gender: '', Nationality: '', OfficeTel: '', Designation: '', Admin: false, BirthDate: '',
  JoinDate: '', CardNo: '', Phone: '', HomeAddress: '', DepartmentId: 0, ShiftId: 0, Email: '', MonthlySalary: 0, OtRatePerHour: 0,
  IsActive: true, DevicePassword: '', PhotoBase64: '', fingers: [] as number[], Profile: EMPTY_PROFILE as Profile, Salary: [] as SalaryRow[],
};
type Form = typeof EMPTY;

/** Shrinks a picture to at most 300 px and returns base64 JPEG (same format the Windows program stores). */
function toBase64Jpeg(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 300 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = () => reject(new Error('This file could not be opened as a photo.'));
    img.src = URL.createObjectURL(file);
  });
}

export function Employees() {
  const app = useApp();
  const [params] = useSearchParams();
  const [company, setCompany] = useState('');
  const [depts, setDepts] = useState<Dept[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [dept, setDept] = useState<number | null>(params.get('dept') ? +params.get('dept')! : null);
  const [includeSub, setIncludeSub] = useState(true);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState<number[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [tab, setTab] = useState<'basic' | 'addition' | 'ac' | 'hr' | 'salary' | 'docs' | 'store'>('basic');
  const [finger, setFinger] = useState(6);
  const [busy, setBusy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const excelRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api.get('/departments').then((r) => { setCompany(r.company); setDepts(r.departments); });
    api.get('/shifts').then(setShifts);
  }, [app.dataVersion]);

  const newEmployee = useCallback(async () => {
    const { next } = await api.get('/employees/next-no');
    const comps: any[] = await api.get('/payroll/components').catch(() => []);
    const Salary = comps.filter((c) => c.IsActive).map((c) => ({ ComponentId: c.Id, Name: c.Name, Kind: c.Kind, Calc: c.Calc, Value: c.Value, Amount: null, Calculated: 0 }));
    setForm({ ...EMPTY, EnrollNo: next, JoinDate: isoDate(), DepartmentId: dept ?? 0, ShiftId: shifts[0]?.Id ?? 0, Salary });
    setSel([]);
    setTab('basic');
  }, [dept, shifts]);

  const show = useCallback(async (id: number) => {
    const e = await api.get(`/employees/${id}`);
    setForm({
      ...EMPTY, ...Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v ?? ''])), Admin: e.Privilege > 0, DepartmentId: e.DepartmentId ?? 0,
      ShiftId: e.ShiftId ?? 0, MonthlySalary: e.MonthlySalary, OtRatePerHour: e.OtRatePerHour, IsActive: e.IsActive, fingers: e.fingers,
      JoinDate: e.JoinDate ?? '', BirthDate: e.BirthDate ?? '', PhotoBase64: e.PhotoBase64 ?? '',
      Profile: { ...EMPTY_PROFILE, ...e.Profile }, Salary: e.Salary ?? [],
    });
  }, []);

  const load = useCallback(async (select?: number) => {
    const list: Row[] = await api.get('/employees' + qs({ dept: dept ?? '', includeSub: includeSub ? 1 : 0, q: search }));
    setRows(list);
    const keep = select ?? (form.Id || undefined);
    const pick = list.find((r) => r.Id === keep) ?? list[0];
    if (pick) { setSel([pick.Id]); await show(pick.Id); } else await newEmployee();
  }, [dept, includeSub, search, form.Id, show, newEmployee]);

  useEffect(() => { app.run(() => load()); }, [dept, includeSub, app.dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (keys: (string | number)[]) => {
    setSel(keys as number[]);
    if (keys.length === 1 && keys[0] !== form.Id) app.run(() => show(keys[0] as number));
  };

  const save = async (quiet = false): Promise<boolean> => {
    const { Salary, Profile: { ReportingManager: _, ...Profile }, ...rest } = form;
    const body = {
      ...rest, DepartmentId: form.DepartmentId || null, ShiftId: form.ShiftId || null, Profile,
      SalaryComponents: Salary.map((r) => ({ ComponentId: r.ComponentId, Amount: r.Amount })),
    };
    const r = await app.run(() => (form.Id ? api.put(`/employees/${form.Id}`, body) : api.post('/employees', body)));
    if (!r) return false;
    await load(r.id);
    app.dataChanged();
    if (!quiet) await app.alert(`Saved: AC No ${form.EnrollNo} ${form.Name}\n\nClick 'Upload' to send this name to the device as well.`);
    return true;
  };

  const del = async () => {
    const ids = sel.length ? sel : form.Id ? [form.Id] : [];
    if (!ids.length) return;
    if (!(await app.confirm(`Delete ${ids.length} employee(s)?\n\nTheir leave records will also be deleted; attendance punches stay in the database.\n(To only deactivate an employee, clear Addition → Active instead.)`))) return;
    if (await app.run(() => api.post('/employees/delete', { ids }))) { setForm(EMPTY); await load(); app.dataChanged(); }
  };

  const device = async (what: 'upload' | 'download' | 'delete') => {
    let body: any;
    if (what === 'upload') {
      // Upload sends what is saved, so pending edits of the open employee are saved first.
      if (form.Id && !(await save(true))) return;
      const ids = sel.length ? sel : form.Id ? [form.Id] : [];
      if (!ids.length) return app.alert('Select an employee first.');
      body = { ids };
    } else if (what === 'download') {
      body = { overwrite: await app.confirm('Overwrite existing names in the software with the names from the device?\n\n(No = only new users and empty names are updated)') };
    } else {
      if (!sel.length) return app.alert('Select an employee first.');
      if (!(await app.confirm(`Delete ${sel.length} user(s) from the DEVICE (including fingerprints)?\nThe data stays in the software.`))) return;
      body = { ids: sel };
    }
    setBusy(what);
    const r = await app.run(() => api.post(`/employees/device/${what}`, { ...body, deviceId: app.selectedDevices[0] }));
    setBusy('');
    if (r) {
      await app.alert(r.message);
      if (what === 'download') { await load(); app.dataChanged(); }
    }
  };

  const photo = async (file: File | undefined) => {
    if (!file) return;
    const b64 = await app.run(() => toBase64Jpeg(file));
    if (b64) { set('PhotoBase64', b64); await app.alert("Photo loaded. It will be saved to the database when you click 'Save' or 'Upload'."); }
  };

  const importExcel = async (file: File | undefined) => {
    if (!file) return;
    setBusy('import');
    const r = await app.run(() => api.upload('/employees/import', file));
    setBusy('');
    if (excelRef.current) excelRef.current.value = '';
    if (r) { await load(); app.dataChanged(); await app.alert(r.message); }
  };

  const exportExcel = () => app.run(async () => {
    await api.download('/employees/export', { ids: rows.map((r) => r.Id) });
    await app.alert('Exported.\n\nYou can edit this file and load it back with \'Import\'.');
  });

  const deleteFinger = async () => {
    if (!form.Id) return;
    const r = await app.run(() => api.del(`/employees/${form.Id}/fingers/${finger}`));
    if (r) { await app.alert(r.message); await show(form.Id); }
  };

  const enroll = () => app.alert(
    'The LX50 cannot start an enrolment remotely (tested).\n\nEnroll the finger on the device: Menu → User Mgt → choose the user → Fingerprint.\n' +
    "Save and 'Upload' the employee first, so the user exists on the device.");

  const toolbar = (
    <>
      <Button icon="refresh" onClick={() => app.run(() => load())}>Browse</Button>
      <span className="h-5 border-l border-slate-300" />
      <Button icon="add" onClick={() => app.run(newEmployee)}>Add</Button>
      <Button icon="save" variant="primary" onClick={() => save()}>Save</Button>
      <Button icon="close" variant="danger" onClick={del}>Delete</Button>
      <Button icon="undo" onClick={() => app.run(() => (form.Id ? show(form.Id) : newEmployee()))}>Cancel</Button>
      <span className="h-5 border-l border-slate-300" />
      <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); app.run(() => load()); }}>
        <Input placeholder="AC No / Name" value={search} onChange={(e) => setSearch(e.target.value)} className="w-40" />
        <Button icon="search" type="submit">Search</Button>
      </form>
      <span className="h-5 border-l border-slate-300" />
      <Button icon="upload" busy={busy === 'upload'} onClick={() => device('upload')}>Upload</Button>
      <Button icon="download" busy={busy === 'download'} onClick={() => device('download')}>Download</Button>
      <Button icon="trash" busy={busy === 'delete'} onClick={() => device('delete')}>Del(Device)</Button>
      <span className="h-5 border-l border-slate-300" />
      <Button icon="import" busy={busy === 'import'} onClick={() => excelRef.current?.click()}>Import</Button>
      <Button icon="export" onClick={exportExcel}>Export</Button>
      <input ref={excelRef} type="file" accept=".xlsx" hidden onChange={(e) => importExcel(e.target.files?.[0])} />
    </>
  );

  const text = (k: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field label={label}><Input value={String(form[k] ?? '')} onChange={(e) => set(k, e.target.value as never)} {...props} /></Field>
  );

  return (
    <Page title="Employee List" icon="people" toolbar={toolbar} bodyClass="flex flex-col gap-3">
      <div className="flex min-h-56 flex-1 gap-3">
        <div className="flex w-56 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50 px-2 py-1.5"><Check label="include sub department" checked={includeSub} onChange={setIncludeSub} /></div>
          <div className="min-h-0 flex-1 overflow-auto p-1.5 scroll-thin">
            <DeptTree company={company} depts={depts} selected={dept} onSelect={setDept} />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <DataTable rows={rows} rowKey={(r) => r.Id} selected={sel} onSelect={select}
            columns={[
              { key: 'EnrollNo', header: 'AC No' }, { key: 'BadgeNo', header: 'No.' }, { key: 'Name', header: 'Name' }, { key: 'Gender', header: 'Gender' },
              { key: 'Designation', header: 'Title' }, { key: 'Phone', header: 'Mobile/Pager' }, { key: 'Department', header: 'Department' },
              { key: 'IsActive', header: 'Active', render: (r) => (r.IsActive ? '' : <span className="text-red-600">Inactive</span>) },
            ]} />
          <div className="border-t border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">Record Count {rows.length}</div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="px-3 pt-2">
          <Tabs tabs={[{ key: 'basic', label: 'Basic Information' }, { key: 'addition', label: 'Addition' }, { key: 'ac', label: 'AC Options' },
            { key: 'hr', label: 'HR Profile' }, { key: 'salary', label: 'Salary Structure' }, { key: 'docs', label: 'Documents' },
            ...(app.can('inventory') ? [{ key: 'store' as const, label: 'Store Items' }] : [])]} value={tab} onChange={setTab} />
        </div>
        <div className="p-4">
          {tab === 'basic' && (
            <div className="flex flex-col gap-4 xl:flex-row">
              <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2.5 md:grid-cols-4">
                {text('EnrollNo', 'AC No')}
                <div className="md:col-span-2">{text('Name', 'Name')}</div>
                <Field label="Gender"><Select value={form.Gender} onChange={(e) => set('Gender', e.target.value)}><option value="" /><option>Male</option><option>Female</option></Select></Field>
                {text('BadgeNo', 'No.')}
                {text('Nationality', 'Nationality')}
                {text('OfficeTel', 'Office Tel')}
                {text('Designation', 'Title')}
                <Field label="Privilege"><Select value={form.Admin ? '1' : '0'} onChange={(e) => set('Admin', e.target.value === '1')}><option value="0">User</option><option value="1">Administrator</option></Select></Field>
                {text('BirthDate', 'Date of Birth', { type: 'date' })}
                {text('JoinDate', 'Date of Employment', { type: 'date' })}
                {text('CardNo', 'CardNumber')}
                {text('Phone', 'Mobile No')}
                <div className="col-span-2 md:col-span-3">{text('HomeAddress', 'Home Add')}</div>
              </div>

              <fieldset className="w-40 shrink-0 rounded-md border border-slate-200 p-2">
                <legend className="px-1 text-xs font-medium text-slate-600">Photo</legend>
                <div className="grid h-40 place-items-center overflow-hidden rounded border border-slate-200 bg-slate-50">
                  {form.PhotoBase64
                    ? <img src={`data:image/jpeg;base64,${form.PhotoBase64}`} alt={`Photo of ${form.Name}`} className="h-full w-full object-contain" />
                    : <Icon name="person" className="size-16 text-slate-300" />}
                </div>
                <div className="mt-2 flex gap-1">
                  <Button icon="folder" className="flex-1 justify-center" onClick={() => fileRef.current?.click()} aria-label="Load photo" />
                  <Button icon="trash" variant="danger" className="flex-1 justify-center" onClick={() => set('PhotoBase64', '')} aria-label="Remove photo" />
                </div>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { photo(e.target.files?.[0]); e.target.value = ''; }} />
              </fieldset>

              <fieldset className="w-full shrink-0 rounded-md border border-slate-200 p-3 xl:w-72">
                <legend className="px-1 text-xs font-medium text-slate-600">Fingerprint manage</legend>
                <Select value={finger} onChange={(e) => setFinger(+e.target.value)}>
                  {FINGER_NAMES.map((n, i) => <option key={n} value={i}>{n}{form.fingers.includes(i) ? '  ✔' : ''}</option>)}
                </Select>
                <div className="mt-2 flex gap-2">
                  <Button icon="finger" onClick={enroll}>Enroll</Button>
                  <Button icon="trash" onClick={deleteFinger}>Delete FP</Button>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {form.fingers.length ? `${form.fingers.length} fingerprint template(s) saved in the software.` : 'No fingerprint template saved in the software.'}
                  {' '}The LX50 enrolls fingers in its own menu.
                </p>
              </fieldset>
            </div>
          )}

          {tab === 'addition' && (
            <div className="grid max-w-3xl grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
              <Field label="Department">
                <Select value={form.DepartmentId} onChange={(e) => set('DepartmentId', +e.target.value)}>
                  <option value={0}>(none)</option>
                  {[...depts].sort((a, b) => a.Name.localeCompare(b.Name)).map((d) => <option key={d.Id} value={d.Id}>{d.Name}</option>)}
                </Select>
              </Field>
              <Field label="Monthly Salary (₹)"><Input type="number" min={0} step={500} value={form.MonthlySalary} onChange={(e) => set('MonthlySalary', +e.target.value)} /></Field>
              <Field label="Shift / Timetable">
                <Select value={form.ShiftId} onChange={(e) => set('ShiftId', +e.target.value)}>
                  <option value={0}>(none)</option>
                  {shifts.map((s) => <option key={s.Id} value={s.Id}>{s.Label}</option>)}
                </Select>
              </Field>
              <Field label="OT Rate / Hour (₹)" hint="OT rate 0 = calculated from salary (one hour's pay × OT multiplier, see Salary Rule)">
                <Input type="number" min={0} step={10} value={form.OtRatePerHour} onChange={(e) => set('OtRatePerHour', +e.target.value)} />
              </Field>
              {text('Email', 'Email', { type: 'email' })}
              <div className="md:col-span-2"><Check label="Active (include in attendance calculation)" checked={form.IsActive} onChange={(v) => set('IsActive', v)} /></div>
              <div className="md:col-span-2"><Note>Late / early / overtime are calculated from the shift. Create shifts in 'Maintenance Timetables'.</Note></div>
            </div>
          )}

          {tab === 'hr' && <HrProfileTab employeeId={form.Id} value={form.Profile} onChange={(p) => set('Profile', p)} />}
          {tab === 'salary' && <SalaryTab rows={form.Salary} salary={form.MonthlySalary} onChange={(r) => set('Salary', r)} />}
          {tab === 'docs' && <DocumentsTab employeeId={form.Id} />}
          {tab === 'store' && <EmployeeItemsTab employeeId={form.Id} />}

          {tab === 'ac' && (
            <div className="max-w-md space-y-3">
              {text('DevicePassword', 'Device Password', { inputMode: 'numeric' })}
              <Check label="Enabled on device" checked={form.IsActive} onChange={(v) => set('IsActive', v)} />
              <Note>{"A user with the 'Administrator' privilege can open the device menu.\nPassword / Card number are uploaded to the device for verification ('Upload' button)."}</Note>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
