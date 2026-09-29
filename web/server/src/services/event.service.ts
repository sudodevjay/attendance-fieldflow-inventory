/**
 * What the Machine List shows below the devices: the connection log ("[1] Succeed") and the records that came in
 * during this session (punches from the Pi, pendrive imports). Kept in memory, like the Windows program.
 */
import { fmt, now, type DT } from '../utils/time';

export interface LogEntry { id: number; deviceId: number; message: string; time: string }
export interface RecordEntry { id: number; enrollNo: string; name: string; time: string; machine: string; verify: string }

const logs: LogEntry[] = [];
const records: RecordEntry[] = [];
let logId = 0, recordId = 0;

export function log(deviceId: number, message: string) {
  logs.push({ id: ++logId, deviceId, message, time: fmt(now(), 'HH:mm:ss MM-dd') });
  if (logs.length > 500) logs.shift();
}

export const verifyName = (v: number) => (v === -1 ? 'Manual' : v === 0 ? 'Password' : v === 1 ? 'FP' : v === 2 ? 'Card' : v === 15 ? 'Face' : String(v));

export function addRecords(punches: { enrollNo: string; time: DT; verifyMode: number }[], names: Map<string, string>, machine: string) {
  for (const p of [...punches].sort((a, b) => a.time - b.time).slice(-1000))
    records.push({ id: ++recordId, enrollNo: p.enrollNo, name: names.get(p.enrollNo) ?? '', time: fmt(p.time, 'dd-MM-yyyy HH:mm:ss'),
      machine, verify: verifyName(p.verifyMode) });
  while (records.length > 2000) records.shift();
}

export const logsAfter = (id: number) => logs.filter((l) => l.id > id);
export const recordsAfter = (id: number) => records.filter((r) => r.id > id);
