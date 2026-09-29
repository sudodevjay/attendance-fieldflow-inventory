/** Employee portal API (/api/portal) with its own login token, separate from the administrator's. */
const KEY = 'zk.portal.token';

export const ptoken = () => {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
};
export const setPtoken = (t: string) => {
  try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch { /* private mode */ }
};

let onLogout: () => void = () => {};
export const setPortalLogoutHandler = (fn: () => void) => { onLogout = fn; };

async function req(method: string, url: string, body?: unknown) {
  const headers: Record<string, string> = {};
  const t = ptoken();
  if (t) headers.Authorization = `Bearer ${t}`;
  const form = body instanceof FormData;
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch('/api/portal' + url, { method, headers, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
  } catch {
    throw new Error('The server cannot be reached.');
  }
  if (res.status === 401 && url !== '/login') { setPtoken(''); onLogout(); }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return res;
}

export const papi = {
  get: async <T = any>(url: string): Promise<T> => (await req('GET', url)).json(),
  post: async <T = any>(url: string, body: unknown = {}): Promise<T> => (await req('POST', url, body)).json(),
  del: async <T = any>(url: string): Promise<T> => (await req('DELETE', url)).json(),
  /** Multipart upload (documents): the file plus text fields. */
  upload: async <T = any>(url: string, file: File, fields: Record<string, string> = {}): Promise<T> => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append('file', file);
    return (await req('POST', url, fd)).json();
  },
  /** Opens a file (payslip PDF) the server sends. */
  file: async (url: string) => {
    const res = await req('GET', url);
    const name = /filename="?([^"]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'file.pdf';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  },
};

/** Shrinks a photo to at most `max` px and returns base64 JPEG (receipts). */
export function photoToBase64(file: File, max = 1200): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.8).split(',')[1]);
    };
    img.onerror = () => reject(new Error('This file is not a picture.'));
    img.src = URL.createObjectURL(file);
  });
}

export const inr = (v: number) => '₹ ' + new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
export const two = (n: number) => String(n % 1 === 0 ? n : n.toFixed(1)).padStart(2, '0');
