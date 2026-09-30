/** LeaveTypes and LeaveEntries tables — see LeaveType / LeaveEntry in src/ZkAttendance/Data/Entities.cs. */
import { query } from '../config/db';
import { parse, type DT } from '../utils/time';

export interface LeaveType { Id: number; Name: string; Code: string; IsPaid: boolean; YearlyQuota: number }

export async function loadLeaveTypes(): Promise<LeaveType[]> {
  const rows = await query('SELECT Id, Name, Code, IsPaid, YearlyQuota FROM LeaveTypes ORDER BY Code');
  return rows.map((r) => ({ ...r, IsPaid: !!r.IsPaid }));
}

/** LeaveEntries.Status / EmployeeRequests.Status: 0, 1, 2. */
export const LEAVE_STATUS = ['Pending', 'Approved', 'Rejected'] as const;

export interface LeaveEntry {
  Id: number;
  EmployeeId: number;
  LeaveTypeId: number;
  FromDate: DT;
  ToDate: DT;
  IsHalfDay: boolean;
  Reason: string | null;
  Status: number;
  AppliedOn: DT | null;
  ApprovedBy: string | null;
  ApprovedOn: DT | null;
  /** Team lead's approval (step 1 of 2); the leave stays pending until the manager decides. */
  FirstApprovedBy: string | null;
  FirstApprovedOn: DT | null;
  type?: LeaveType;
}

/** SELECT list for `LeaveEntries l`. */
export const LEAVE_COLUMNS = `l.Id, l.EmployeeId, l.LeaveTypeId, to_char(l.FromDate, 'YYYY-MM-DD') AS FromDate,
  to_char(l.ToDate, 'YYYY-MM-DD') AS ToDate, l.IsHalfDay, l.Reason, l.Status, to_char(l.AppliedOn, 'YYYY-MM-DD') AS AppliedOn,
  l.ApprovedBy, to_char(l.ApprovedOn, 'YYYY-MM-DD') AS ApprovedOn, l.FirstApprovedBy, to_char(l.FirstApprovedOn, 'YYYY-MM-DD') AS FirstApprovedOn`;

export function toLeave(r: any, types?: Map<number, LeaveType>): LeaveEntry {
  return {
    ...r, FromDate: parse(r.FromDate)!, ToDate: parse(r.ToDate)!, AppliedOn: parse(r.AppliedOn), ApprovedOn: parse(r.ApprovedOn),
    FirstApprovedBy: r.FirstApprovedBy ?? null, FirstApprovedOn: parse(r.FirstApprovedOn),
    IsHalfDay: !!r.IsHalfDay, type: types?.get(r.LeaveTypeId),
  };
}
