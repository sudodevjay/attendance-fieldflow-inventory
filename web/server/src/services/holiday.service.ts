/** Holidays of a year: list, add / edit (one per date), delete. */
import { exec, one, query } from '../config/db';
import { UserError } from '../utils/errors';
import { dayOfWeek, fmt, mustParse, parse, sqlD } from '../utils/time';

export async function list(y: number) {
  const rows = await query(`SELECT Id, CONVERT(varchar(10), [Date], 120) d, Name FROM Holidays
    WHERE [Date] >= CONVERT(datetime2, @f, 120) AND [Date] <= CONVERT(datetime2, @t, 120) ORDER BY [Date]`, { f: `${y}-01-01`, t: `${y}-12-31` });
  return rows.map((r) => {
    const t = parse(r.d)!;
    return { Id: r.Id, Date: fmt(t, 'dd-MM-yyyy'), DateIso: r.d, Day: dayOfWeek(t), Name: r.Name };
  });
}

export async function save(id: number | null, dateText: string, name: string) {
  const date = sqlD(mustParse(dateText));
  name = name.trim();
  if (!name) throw new UserError('Name is required.');
  if (await one('SELECT TOP 1 Id FROM Holidays WHERE [Date] = CONVERT(datetime2, @d, 120) AND Id <> @id', { d: date, id: id ?? 0 }))
    throw new UserError('A holiday already exists on this date.');
  if (id) await exec('UPDATE Holidays SET [Date] = CONVERT(datetime2, @d, 120), Name = @n WHERE Id = @id', { d: date, n: name.slice(0, 100), id });
  else await exec('INSERT INTO Holidays ([Date], Name) VALUES (CONVERT(datetime2, @d, 120), @n)', { d: date, n: name.slice(0, 100) });
}

export async function removeMany(ids: number[]) {
  await exec('DELETE FROM Holidays WHERE Id IN (SELECT value FROM OPENJSON(@ids))', { ids });
}
