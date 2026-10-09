/** Suppliers, stores (warehouses), categories and the automation settings of the inventory. */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api';
import { useApp } from '../../../app';
import { DataTable } from '../../../DataTable';
import { Button, Card, Check, Field, Input, Modal, Note, Page, Select, Tabs, TextArea } from '../../../ui';
import { EmployeePicker, inr, useInv } from '../shared';

type Tab = 'suppliers' | 'stores' | 'categories' | 'settings';

export function Masters() {
  const { me } = useInv();
  const [tab, setTab] = useState<Tab>((new URLSearchParams(location.search).get('tab') as Tab) || 'suppliers');
  const tabs: { key: Tab; label: string }[] = [{ key: 'suppliers', label: 'Suppliers' }, { key: 'stores', label: 'Stores' }, { key: 'categories', label: 'Categories' }];
  if (me.head) tabs.push({ key: 'settings', label: 'Automation settings' });
  return (
    <Page title="Suppliers, Stores, Categories" icon="folder" bodyClass="flex flex-col gap-2">
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'suppliers' && <Suppliers />}
      {tab === 'stores' && <Stores />}
      {tab === 'categories' && <Categories />}
      {tab === 'settings' && <Settings />}
    </Page>
  );
}

/** List + add / edit / delete of one master. */
function useMaster(path: string) {
  const app = useApp();
  const { reload } = useInv();
  const [rows, setRows] = useState<any[]>([]);
  const load = useCallback(() => api.get(`/inventory/${path}`).then(setRows), [path]);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (f: any) => {
    const r = await app.run(() => (f.Id ? api.put(`/inventory/${path}/${f.Id}`, f) : api.post(`/inventory/${path}`, f)));
    if (r) { await Promise.all([load(), reload()]); return true; }
    return false;
  };
  const remove = async (f: any) => {
    if (!(await app.confirm(`Delete ${f.Name}?`))) return;
    if (await app.run(() => api.del(`/inventory/${path}/${f.Id}`))) await Promise.all([load(), reload()]);
  };
  return { rows, save, remove };
}

function Grid({ rows, columns, onEdit, onDelete, empty }: { rows: any[]; columns: any[]; onEdit: (r: any) => void; onDelete: (r: any) => void; empty: string }) {
  const { me } = useInv();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <DataTable rows={rows} rowKey={(r) => r.Id} onDoubleClick={(r) => me.manage && onEdit({ ...r })} empty={empty}
        rowClass={(r) => (r.IsActive === false ? 'text-slate-400' : '')}
        columns={[...columns, ...(me.manage ? [{ key: 'Actions', header: '', sortable: false, render: (r: any) => (
          <span className="flex gap-1"><Button icon="edit" onClick={() => onEdit({ ...r })}>Edit</Button>{me.head && <Button variant="danger" icon="trash" onClick={() => onDelete(r)} aria-label="Delete" />}</span>) }] : [])]} />
    </div>
  );
}

