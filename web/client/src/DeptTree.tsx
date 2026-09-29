/** Company → department → sub-department tree (Employee List and Department Management). */
import { useState } from 'react';
import { Icon } from './ui';

export interface Dept { Id: number; Name: string; ParentId: number | null; Employees?: number }

export function DeptTree({ company, depts, selected, onSelect, onMove, onRename }: {
  company: string;
  depts: Dept[];
  /** null = the company (all departments). */
  selected: number | null;
  onSelect: (id: number | null) => void;
  /** Drag & drop: move `id` under `parent` (null = directly under the company). */
  onMove?: (id: number, parent: number | null) => void;
  onRename?: (id: number) => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | 'root' | null>(null);
  const ids = new Set(depts.map((d) => d.Id));
  const children = (parent: number | null) =>
    depts.filter((d) => (parent === null ? d.ParentId === null || !ids.has(d.ParentId) : d.ParentId === parent));

  const dropProps = (target: number | null) => onMove ? {
    onDragOver: (e: React.DragEvent) => { if (drag !== null) { e.preventDefault(); setOver(target ?? 'root'); } },
    onDragLeave: () => setOver(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(null);
      if (drag !== null && drag !== target) onMove(drag, target);
      setDrag(null);
    },
  } : {};

  const node = (d: Dept, depth: number): React.ReactNode => (
    <li key={d.Id}>
      <div draggable={!!onMove} onDragStart={() => setDrag(d.Id)} onDragEnd={() => { setDrag(null); setOver(null); }} {...dropProps(d.Id)}
        onClick={() => onSelect(d.Id)} onDoubleClick={() => onRename?.(d.Id)}
        className={`flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 ${selected === d.Id ? 'bg-brand-600 text-white' : 'hover:bg-brand-50'}
          ${over === d.Id ? 'ring-2 ring-amber-400' : ''}`}
        style={{ marginLeft: depth * 14 }}>
        <Icon name="folder" className="size-3.5" color={selected === d.Id ? '#fde68a' : '#b8860b'} />
        <span className="truncate">{d.Name}</span>
        {d.Employees !== undefined && <span className={`ml-auto text-[11px] ${selected === d.Id ? 'text-white/80' : 'text-slate-400'}`}>{d.Employees}</span>}
      </div>
      {children(d.Id).length > 0 && <ul>{children(d.Id).map((c) => node(c, depth + 1))}</ul>}
    </li>
  );

  return (
    <ul className="select-none text-[13px]">
      <li>
        <div {...dropProps(null)} onClick={() => onSelect(null)}
          className={`flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 font-semibold ${selected === null ? 'bg-brand-600 text-white' : 'hover:bg-brand-50'}
            ${over === 'root' ? 'ring-2 ring-amber-400' : ''}`}>
          <Icon name="home" className="size-3.5" color={selected === null ? '#bbf7d0' : '#2e8b57'} />{company}
        </div>
        <ul className="mt-0.5">{children(null).map((d) => node(d, 1))}</ul>
      </li>
    </ul>
  );
}
