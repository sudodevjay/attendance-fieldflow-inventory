/** Grid like the WinForms DataGridView: click to select, Ctrl / Shift for several rows, sortable columns, double click, right click. */
import { useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  /** Value used for sorting (default row[key]). */
  value?: (row: T) => unknown;
  align?: 'left' | 'center' | 'right';
  className?: string;
  sortable?: boolean;
}

type Key = string | number;

export function DataTable<T>({ columns, rows, rowKey, selected, onSelect, onDoubleClick, onContextMenu, empty = 'No records.', rowClass, compact, className = '' }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => Key;
  selected?: Key[];
  onSelect?: (keys: Key[]) => void;
  onDoubleClick?: (row: T) => void;
  onContextMenu?: (row: T, e: MouseEvent) => void;
  empty?: string;
  rowClass?: (row: T) => string;
  compact?: boolean;
  className?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const anchor = useRef<number>(-1);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const get = col?.value ?? ((r: T) => (r as any)[sort.key]);
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b);
      const nx = typeof x === 'number' ? x : Number(String(x ?? '').replace(/,/g, ''));
      const ny = typeof y === 'number' ? y : Number(String(y ?? '').replace(/,/g, ''));
      const cmp = !isNaN(nx) && !isNaN(ny) && String(x ?? '') !== '' && String(y ?? '') !== ''
        ? nx - ny : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true });
      return cmp * sort.dir;
    });
  }, [rows, sort, columns]);

  const sel = new Set(selected ?? []);

  function click(e: MouseEvent, i: number) {
    if (!onSelect) return;
    const key = rowKey(sorted[i]);
    if (e.shiftKey && anchor.current >= 0) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
      onSelect(sorted.slice(a, b + 1).map(rowKey));
    } else if (e.ctrlKey || e.metaKey) {
      onSelect(sel.has(key) ? [...sel].filter((k) => k !== key) : [...sel, key]);
      anchor.current = i;
    } else {
      onSelect([key]);
      anchor.current = i;
    }
  }

  const pad = compact ? 'px-2 py-1' : 'px-2.5 py-1.5';
  return (
    <div className={`min-h-0 flex-1 overflow-auto scroll-thin ${className}`}>
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col"
                onClick={() => c.sortable !== false && setSort((s) => (s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }))}
                className={`${pad} select-none whitespace-nowrap border-b border-r border-slate-200 bg-gradient-to-b from-slate-50 to-slate-200 text-left text-xs font-semibold text-slate-700 last:border-r-0
                  ${c.sortable !== false ? 'cursor-pointer hover:to-slate-300' : ''} ${c.align === 'center' ? 'text-center' : c.align === 'right' ? 'text-right' : ''}`}>
                {c.header}
                {sort?.key === c.key && <span className="ml-1 text-brand-700">{sort.dir === 1 ? '▲' : '▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-slate-400">{empty}</td></tr>
          )}
          {sorted.map((r, i) => {
            const key = rowKey(r);
            const on = sel.has(key);
            return (
              <tr key={key} onClick={(e) => click(e, i)} onDoubleClick={() => onDoubleClick?.(r)}
                onContextMenu={(e) => {
                  if (!onContextMenu) return;
                  e.preventDefault();
                  if (!on) { onSelect?.([key]); anchor.current = i; }
                  onContextMenu(r, e);
                }}
                className={`${on ? 'bg-brand-600 text-white' : i % 2 ? 'bg-slate-50/70 hover:bg-brand-50' : 'bg-white hover:bg-brand-50'}
                  ${onSelect ? 'cursor-default' : ''} ${rowClass && !on ? rowClass(r) : ''}`}>
                {columns.map((c) => (
                  <td key={c.key} className={`${pad} whitespace-nowrap border-b border-r border-slate-100 last:border-r-0
                    ${c.align === 'center' ? 'text-center' : c.align === 'right' ? 'text-right' : ''} ${c.className ?? ''}`}>
                    {c.render ? c.render(r) : String((r as any)[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