function Suppliers() {
  const { me } = useInv();
  const m = useMaster('suppliers');
  const [edit, setEdit] = useState<any | null>(null);
  const set = (k: string, v: unknown) => setEdit((x: any) => ({ ...x, [k]: v }));
  return (
    <>
      {me.manage && <div><Button variant="primary" icon="add" onClick={() => setEdit({ LeadTimeDays: 7, IsActive: true })}>Add supplier</Button></div>}
      <Grid rows={m.rows} onEdit={setEdit} onDelete={m.remove} empty="No suppliers yet." columns={[
        { key: 'Name', header: 'Supplier' }, { key: 'ContactPerson', header: 'Contact' }, { key: 'Phone', header: 'Phone' }, { key: 'Email', header: 'E-mail' },
        { key: 'Gstin', header: 'GSTIN' }, { key: 'LeadTimeDays', header: 'Lead time', align: 'right', render: (r: any) => `${r.LeadTimeDays} d` },
        { key: 'Items', header: 'Items', align: 'right' }, { key: 'OpenPos', header: 'Open POs', align: 'right' },
        { key: 'IsActive', header: 'Active', render: (r: any) => (r.IsActive ? 'Yes' : 'No') },
      ]} />
      {edit && (
        <Modal title={edit.Id ? `Edit ${edit.Name}` : 'Add supplier'} onClose={() => setEdit(null)} width="max-w-xl"
          footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" icon="save" onClick={async () => { if (await m.save(edit)) setEdit(null); }}>Save</Button></>}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name *" className="col-span-2"><Input value={edit.Name ?? ''} onChange={(e) => set('Name', e.target.value)} /></Field>
            <Field label="Contact person"><Input value={edit.ContactPerson ?? ''} onChange={(e) => set('ContactPerson', e.target.value)} /></Field>
            <Field label="Phone"><Input value={edit.Phone ?? ''} onChange={(e) => set('Phone', e.target.value)} /></Field>
            <Field label="E-mail"><Input type="email" value={edit.Email ?? ''} onChange={(e) => set('Email', e.target.value)} /></Field>
            <Field label="GSTIN"><Input value={edit.Gstin ?? ''} onChange={(e) => set('Gstin', e.target.value.toUpperCase())} maxLength={15} /></Field>
            <Field label="Address" className="col-span-2"><TextArea rows={2} value={edit.Address ?? ''} onChange={(e) => set('Address', e.target.value)} /></Field>
            <Field label="Lead time (days)" hint="Expected delivery of a PO"><Input type="number" min={0} value={edit.LeadTimeDays} onChange={(e) => set('LeadTimeDays', e.target.value)} /></Field>
            <div className="flex items-center pt-4"><Check label="Active" checked={edit.IsActive !== false} onChange={(v) => set('IsActive', v)} /></div>
          </div>
        </Modal>
      )}
    </>
  );
}

function Stores() {
  const { me } = useInv();
  const m = useMaster('warehouses');
  const [edit, setEdit] = useState<any | null>(null);
  const set = (k: string, v: unknown) => setEdit((x: any) => ({ ...x, [k]: v }));
  return (
    <>
      {me.manage && <div><Button variant="primary" icon="add" onClick={() => setEdit({ IsActive: true })}>Add store</Button></div>}
      <Grid rows={m.rows} onEdit={setEdit} onDelete={m.remove} empty="No stores." columns={[
        { key: 'Name', header: 'Store' }, { key: 'Address', header: 'Address' }, { key: 'Incharge', header: 'In charge' },
        { key: 'Items', header: 'Items in stock', align: 'right' }, { key: 'Value', header: 'Stock value', align: 'right', render: (r: any) => inr(r.Value) },
        { key: 'IsActive', header: 'Active', render: (r: any) => (r.IsActive ? 'Yes' : 'No') },
      ]} />
      {edit && (
        <Modal title={edit.Id ? `Edit ${edit.Name}` : 'Add store'} onClose={() => setEdit(null)}
          footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" icon="save" onClick={async () => { if (await m.save(edit)) setEdit(null); }}>Save</Button></>}>
          <div className="space-y-3">
            <Field label="Name *"><Input value={edit.Name ?? ''} onChange={(e) => set('Name', e.target.value)} placeholder="e.g. Main Store, Site Store, Godown 2" /></Field>
            <Field label="Address"><Input value={edit.Address ?? ''} onChange={(e) => set('Address', e.target.value)} /></Field>
            <Field label="In charge (employee)"><EmployeePicker value={edit.InchargeId ?? null} onChange={(id) => set('InchargeId', id)} /></Field>
            <Check label="Active" checked={edit.IsActive !== false} onChange={(v) => set('IsActive', v)} />
          </div>
        </Modal>
      )}
    </>
  );
}

