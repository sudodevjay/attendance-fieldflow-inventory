/** Small building blocks shared by every screen. */
import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

// ------------------------------------------------------------------ icons (24px stroke icons)

const PATHS: Record<string, string> = {
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 2',
  report: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8M8 9h2',
  device: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2M9 7h6v4H9zM9 15h.01M12 15h.01M15 15h.01M9 18h.01M12 18h.01M15 18h.01',
  close: 'M18 6 6 18M6 6l12 12',
  play: 'M6 4l14 8-14 8z',
  stop: 'M6 6h12v12H6z',
  power: 'M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0',
  import: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  export: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  backup: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  usb: 'M12 2v14M8 6l4-4 4 4M7 11v2l5 3M17 9v3l-5 3M12 22a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  rule: 'M21 10H3M21 6H3M21 14H3M21 18H3',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.35-4.35',
  home: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10',
  lock: 'M5 11h14v10H5zM7 11V7a5 5 0 0 1 10 0v4',
  wifi: 'M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01',
  timer: 'M10 2h4M12 14l3-3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1',
  add: 'M12 5v14M5 12h14',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  sync: 'M21 12a9 9 0 0 1-15 6.7L3 16M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M3 21v-5h5',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 16v-4M12 8h.01',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  refresh: 'M23 4v6h-6M20.5 15a9 9 0 1 1-2.1-9.4L23 10',
  photo: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M21 15l-5-5L5 21',
  door: 'M3 21h18M5 21V3h14v18M15 12h.01',
  calendar: 'M3 4h18v18H3zM16 2v4M8 2v4M3 10h18',
  table: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
  undo: 'M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13',
  check: 'M20 6 9 17l-5-5',
  chevron: 'M6 9l6 6 6-6',
  person: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  finger: 'M12 11c0 3.5-1 6.5-2.5 9M8 5.5A7 7 0 0 1 19 11c0 2-.3 4-.9 6M5 9a7 7 0 0 0-.5 2.5c0 2 .4 3.8 1 5.5M12 7a4 4 0 0 1 4 4c0 1.7-.2 3.3-.6 4.9M8.2 13.5c-.1-.8-.2-1.6-.2-2.5a4 4 0 0 1 .8-2.4',
  pi: 'M4 4h16v16H4zM9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3',
  menu: 'M3 12h18M3 6h18M3 18h18',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
};

export function Icon({ name, className = 'size-4', color }: { name: string; className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color ?? 'currentColor'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 ${className}`} aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.info} />
    </svg>
  );
}

// ------------------------------------------------------------------ controls

type Variant = 'default' | 'primary' | 'success' | 'danger' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  default: 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50',
  primary: 'bg-brand-600 border-brand-600 text-white hover:bg-brand-700',
  success: 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700',
  danger: 'bg-white border-red-300 text-red-700 hover:bg-red-50',
  ghost: 'bg-transparent border-transparent text-slate-600 hover:bg-slate-200/60',
};

export function Button({ variant = 'default', icon, children, className = '', busy, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: string; busy?: boolean }) {
  return (
    <button type="button" {...rest} disabled={rest.disabled || busy}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium shadow-sm transition
        disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}>
      {busy ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon && <Icon name={icon} className="size-3.5" />}
      {children}
    </button>
  );
}

/** Full width unless the caller gives a width (w-…). */
const width = (cls?: string) => (/(^|\s)w-/.test(cls ?? '') ? '' : 'w-full');
const inputCls = 'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[13px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100 disabled:text-slate-400';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${width(props.className)} ${props.className ?? ''}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputCls} ${width(props.className)} ${props.className ?? ''}`} />;
}

export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} pr-7 ${width(props.className)} ${props.className ?? ''}`}>{children}</select>;
}

export function Check({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`inline-flex items-center gap-2 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input type="checkbox" className="size-4 accent-brand-600" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Label + control in a form grid. */
export function Field({ label, children, hint, className = '' }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Note({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' | 'info' }) {
  const cls = tone === 'warn' ? 'bg-amber-50 text-amber-800 border-amber-200' : tone === 'info' ? 'bg-brand-50 text-brand-900 border-brand-100' : 'bg-slate-50 text-slate-600 border-slate-200';
  return <div className={`rounded-md border px-3 py-2 text-xs leading-relaxed whitespace-pre-line ${cls}`}>{children}</div>;
}

// ------------------------------------------------------------------ layout pieces

/** Title bar of a screen plus its toolbar (like the WinForms page toolbar). */
export function Page({ title, icon, toolbar, children, bodyClass = '' }: { title: string; icon?: string; toolbar?: ReactNode; children: ReactNode; bodyClass?: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-gradient-to-b from-white to-brand-50 px-4 py-2">
        {icon && <Icon name={icon} className="size-4 text-brand-700" />}
        <h1 className="text-sm font-semibold text-brand-900">{title}</h1>
      </div>
      {toolbar && <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">{toolbar}</div>}
      <div className={`min-h-0 flex-1 overflow-auto p-4 scroll-thin ${bodyClass}`}>{children}</div>
    </div>
  );
}

export function Card({ children, className = '', title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={`flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex items-center gap-2 border-b border-slate-200 bg-gradient-to-b from-white to-slate-50 px-3 py-1.5">
          <div className="flex-1 text-[13px] font-semibold text-brand-900">{title}</div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="flex gap-1 border-b border-slate-200">
      {tabs.map((t) => (
        <button key={t.key} type="button" onClick={() => onChange(t.key)}
          className={`-mb-px rounded-t-md border px-4 py-1.5 text-[13px] font-medium transition ${value === t.key
            ? 'border-slate-200 border-b-white border-t-2 border-t-amber-400 bg-white text-brand-900'
            : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, children, footer, onClose, width = 'max-w-lg' }:
  { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; width?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select, textarea')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[8vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" className={`w-full ${width} overflow-hidden rounded-lg bg-white shadow-2xl`}>
        <div className="flex items-center gap-2 bg-gradient-to-r from-brand-800 to-brand-600 px-4 py-2 text-white">
          <h2 className="flex-1 text-sm font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded p-0.5 hover:bg-white/20" aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4 scroll-thin">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5">{footer}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ status colors (same as Excel / PDF)

const STATUS: Record<string, string> = {
  P: 'bg-green-100 text-green-800', Approved: 'bg-green-100 text-green-800', Online: 'bg-green-100 text-green-800',
  A: 'bg-red-100 text-red-800', Rejected: 'bg-red-100 text-red-800', Offline: 'bg-red-100 text-red-800',
  HD: 'bg-amber-100 text-amber-800', Pending: 'bg-amber-100 text-amber-800',
  H: 'bg-indigo-100 text-indigo-800', WO: 'bg-zinc-200 text-zinc-700',
  'Windows program': 'bg-slate-100 text-slate-600',
};

export function StatusBadge({ value }: { value: string }) {
  if (value === '' || value === '-') return <span className="text-slate-400">{value}</span>;
  return <span className={`inline-block min-w-7 rounded px-1.5 py-0.5 text-center text-xs font-semibold ${STATUS[value] ?? 'bg-purple-100 text-purple-800'}`}>{value}</span>;
}

export const FINGER_NAMES = ['Left Little', 'Left Ring', 'Left Middle', 'Left Index', 'Left Thumb',
  'Right Thumb', 'Right Index', 'Right Middle', 'Right Ring', 'Right Little'];
