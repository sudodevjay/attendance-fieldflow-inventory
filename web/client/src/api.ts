/** Calls to the Node server (/api). The login token is kept in sessionStorage. */

const TOKEN_KEY = 'zk.token';

export const getToken = () => {
  try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
};
export const setToken = (t: string) => {
  try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
};

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Called when the server says the login expired (the app shows the login screen). */
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

async function request(method: string, url: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch('/api' + url, { method, headers, body: payload });
  } catch {
    throw new ApiError('The server cannot be reached. Is the web server running?', 0);
  }
  if (res.status === 401 && !url.startsWith('/auth/login')) onUnauthorized();
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* not JSON */ }
    throw new ApiError(msg, res.status);
  }
  return res;
}

export const api = {
  get: async <T = any>(url: string): Promise<T> => (await request('GET', url)).json(),
  post: async <T = any>(url: string, body: unknown = {}): Promise<T> => (await request('POST', url, body)).json(),
  put: async <T = any>(url: string, body: unknown = {}): Promise<T> => (await request('PUT', url, body)).json(),
  del: async <T = any>(url: string): Promise<T> => (await request('DELETE', url)).json(),
  upload: async <T = any>(url: string, file: File): Promise<T> => {
    const fd = new FormData();
    fd.append('file', file);
    return (await request('POST', url, fd)).json();
  },
  /** Downloads a file (Excel / PDF) the server sends as an attachment. */
  download: async (url: string, body?: unknown) => {
    const res = await request(body === undefined ? 'GET' : 'POST', url, body);
    const cd = res.headers.get('Content-Disposition') ?? '';
    const name = /filename="?([^"]+)"?/.exec(cd)?.[1] ?? 'download';
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    return name;
  },
};

/** Query string from an object (empty values left out). */
export const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** Today / date helpers in local time, as yyyy-MM-dd. */
export const isoDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const firstOfMonth = (iso: string) => iso.slice(0, 8) + '01';
