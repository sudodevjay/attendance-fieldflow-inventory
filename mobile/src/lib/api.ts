/**
 * Talks to the attendance web server (web/server, /api/portal). The server address and the login token are kept on
 * the phone (SecureStore; localStorage on web, where SecureStore does not exist).
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const SERVER_KEY = 'zk_server';
const TOKEN_KEY = 'zk_token';

async function read(key: string): Promise<string> {
  if (Platform.OS === 'web') {
    try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
  }
  return (await SecureStore.getItemAsync(key)) ?? '';
}

async function write(key: string, value: string) {
  if (Platform.OS === 'web') {
    try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* private mode */ }
    return;
  }
  if (value) await SecureStore.setItemAsync(key, value);
  else await SecureStore.deleteItemAsync(key);
}

let server = '';
let token = '';
let onLogout: () => void = () => {};

export const session = {
  async load() {
    server = await read(SERVER_KEY);
    token = await read(TOKEN_KEY);
    return { server, token };
  },
  server: () => server,
  token: () => token,
  async setServer(url: string) {
    server = normalizeServer(url);
    await write(SERVER_KEY, server);
  },
  async setToken(t: string) {
    token = t;
    await write(TOKEN_KEY, t);
  },
  onLogout(fn: () => void) { onLogout = fn; },
};

/** "192.168.1.46:4000" -> "http://192.168.1.46:4000" (no trailing slash). */
export function normalizeServer(url: string) {
  let u = url.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = 'http://' + u;
  return u;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!server) throw new ApiError('Enter the server address first.', 0);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const form = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(`${server}/api/portal${path}`, { method, headers, body: body === undefined ? undefined : form ? (body as FormData) : JSON.stringify(body), signal: ctrl.signal });
  } catch {
    throw new ApiError(`Cannot reach the server (${server}). Check the Wi-Fi and the server address.`, 0);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 && path !== '/login') {
    await session.setToken('');
    onLogout();
  }
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* not JSON */ }
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  del: <T = any>(path: string) => request<T>('DELETE', path),
  /** multipart/form-data (document upload); the boundary is set by fetch. */
  upload: <T = any>(path: string, form: FormData) => request<T>('POST', path, form),
  /** URL a browser can open (payslip PDF, receipt) — the login token goes in the query string. */
  fileUrl: (path: string) => `${server}/api/portal${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`,
};

export const inr = (v: number) => '₹ ' + new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
export const two = (n: number) => String(n % 1 === 0 ? n : n.toFixed(1)).padStart(2, '0');
export const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
