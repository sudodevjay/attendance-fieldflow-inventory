import type { Request, Response } from 'express';
import * as reports from '../services/report.service';
import { UserError } from '../utils/errors';
import { numQuery, sendFile } from '../utils/http';
import { canRead, PAYROLL_REPORTS } from '../utils/permissions';
import { mustParse } from '../utils/time';

function args(req: Request) {
  const q = req.query;
  return {
    kind: String(q.kind) as reports.ReportKind,
    from: mustParse(String(q.from ?? '')),
    to: mustParse(String(q.to ?? q.from ?? '')),
    dept: numQuery(q.dept),
    emp: numQuery(q.emp),
  };
}

export const catalog = (req: Request, res: Response) =>
  res.json(reports.CATALOG.filter((c) => !PAYROLL_REPORTS.includes(c.kind) || canRead(req.role ?? 'Viewer', 'payroll')));

/** Salary reports need the payroll area (not HOD, not HR). */
function checkPayroll(req: Request, kind: string) {
  if (PAYROLL_REPORTS.includes(kind) && !canRead(req.role ?? 'Viewer', 'payroll')) throw new UserError('Your role cannot open salary reports.', 403);
}

export async function run(req: Request, res: Response) {
  const a = args(req);
  checkPayroll(req, a.kind);
  res.json(await reports.buildReport(a.kind, a.from, a.to, a.dept, a.emp));
}

export async function file(req: Request, res: Response) {
  const a = args(req);
  checkPayroll(req, a.kind);
  const f = await reports.reportFile(a.kind, a.from, a.to, a.dept, a.emp, req.query.format === 'pdf' ? 'pdf' : 'xlsx');
  sendFile(res, f.buffer, f.name);
}

export async function salarySlip(req: Request, res: Response) {
  const a = args(req);
  const f = await reports.salarySlipFile(a.from, a.dept, a.emp);
  sendFile(res, f.buffer, f.name);
}