function Categories() {
  const app = useApp();
  const { me } = useInv();
  const m = useMaster('categories');
  const edit = async (r?: any) => {
    const name = await app.prompt('Category name', r?.Name ?? '', r ? 'Rename category' : 'Add category');
    if (name) await m.save({ Id: r?.Id, Name: name });
  };
  return (
    <>
      {me.manage && <div><Button variant="primary" icon="add" onClick={() => edit()}>Add category</Button></div>}
      <Grid rows={m.rows} onEdit={edit} onDelete={m.remove} empty="No categories." columns={[
        { key: 'Name', header: 'Category' }, { key: 'Items', header: 'Items', align: 'right' },
      ]} />
    </>
  );
}

function Settings() {
  const app = useApp();
  const { lk } = useInv();
  const [s, setS] = useState<Record<string, string> | null>(null);
  useEffect(() => { app.run(() => api.get('/inventory/settings').then(setS)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null;
  const set = (k: string, v: string) => setS({ ...s, [k]: v });
  const save = async () => {
    const r = await app.run(() => api.put('/inventory/settings', s));
    if (r) { setS(r); await app.alert('Settings saved.'); }
  };
  return (
    <Card title="What the inventory does by itself" actions={<Button variant="primary" icon="save" onClick={save}>Save</Button>}>
      <div className="grid max-w-3xl gap-4 p-4">
        <Field label="Automatic re-order" hint="When stock + quantity already on order falls to the item's re-order level, for items with a preferred supplier.">
          <Select value={s.AutoPO} onChange={(e) => set('AutoPO', e.target.value)}>
            <option value="draft">Make a draft PO (the store checks it and marks it ordered)</option>
            <option value="ordered">Place the PO directly (status Ordered)</option>
            <option value="off">Off — only a low-stock alert</option>
          </Select>
        </Field>
        <Field label="Requisition approval">
          <Select value={s.Approval} onChange={(e) => set('Approval', e.target.value)}>
            <option value="hod">HOD of the department (or the store / admin) approves first</option>
            <option value="none">No approval — requisitions are approved at once</option>
          </Select>
        </Field>
        <Check label="Issue automatically when approved and everything is in stock (and again when the goods arrive)" checked={s.AutoIssue === '1'} onChange={(v) => set('AutoIssue', v ? '1' : '0')} />
        <Check label="Allow stock below zero (not recommended)" checked={s.AllowNegative === '1'} onChange={(v) => set('AllowNegative', v ? '1' : '0')} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Default store" hint="Automatic POs, portal requests"><Select value={s.DefaultWarehouseId} onChange={(e) => set('DefaultWarehouseId', e.target.value)}>
            <option value="">First active store</option>{lk.warehouses.filter((w) => w.IsActive).map((w) => <option key={w.Id} value={w.Id}>{w.Name}</option>)}</Select></Field>
          <Field label="Remind about waiting requisitions after (days)"><Input type="number" min={1} max={90} value={s.PendingReminderDays} onChange={(e) => set('PendingReminderDays', e.target.value)} /></Field>
          <Field label="Remind employees about overdue items every (days)"><Input type="number" min={1} max={90} value={s.OverdueReminderDays} onChange={(e) => set('OverdueReminderDays', e.target.value)} /></Field>
          <Field label="Bin limit (open items per employee)" hint="0 = no limit; own limit per employee in Employee Bins"><Input type="number" min={0} value={s.BinLimit ?? '0'} onChange={(e) => set('BinLimit', e.target.value)} /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button icon="backup" onClick={() => app.run(() => api.download('/inventory/backup'))}>Backup inventory database</Button>
          <span className="text-xs text-slate-500">The inventory has its own database: the attendance backup (Database Option) does not contain it. SuperAdmin only.</span>
        </div>
        <Note tone="info">{'Daily checks (every day, and when the dashboard opens): re-order of all items, late POs, overdue returnable items (portal reminder to the employee), exit clearance for employees switched off in attendance, requisitions waiting too long.\nLast run: ' + (s.LastDailyRun || 'not yet')}</Note>
      </div>
    </Card>
  );
}
