/** Holidays table — see Holiday in src/ZkAttendance/Data/Entities.cs. */
import { query } from '../config/db';
import { parse, type DT } from '../utils/time';

/** Holidays in [from, to], by date. */
export async function loadHolidays(from: DT, to: DT): Promise<Map<DT, string>> {
  const rows = await query(`SELECT to_char(Date, 'YYYY-MM-DD') AS d, Name FROM Holidays
    WHERE Date >= CAST(@f AS timestamp) AND Date <= CAST(@t AS timestamp)`,
    { f: new Date(from).toISOString().slice(0, 10), t: new Date(to).toISOString().slice(0, 10) });
  return new Map(rows.map((r) => [parse(r.d)!, r.Name as string]));
}
