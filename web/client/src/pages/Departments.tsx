/** Department Management: company tree with sub-departments; add, delete, rename, drag & drop to move. */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../app';
import { DeptTree, type Dept } from '../DeptTree';
import { Button, Icon, Page } from '../ui';

export function Departments() {
  const app = useApp();
  const navigate = useNavigate();
  const [company, setCompany] = useState('');
  const [depts, setDepts] = useState<Dept[]>([]);
  const [sel, setSel] = useState<number | null>(null);

  const load = useCallback(() => api.get('/departments').then((r) => { setCompany(r.company); setDepts(r.departments); }), []);
  useEffect(() => { app.run(load); }, [load, app.dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    const name = await app.prompt('Input name of the department to add', '', 'Add New Department');
    if (!name) return;
    const r = await app.run(() => api.post('/departments', { name, parentId: sel }));
    if (r) { await load(); setSel(r.id); app.dataChanged(); }
  };
  const rename = async (id = sel) => {
    const d = depts.find((x) => x.Id === id);
    if (!d) return;
    const name = await app.prompt('New name of the department', d.Name, 'Rename');
    if (name && name !== d.Name && (await app.run(() => api.put(`/departments/${d.Id}`, { name })))) { await load(); app.dataChanged(); }
  };
  const del = async () => {
    const d = depts.find((x) => x.Id === sel);
    if (!d) return;
    if (depts.some((x) => x.ParentId === d.Id)) return app.alert('This department has sub-departments. Delete or move them first.');
    if (!(await app.confirm(`Delete department '${d.Name}'?` + (d.Employees ? `\n${d.Employees} employee(s) will be left without a department.` : '')))) return;
    if (await app.run(() => api.del(`/departments/${d.Id}`))) { setSel(null); await load(); app.dataChanged(); }
  };
  const move = async (id: number, parentId: number | null) => {
    if (await app.run(() => api.put(`/departments/${id}`, { parentId }))) { await load(); setSel(id); }
  };

  const toolbar = (
    <>
      <Button icon="add" onClick={add}>Add</Button>
      <Button icon="close" variant="danger" onClick={del} disabled={sel === null}>Delete</Button>
      <Button icon="check" onClick={() => rename()} disabled={sel === null}>Rename</Button>
      <Button icon="people" onClick={() => navigate(`/employees${sel ? `?dept=${sel}` : ''}`)}>Employee</Button>
    </>
  );

  return (
    <Page title="Department Management" icon="home" toolbar={toolbar}>
      <div className="flex max-w-4xl flex-col gap-3 md:flex-row">
        <div className="min-h-80 flex-1 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          <DeptTree company={company} depts={depts} selected={sel} onSelect={setSel} onMove={move} onRename={(id) => rename(id)} />
        </div>
        <aside className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-[13px] leading-relaxed text-slate-700 md:w-72">
          <div className="mb-2 flex items-center gap-2 font-semibold"><Icon name="info" className="size-5 text-amber-600" />Prompt</div>
          <p>Here you can set up department names.</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-4">
            <li>New department: select the department to create it under and click 'Add'.</li>
            <li>Rename: select a department and press 'Rename' (or double click it).</li>
            <li>To move a department under another one, drag it with the mouse and drop it on the new 'superior' department.</li>
          </ul>
        </aside>
      </div>
    </Page>
  );
}
