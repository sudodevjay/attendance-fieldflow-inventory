/**
 * /wifisetup — Wi-Fi of the Raspberry Pi from anywhere (phone or PC). Own password (not the administrator login).
 * The Pi's Wi-Fi agent picks up the commands within a few seconds: scan the networks around it, or connect to one.
 * The new network replaces the previous one; the fallback Wi-Fi (e.g. the phone hotspot) always stays saved.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Icon, Input } from '../ui';

const TOKEN_KEY = 'zk.wifi';
const getToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; } };
const setToken = (t: string) => { try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };

class HttpError extends Error { constructor(msg: string, public status: number) { super(msg); } }

async function call<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/wifisetup' + url, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    });
  } catch { throw new HttpError('The server cannot be reached. Check the internet connection.', 0); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(data.error ?? `${res.status} ${res.statusText}`, res.status);
  return data;
}

interface Network { ssid: string; signal: number; security: string; inUse: boolean }
interface Pi {
  name: string; online: boolean; ssid: string; ip: string; signal: number | null; fallback: string; lastSeenSeconds: number;
  scan: { at: string; networks: Network[] } | null;
}
interface Job { id: number; kind: 'scan' | 'connect'; ssid?: string; started: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Bars({ signal }: { signal: number }) {
  const n = signal >= 75 ? 4 : signal >= 50 ? 3 : signal >= 25 ? 2 : 1;
  return (
    <span className="inline-flex items-end gap-0.5" aria-label={`signal ${signal}%`}>
      {[1, 2, 3, 4].map((i) => <span key={i} className={`w-1 rounded-sm ${i <= n ? 'bg-brand-600' : 'bg-slate-200'}`} style={{ height: 3 + i * 3 }} />)}
    </span>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await call('POST', '/login', { password });
      setToken(r.token);
      onDone();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="grid min-h-full place-items-center bg-gradient-to-br from-brand-900 via-brand-700 to-nav p-4">
      <form onSubmit={submit} className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center gap-3 bg-gradient-to-r from-brand-800 to-brand-600 px-5 py-4 text-white">
          <Icon name="wifi" className="size-8 text-amber-300" />
          <div>
            <div className="font-semibold">Raspberry Pi Wi-Fi setup</div>
            <div className="text-xs text-white/75">Enter the Wi-Fi setup password</div>
          </div>
        </div>
        <div className="space-y-3 p-5">
          <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Password</span>
            <Input type="password" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} /></label>
          {error && <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error}</div>}
          <Button type="submit" variant="primary" busy={busy} className="w-full justify-center">Open</Button>
        </div>
      </form>
    </div>
  );
}

function PiCard({ pi, onMessage }: { pi: Pi; onMessage: (m: { tone: 'ok' | 'err' | 'info'; text: string }) => void }) {
  const [job, setJob] = useState<Job | null>(null);
  const [chosen, setChosen] = useState<Network | null>(null);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const wait = useCallback(async (j: Job) => {
    setJob(j);
    const limit = j.kind === 'scan' ? 90_000 : 180_000;
    while (alive.current && Date.now() - j.started < limit) {
      await sleep(3000);
      try {
        const c = await call('GET', `/commands/${j.id}`);
        if (c.status === 'done' || c.status === 'failed') {
          setJob(null);
          if (j.kind === 'scan') {
            if (c.status === 'failed') onMessage({ tone: 'err', text: `Scan failed: ${c.error}` });
          } else if (c.status === 'done') {
            onMessage({ tone: 'ok', text: `Connected to ${j.ssid}${c.result?.ip ? ` (IP ${c.result.ip})` : ''}. The previous Wi-Fi was removed; ${pi.fallback || 'the fallback'} stays as fallback.` });
            setChosen(null); setPassword('');
          } else onMessage({ tone: 'err', text: `Could not connect to ${j.ssid}: ${c.error}` });
          return;
        }
      } catch { /* the Pi may be switching networks; keep waiting */ }
    }
    if (alive.current) {
      setJob(null);
      onMessage({ tone: 'err', text: j.kind === 'scan' ? 'The Pi did not answer. Is it on and online?' : `No answer from the Pi yet. If ${j.ssid} did not work, the Pi goes back to its previous Wi-Fi or ${pi.fallback || 'the fallback'} by itself.` });
    }
  }, [onMessage, pi.fallback]);

  const scan = async () => {
    try {
      const r = await call('POST', '/scan', { pi: pi.name });
      wait({ id: r.id, kind: 'scan', started: Date.now() });
    } catch (e: any) { onMessage({ tone: 'err', text: e.message }); }
  };

  const connect = async () => {
    if (!chosen) return;
    try {
      const r = await call('POST', '/connect', { pi: pi.name, ssid: chosen.ssid, password });
      onMessage({ tone: 'info', text: `The Pi is switching to ${chosen.ssid}. It is offline for up to a minute while it changes networks.` });
      wait({ id: r.id, kind: 'connect', ssid: chosen.ssid, started: Date.now() });
    } catch (e: any) { onMessage({ tone: 'err', text: e.message }); }
  };

  const networks = (pi.scan?.networks ?? []).slice().sort((a, b) => Number(b.inUse) - Number(a.inUse) || b.signal - a.signal);
  const open = (n: Network) => !n.security || n.security === '--';

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <span className={`size-2.5 rounded-full ${pi.online ? 'bg-green-500' : 'bg-slate-300'}`} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-800">{pi.name}</div>
          <div className="text-xs text-slate-500">
            {pi.online ? 'Online' : `Offline (last seen ${Math.round(pi.lastSeenSeconds / 60)} min ago)`}
            {pi.ssid && <> · Wi-Fi <b className="text-slate-700">{pi.ssid}</b></>}
            {pi.ip && <> · IP {pi.ip}</>}
          </div>
          {pi.fallback && <div className="text-xs text-slate-500">Fallback (always saved): {pi.fallback}</div>}
        </div>
        <Button icon="refresh" busy={job?.kind === 'scan'} disabled={!!job || !pi.online} onClick={scan}>Scan Wi-Fi</Button>
      </div>

      {job && (
        <div className="bg-brand-50 px-4 py-2 text-sm text-brand-800">
          {job.kind === 'scan' ? 'The Pi is looking for Wi-Fi networks… (about 10–20 seconds)' : `Connecting to ${job.ssid}… (up to a minute)`}
        </div>
      )}

      {!pi.scan && !job && <div className="px-4 py-6 text-center text-sm text-slate-500">Press <b>Scan Wi-Fi</b> to see the networks around the Pi.</div>}

      {pi.scan && (
        <>
          <div className="px-4 pt-3 text-xs text-slate-500">Networks near the Pi (scanned {pi.scan.at}) — tap one to connect</div>
          <ul className="divide-y divide-slate-100 p-2">
            {networks.map((n) => {
              const fallback = n.ssid === pi.fallback;
              const selected = chosen?.ssid === n.ssid;
              return (
                <li key={n.ssid}>
                  <button type="button" disabled={fallback || !!job}
                    onClick={() => { setChosen(selected ? null : n); setPassword(''); }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${selected ? 'bg-brand-50' : 'hover:bg-slate-50'} disabled:cursor-default`}>
                    <Bars signal={n.signal} />
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{n.ssid}</span>
                    {n.inUse && <span className="rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-700">Connected</span>}
                    {fallback && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">Fallback</span>}
                    {!open(n) && <Icon name="lock" className="size-3.5 text-slate-400" />}
                  </button>
                  {selected && (
                    <form className="flex flex-wrap items-center gap-2 px-3 pb-3" onSubmit={(e) => { e.preventDefault(); connect(); }}>
                      {!open(n) && (
                        <div className="relative min-w-48 flex-1">
                          <Input type={show ? 'text' : 'password'} placeholder={`Password of ${n.ssid}`} value={password} autoFocus
                            onChange={(e) => setPassword(e.target.value)} className="pr-14" />
                          <button type="button" onClick={() => setShow(!show)} className="absolute top-1/2 right-2 -translate-y-1/2 text-xs text-brand-700">{show ? 'Hide' : 'Show'}</button>
                        </div>
                      )}
                      <Button type="submit" variant="primary" disabled={!open(n) && password.length < 8}>Connect</Button>
                    </form>
                  )}
                </li>
              );
            })}
            {!networks.length && <li className="px-3 py-4 text-sm text-slate-500">No networks found. Scan again.</li>}
          </ul>
        </>
      )}
    </div>
  );
}

export function WifiSetupRoot() {
  const [logged, setLogged] = useState(!!getToken());
  const [pis, setPis] = useState<Pi[] | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err' | 'info'; text: string } | null>(null);

  const load = useCallback(async () => {
    try { setPis((await call('GET', '/state')).pis); } catch (e: any) {
      if (e.status === 401) { setToken(''); setLogged(false); }
    }
  }, []);

  useEffect(() => {
    document.title = 'Pi Wi-Fi setup';
    if (!logged) return;
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [logged, load]);

  if (!logged) return <Login onDone={() => setLogged(true)} />;
  return (
    <div className="min-h-full bg-slate-50">
      <header className="flex items-center gap-3 bg-gradient-to-r from-brand-800 to-brand-600 px-4 py-3 text-white">
        <Icon name="wifi" className="size-6 text-amber-300" />
        <div className="flex-1 font-semibold">Raspberry Pi Wi-Fi setup</div>
        <button className="text-sm text-white/80 hover:text-white" onClick={() => { call('POST', '/logout').catch(() => {}); setToken(''); setLogged(false); }}>Log out</button>
      </header>
      <main className="mx-auto max-w-xl space-y-4 p-4">
        {msg && (
          <div className={`rounded-lg px-4 py-3 text-sm ${msg.tone === 'ok' ? 'bg-green-50 text-green-800' : msg.tone === 'err' ? 'bg-red-50 text-red-700' : 'bg-brand-50 text-brand-800'}`} role="status">
            {msg.text}
          </div>
        )}
        {pis === null && <div className="text-sm text-slate-500">Loading…</div>}
        {pis?.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            No Pi has called in since the server started. Switch the Pi on; when it has internet (for example through the fallback
            hotspot) it shows up here within a few seconds.
          </div>
        )}
        {pis?.map((p) => <PiCard key={p.name} pi={p} onMessage={setMsg} />)}
        <p className="px-1 text-xs text-slate-500">
          Only two Wi-Fi networks stay saved on the Pi: the one chosen here (used first) and the fallback. If the new network
          does not work (wrong password, out of range), the Pi removes it and goes back to its previous Wi-Fi.
        </p>
      </main>
    </div>
  );
}
