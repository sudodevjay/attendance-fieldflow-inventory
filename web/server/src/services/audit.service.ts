/** Audit log (AuditLog table): who changed what in the administrator program and the portal, and logins. */
import { exec, query } from '../config/db';
import { mustParse, addDays, sqlD, fmt, parse } from '../utils/time';

/** Body fields never written to the log. */
const SECRET = /password|photo|attachment|token|data|base64|confirm|current/i;

/** Short text of a request body: secrets and pictures left out, long values cut. */
export function summarize(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (SECRET.test(k) || v === undefined || v === '' || v === null) continue;
    let t = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (t.length > 120) t = t.slice(0, 117) + '...';
    parts.push(`${k}=${t}`);
  }
  return parts.join(', ').slice(0, 1000);
}

/** Readable name of an API call: "PUT /employees/12" -> "Update employees". */
export function actionName(method: string, path: string) {
  const p = path.replace(/^\/api\//, '').split('?')[0];
  const area = p.split('/')[0] || 'api';
  const last = p.split('/').filter(Boolean).pop() ?? '';
  const verb = method === 'DELETE' || last === 'delete' ? 'Delete'
    : last === 'decide' ? 'Decide' : last === 'login' ? 'Login' : last === 'import' ? 'Import'
      : method === 'PUT' ? 'Update' : method === 'POST' ? (/^\d+$/.test(last) ? 'Update' : 'Add / run') : method;
  return `${verb} ${area}`.slice(0, 100);
}

export async function write(user: string, role: string | null, method: string, path: string, details: string, ip: string) {
  try {
    await exec('INSERT INTO AuditLog (UserName, Role, Action, Path, Details, Ip) VALUES (@u, @r, @a, @p, @d, @ip)', {
      u: user.slice(0, 100) || '?', r: role, a: actionName(method, path), p: `${method} ${path.split('?')[0]}`.slice(0, 200),
      d: details.slice(0, 1000) || null, ip: ip.replace(/^::ffff:/, '').slice(0, 50),
    });
  } catch (e) { console.error('audit log not written:', e); }
}

/** Log entries of [from, to] (yyyy-MM-dd), optionally filtered by user / text; newest first, max 5000. */
export async function list(from: string, to: string, user: string, text: string) {
  const f = mustParse(from), t = addDays(mustParse(to), 1);
  const rows = await query(`SELECT TOP 5000 Id, CONVERT(varchar(19), At, 120) At, UserName, Role, Action, Path, Details, Ip FROM AuditLog
    WHERE At >= @f AND At < @t AND (@u = '' OR UserName LIKE '%' + @u + '%')
      AND (@q = '' OR Action LIKE '%' + @q + '%' OR Path LIKE '%' + @q + '%' OR Details LIKE '%' + @q + '%')
    ORDER BY At DESC, Id DESC`, { f: sqlD(f), t: sqlD(t), u: user.trim(), q: text.trim() });
  return rows.map((r) => ({ ...r, When: fmt(parse(r.At)!, 'dd-MM-yyyy HH:mm:ss'), Role: r.Role ?? '', Details: r.Details ?? '' }));
}
