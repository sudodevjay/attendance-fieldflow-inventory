/** App-wide state: message boxes (alert / confirm / prompt), the selected devices of the Machine List, data-changed signal. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Button, Input, Modal } from './ui';

type Dialog =
  | { kind: 'alert'; title: string; text: string; resolve: () => void }
  | { kind: 'confirm'; title: string; text: string; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; title: string; text: string; value: string; resolve: (v: string | null) => void };

interface AppCtx {
  user: string;
  /** Role (Admin / HR / Payroll / Viewer) and the areas it may open (read) and change (write). */
  role: string;
  can: (area: string, write?: boolean) => boolean;
  company: string;
  alert: (text: string, title?: string) => Promise<void>;
  confirm: (text: string, title?: string) => Promise<boolean>;
  prompt: (text: string, value?: string, title?: string) => Promise<string | null>;
  /** Runs an action and shows its error in a message box; returns undefined on error. */
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  selectedDevices: number[];
  setSelectedDevices: (ids: number[]) => void;
  /** Increments when attendance data changed (screens reload). */
  dataVersion: number;
  dataChanged: () => void;
  logout: () => void;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}

export interface Permissions { read: string[]; write: string[] }

export function AppProvider({ user, role = 'Admin', permissions, company, logout, children }:
  { user: string; role?: string; permissions?: Permissions; company: string; logout: () => void; children: ReactNode }) {
  const [queue, setQueue] = useState<Dialog[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<number[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const push = (d: Dialog) => setQueue((q) => [...q, d]);
  const pop = () => setQueue((q) => q.slice(1));

  const alert = useCallback((text: string, title = 'Attendance Management Program') =>
    new Promise<void>((resolve) => push({ kind: 'alert', title, text, resolve })), []);
  const confirm = useCallback((text: string, title = 'Confirm') =>
    new Promise<boolean>((resolve) => push({ kind: 'confirm', title, text, resolve })), []);
  const prompt = useCallback((text: string, value = '', title = 'Input') =>
    new Promise<string | null>((resolve) => push({ kind: 'prompt', title, text, value, resolve })), []);
  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    try { return await fn(); } catch (e: any) { await alert(e?.message ?? String(e), 'Error'); return undefined; }
  }, [alert]);
  const dataChanged = useCallback(() => setDataVersion((v) => v + 1), []);
  const can = useCallback((area: string, write = false) => !permissions || (write ? permissions.write : permissions.read).includes(area), [permissions]);

  const value = useMemo(() => ({ user, role, can, company, alert, confirm, prompt, run, selectedDevices, setSelectedDevices, dataVersion, dataChanged, logout }),
    [user, role, can, company, alert, confirm, prompt, run, selectedDevices, dataVersion, dataChanged, logout]);

  const d = queue[0];
  return (
    <Ctx.Provider value={value}>
      {children}
      {d && <DialogBox key={queue.length} d={d} done={pop} />}
    </Ctx.Provider>
  );
}

function DialogBox({ d, done }: { d: Dialog; done: () => void }) {
  const [text, setText] = useState(d.kind === 'prompt' ? d.value : '');
  const finish = (ok: boolean) => {
    done();
    if (d.kind === 'alert') d.resolve();
    else if (d.kind === 'confirm') d.resolve(ok);
    else d.resolve(ok ? text.trim() : null);
  };
  const error = d.title === 'Error';
  return (
    <Modal title={d.title} onClose={() => finish(false)} width="max-w-md"
      footer={d.kind === 'alert'
        ? <Button variant="primary" onClick={() => finish(true)} autoFocus>OK</Button>
        : <>
          <Button onClick={() => finish(false)}>{d.kind === 'confirm' ? 'No' : 'Cancel'}</Button>
          <Button variant="primary" onClick={() => finish(true)} autoFocus={d.kind === 'confirm'}>{d.kind === 'confirm' ? 'Yes' : 'OK'}</Button>
        </>}>
      <div className={`whitespace-pre-line font-[450] leading-relaxed ${error ? 'text-red-700' : ''}`}
        style={{ fontFamily: d.text.includes(' : ') ? 'Consolas, ui-monospace, monospace' : undefined }}>{d.text}</div>
      {d.kind === 'prompt' && (
        <form className="mt-3" onSubmit={(e) => { e.preventDefault(); finish(true); }}>
          <Input value={text} onChange={(e) => setText(e.target.value)} />
        </form>
      )}
    </Modal>
  );
}
