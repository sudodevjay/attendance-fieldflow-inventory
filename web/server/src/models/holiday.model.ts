/** Holidays table — see Holiday in src/ZkAttendance/Data/Entities.cs. */
import { query } from '../config/db';
import { parse, type DT } from '../utils/time';

/** Holidays in [from, to], by date. */
export async function loadHolidays(from: DT, to: DT): Promise<Map<DT, string>> {
  const rows = await query(`SELECT CONVERT(varchar(10), [Date], 120) d, Name FROM Holidays
    WHERE [Date] >= CONVERT(datetime2, @f, 120) AND [Date] <= CONVERT(datetime2, @t, 120)`,
    { f: new Date(from).toISOString().slice(0, 10), t: new Date(to).toISOString().slice(0, 10) });
  return new Map(rows.map((r) => [parse(r.d)!, r.Name as string]));
}
