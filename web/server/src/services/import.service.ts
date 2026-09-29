/**
 * Attendance files exported to a pendrive from the device menu (UsbFileImporter.cs):
 *   1_attlog.dat : "PIN \t yyyy-MM-dd HH:mm:ss \t DevId \t Status \t Verify \t WorkCode"
 *   GLG_001.TXT  : header "No Mchn EnNo Name Mode IOMd DateTime" (older B&W firmware)
 *   CSV          : a header row with the same column names
 */
import type { DevicePunch } from './sync.service';
import { make, type DT } from '../utils/time';

const PATTERNS: { re: RegExp; order: 'ymd' | 'dmy' | 'mdy12' | 'mdy24' }[] = [
  { re: /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/, order: 'ymd' },
  { re: /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/, order: 'dmy' },
  { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)$/i, order: 'mdy12' },
];

export function parseDate(s: string): DT | null {
  const t = s.trim().replace(/\s+/g, ' ');
  for (const p of PATTERNS) {
    const m = p.re.exec(t);
    if (!m) continue;
    let y: number, mo: number, d: number, h = +m[4];
    if (p.order === 'ymd') [y, mo, d] = [+m[1], +m[2], +m[3]];
    else if (p.order === 'dmy') [d, mo, y] = [+m[1], +m[2], +m[3]];
    else {
      [mo, d, y] = [+m[1], +m[2], +m[3]];
      const pm = m[7].toUpperCase() === 'PM';
      if (h === 12) h = pm ? 12 : 0;
      else if (pm) h += 12;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23) continue;
    const v = make(y, mo, d, h, +m[5], +(m[6] ?? 0));
    if (new Date(v).getUTCDate() !== d) continue;
    return v;
  }
  return null;
}

export function parseAttendanceFile(content: string): DevicePunch[] {
  const result: DevicePunch[] = [];
  let enrollIdx = 0, stateIdx = 3, verifyIdx = 4, dateIdx = -1;
  let header = false;
  const find = (f: string[], ...names: string[]) => f.findIndex((x) => names.some((n) => x.toLowerCase() === n.toLowerCase()));
  const int = (f: string[], i: number) => (i >= 0 && i < f.length && /^-?\d+$/.test(f[i]) ? parseInt(f[i], 10) : 0);

  for (const raw of content.split(/\n/)) {
    const line = raw.replace(/^﻿/, '').replace(/\r$/, '').trim();
    if (!line) continue;
    const f = (line.includes('\t') ? line.split('\t') : line.split(',')).map((x) => x.trim().replace(/^"|"$/g, ''));

    if (!header && f.some((x) => x.toLowerCase() === 'enno' || x.toLowerCase() === 'datetime')) {
      header = true;
      enrollIdx = find(f, 'EnNo', 'PIN', 'UserID', 'User ID', 'AC-No.');
      stateIdx = find(f, 'IOMd', 'Status', 'State');
      verifyIdx = find(f, 'Mode', 'Verify', 'VerifyMode');
      dateIdx = find(f, 'DateTime', 'Time', 'Date Time');
      continue;
    }
    const di = dateIdx >= 0 && dateIdx < f.length ? dateIdx : f.findIndex((x) => parseDate(x) !== null);
    const time = di >= 0 ? parseDate(f[di]) : null;
    if (time === null || enrollIdx < 0 || enrollIdx >= f.length) continue;
    const enrollNo = f[enrollIdx].replace(/^0+/, '') || '0';
    result.push({ enrollNo, time, verifyMode: int(f, verifyIdx), inOutMode: int(f, stateIdx), workCode: 0 });
  }
  return result;
}
