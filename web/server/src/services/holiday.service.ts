/** Holidays of a year: list, add / edit (one per date), delete. */
import { exec, one, query } from '../config/db';
import { UserError } from '../utils/errors';
import { dayOfWeek, fmt, mustParse, parse, sqlD } from '../utils/time';

export async function list(y: number) {
  const rows = await query(`SELECT Id, to_char(Date, 'YYYY-MM-DD') AS d, Name FROM Holidays
    WHERE Date >= CAST(@f AS timestamp) AND Date <= CAST(@t AS timestamp) ORDER BY Date`, { f: `${y}-01-01`, t: `${y}-12-31` });
  return rows.map((r) => {
    const t = parse(r.d)!;
    return { Id: r.Id, Date: fmt(t, 'dd-MM-yyyy'), DateIso: r.d, Day: dayOfWeek(t), Name: r.Name };
  });
}

export async function save(id: number | null, dateText: string, name: string) {
  const date = sqlD(mustParse(dateText));
  name = name.trim();
  if (!name) throw new UserError('Name is required.');
  if (await one('SELECT Id FROM Holidays WHERE Date = CAST(@d AS timestamp) AND Id <> @id LIMIT 1', { d: date, id: id ?? 0 }))
    throw new UserError('A holiday already exists on this date.');
  if (id) await exec('UPDATE Holidays SET Date = CAST(@d AS timestamp), Name = @n WHERE Id = @id', { d: date, n: name.slice(0, 100), id });
  else await exec('INSERT INTO Holidays (Date, Name) VALUES (CAST(@d AS timestamp), @n)', { d: date, n: name.slice(0, 100) });
}

export async function removeMany(ids: number[]) {
  await exec('DELETE FROM Holidays WHERE Id = ANY(@ids)', { ids });
}
