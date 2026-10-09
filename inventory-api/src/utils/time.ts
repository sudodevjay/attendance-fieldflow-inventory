/**
 * Local date/time without time zones. A value is milliseconds of a UTC calendar that holds the local wall-clock time
 * (so 09:00 local is stored as 09:00 UTC); all arithmetic and formatting use the UTC functions. This matches
 * DateTime in the Windows program, which is always local time.
 */
import { UserError } from './errors';

export type DT = number;

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const make = (y: number, m: number, d: number, h = 0, mi = 0, s = 0): DT => Date.UTC(y, m - 1, d, h, mi, s);

/** 'yyyy-MM-dd', 'yyyy-MM-dd HH:mm', 'yyyy-MM-dd HH:mm:ss' or 'yyyy-MM-ddTHH:mm:ss'; null when not a valid date. */
export function parse(text: string | null | undefined): DT | null {
  if (!text) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text.trim());
  if (!m) return null;
  const v = make(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  const d = new Date(v);
  return d.getUTCDate() === +m[3] && d.getUTCMonth() === +m[2] - 1 ? v : null;
}

export function mustParse(text: string, what = 'date'): DT {
  const v = parse(text);
  if (v === null) throw new UserError(`Invalid ${what}: ${text}`);
  return v;
}

export const dateOf = (t: DT): DT => Math.floor(t / DAY) * DAY;
export const addDays = (t: DT, n: number): DT => t + n * DAY;
export const dayOfWeek = (t: DT): string => DAY_NAMES[new Date(t).getUTCDay()];
export const year = (t: DT) => new Date(t).getUTCFullYear();
export const month = (t: DT) => new Date(t).getUTCMonth() + 1;
export const day = (t: DT) => new Date(t).getUTCDate();
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const monthStart = (t: DT): DT => make(year(t), month(t), 1);
export const addMonths = (t: DT, n: number): DT => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
};

/** Current local wall-clock time. */
export function now(): DT {
  const d = new Date();
  return make(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
}
export const today = (): DT => dateOf(now());

const p2 = (n: number) => String(n).padStart(2, '0');

/** .NET-style patterns: yyyy MMMM MMM MM M dd d dddd ddd HH hh mm ss tt. */
export function fmt(t: DT, pattern: string): string {
  const d = new Date(t);
  const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate(), H = d.getUTCHours();
  return pattern.replace(/yyyy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|hh|mm|ss|tt/g, (tok) => {
    switch (tok) {
      case 'yyyy': return String(Y);
      case 'MMMM': return MONTHS[M];
      case 'MMM': return MONTHS[M].slice(0, 3);
      case 'MM': return p2(M + 1);
      case 'M': return String(M + 1);
      case 'dddd': return DAY_NAMES[d.getUTCDay()];
      case 'ddd': return DAY_NAMES[d.getUTCDay()].slice(0, 3);
      case 'dd': return p2(D);
      case 'd': return String(D);
      case 'HH': return p2(H);
      case 'hh': return p2(H % 12 === 0 ? 12 : H % 12);
      case 'mm': return p2(d.getUTCMinutes());
      case 'ss': return p2(d.getUTCSeconds());
      default: return H < 12 ? 'AM' : 'PM';
    }
  });
}

/** Value for a datetime2 parameter: CAST(@p AS timestamp). */
export const sqlDT = (t: DT) => fmt(t, 'yyyy-MM-dd HH:mm:ss');
export const sqlD = (t: DT) => fmt(t, 'yyyy-MM-dd');
