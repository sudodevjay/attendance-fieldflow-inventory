/** Leave types (CL, SL ...): paid or not, yearly quota. */
import { exec } from '../config/db';
import { loadLeaveTypes } from '../models';
import { UserError } from '../utils/errors';

export const list = () => loadLeaveTypes().then((t) => t.map(({ Id, Code, Name, IsPaid, YearlyQuota }) => ({ Id, Code, Name, IsPaid, YearlyQuota })));

export async function save(b: { Id?: unknown; Code?: unknown; Name?: unknown; IsPaid?: unknown; YearlyQuota?: unknown }) {
  const code = String(b.Code ?? '').trim().toUpperCase(), name = String(b.Name ?? '').trim();
  if (!code || !name) throw new UserError('Code and Name are required.');
  const quota = Number(b.YearlyQuota ?? 0);
  if (!(quota >= 0 && quota <= 366)) throw new UserError('Yearly quota must be 0 to 366 days.');
  const p = { c: code.slice(0, 10), n: name.slice(0, 50), paid: b.IsPaid !== false, q: Math.round(quota * 2) / 2, id: b.Id ? Number(b.Id) : 0 };
  if (p.id) await exec('UPDATE LeaveTypes SET Code = @c, Name = @n, IsPaid = @paid, YearlyQuota = @q WHERE Id = @id', p);
  else await exec('INSERT INTO LeaveTypes (Code, Name, IsPaid, YearlyQuota) VALUES (@c, @n, @paid, @q)', p);
}
