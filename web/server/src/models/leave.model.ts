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
  type?: LeaveType;
}

/** SELECT list for `LeaveEntries l`. */
export const LEAVE_COLUMNS = `l.Id, l.EmployeeId, l.LeaveTypeId, CONVERT(varchar(10), l.FromDate, 120) FromDate,
  CONVERT(varchar(10), l.ToDate, 120) ToDate, l.IsHalfDay, l.Reason, l.Status, CONVERT(varchar(10), l.AppliedOn, 120) AppliedOn,
  l.ApprovedBy, CONVERT(varchar(10), l.ApprovedOn, 120) ApprovedOn`;

export function toLeave(r: any, types?: Map<number, LeaveType>): LeaveEntry {
  return {
    ...r, FromDate: parse(r.FromDate)!, ToDate: parse(r.ToDate)!, AppliedOn: parse(r.AppliedOn), ApprovedOn: parse(r.ApprovedOn),
    IsHalfDay: !!r.IsHalfDay, type: types?.get(r.LeaveTypeId),
  };
}
