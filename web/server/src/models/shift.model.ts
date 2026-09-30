/** Shifts table (Maintenance Timetables) — see Shift in src/ZkAttendance/Data/Entities.cs. */
import { query } from '../config/db';

export interface Shift {
  Id: number;
  Name: string;
  /** Minutes after midnight. */
  start: number;
  end: number;
  LateGraceMinutes: number;
  EarlyGraceMinutes: number;
  HalfDayMinutes: number;
  MinOvertimeMinutes: number;
  WeeklyOffs: string;
  /** Break (ShiftExtras): allowed minutes (0 = no break rule), optional window in minutes after midnight. */
  BreakMinutes: number;
  breakStart: number | null;
  breakEnd: number | null;
  /** The break is not working time (taken off worked hours and off the shift length for overtime). */
  DeductBreak: boolean;
}

export const crossesMidnight = (s: Shift) => s.end <= s.start;
export const durationMinutes = (s: Shift) => (crossesMidnight(s) ? s.end + 1440 - s.start : s.end - s.start);
export const isWeeklyOff = (s: Shift, dayName: string) =>
  s.WeeklyOffs.split(',').map((x) => x.trim()).filter(Boolean).some((x) => x.toLowerCase() === dayName.toLowerCase());
export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const shiftLabel = (s: Shift) => `${s.Name} (${hhmm(s.start)}-${hhmm(s.end)})`;

/** Shift length without the break when the break is not working time. */
export const workMinutes = (s: Shift) => durationMinutes(s) - (s.DeductBreak ? s.BreakMinutes : 0);

/** Used when an employee has no shift (same values as a new Shift in the Windows program). */
export const FALLBACK_SHIFT: Shift = {
  Id: 0, Name: 'Default', start: 540, end: 1080, LateGraceMinutes: 10, EarlyGraceMinutes: 10, HalfDayMinutes: 240,
  MinOvertimeMinutes: 30, WeeklyOffs: 'Sunday', BreakMinutes: 0, breakStart: null, breakEnd: null, DeductBreak: false,
};

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

export async function loadShifts(): Promise<Shift[]> {
  const rows = await query(`SELECT s.Id, s.Name, to_char(s.StartTime, 'HH24:MI') AS s, to_char(s.EndTime, 'HH24:MI') AS e,
    s.LateGraceMinutes, s.EarlyGraceMinutes, s.HalfDayMinutes, s.MinOvertimeMinutes, s.WeeklyOffs, COALESCE(x.BreakMinutes, 0) BreakMinutes,
    to_char(x.BreakStart, 'HH24:MI') AS bs, to_char(x.BreakEnd, 'HH24:MI') AS be, COALESCE(x.DeductBreak, FALSE) DeductBreak
    FROM Shifts s LEFT JOIN ShiftExtras x ON x.ShiftId = s.Id`);
  return rows.map(({ s, e, bs, be, ...r }) => ({
    ...r, start: toMin(s), end: toMin(e), breakStart: bs ? toMin(bs) : null, breakEnd: be ? toMin(be) : null, DeductBreak: !!r.DeductBreak,
  }));
}
