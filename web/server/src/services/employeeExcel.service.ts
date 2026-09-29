/** Employee List → Export / Import (Excel with the same columns both ways, so a file can be edited and loaded back). */
import ExcelJS from 'exceljs';
import { exec, one, query, transaction } from '../config/db';
import { byEnroll } from '../models';
import { UserError } from '../utils/errors';
import { fmt, make, sqlD, today } from '../utils/time';
import { excel } from './export.service';

const COLUMNS = ['AC No', 'Name', 'No.', 'Gender', 'Title', 'Mobile', 'Card', 'Department', 'Shift', 'Join Date', 'Monthly Salary', 'OT Rate / Hour'];

export async function exportEmployees(ids: number[]) {
  const rows = await query(`SELECT e.EnrollNo, e.Name, e.BadgeNo, e.Gender, e.Designation, e.Phone, e.CardNo, d.Name Dept, s.Name Shift,
      CONVERT(varchar(10), e.JoinDate, 120) JoinDate, CAST(e.MonthlySalary AS float) Sal, CAST(e.OtRatePerHour AS float) Ot
    FROM Employees e LEFT JOIN Departments d ON d.Id = e.DepartmentId LEFT JOIN Shifts s ON s.Id = e.ShiftId
    WHERE e.Id IN (SELECT value FROM OPENJSON(@ids))`, { ids });
  rows.sort(byEnroll);
  const buffer = await excel({
    title: 'Employee List', subtitle: `${rows.length} employees`, columns: COLUMNS, statusColumns: [],
    rows: rows.map((e) => [e.EnrollNo, e.Name, e.BadgeNo ?? '', e.Gender ?? '', e.Designation ?? '', e.Phone ?? '', e.CardNo ?? '',
      e.Dept ?? '', e.Shift ?? '', e.JoinDate ? e.JoinDate.split('-').reverse().join('-') : '', e.Sal.toFixed(2), e.Ot.toFixed(2)]),
  });
  return { buffer, name: `Employees_${fmt(today(), 'yyyyMMdd')}.xlsx` };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const money = (s: string) => {
  const clean = s.replace(/[^0-9.]/g, '');
  return clean && !isNaN(Number(clean)) ? Number(clean) : null;
};

function cellText(c: ExcelJS.Cell): string {
  const v = c.value as any;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return '';
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((t: any) => t.text).join('').trim();
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '').trim();
  if (typeof v === 'object' && 'text' in v) return String(v.text).trim();
  return String(v).trim();
}

/** Adds / updates employees from the first sheet (header row with "AC No", "Name", "Department" ...). */
export async function importEmployees(file: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file as any);
  const ws = wb.worksheets[0];
  if (!ws) throw new UserError('The file has no sheet.');
  let headerRow = 0;
  const cols = new Map<string, number>();
  ws.eachRow((row, n) => {
    if (headerRow) return;
    const names = new Map<string, number>();
    row.eachCell((c, col) => names.set(norm(cellText(c)), col));
    if (['acno', 'userid', 'enrollno'].some((k) => names.has(k))) {
      headerRow = n;
      names.forEach((v, k) => cols.set(k, v));
    }
  });
  if (!headerRow) throw new UserError("No 'AC No' column was found in the sheet.");
  const col = (...names: string[]) => names.map((n) => cols.get(n) ?? 0).find((n) => n > 0) ?? 0;
  const c = {
    ac: col('acno', 'userid', 'enrollno'), name: col('name'), no: col('no', 'badgeno'), gender: col('gender'),
    title: col('title', 'designation'), mobile: col('mobile', 'mobileno', 'mobilepager', 'phone'), card: col('card', 'cardnumber', 'cardno'),
    dept: col('department', 'dept'), join: col('joindate', 'dateofemployment'), shift: col('shift', 'timetable'),
    salary: col('monthlysalary', 'salary'), ot: col('otratehour', 'otrate', 'otrateperhour'),
  };

  const depts = await query<{ Id: number; Name: string }>('SELECT Id, Name FROM Departments');
  const shifts = await query<{ Id: number; Name: string }>('SELECT Id, Name FROM Shifts');
  const firstShift = (await one('SELECT TOP 1 Id FROM Shifts ORDER BY Id'))?.Id ?? null;
  const existing = new Map((await query('SELECT Id, EnrollNo, Name FROM Employees')).map((e) => [e.EnrollNo, e]));
  let added = 0, updated = 0;

  await transaction(async (tx) => {
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const get = (n: number) => (n > 0 ? cellText(row.getCell(n)) : '');
      const ac = get(c.ac).replace(/^0+/, '');
      if (!ac || !/^\d+$/.test(ac)) continue;
      let id = existing.get(ac)?.Id as number | undefined;
      if (!id) {
        id = (await one(`INSERT INTO Employees (EnrollNo, Name, ShiftId, Privilege, IsActive, MonthlySalary, OtRatePerHour)
          OUTPUT INSERTED.Id VALUES (@e, @n, @s, 0, 1, 0, 0)`, { e: ac, n: `User ${ac}`, s: firstShift }, tx))!.Id;
        existing.set(ac, { Id: id, EnrollNo: ac, Name: `User ${ac}` });
        added++;
      } else updated++;

      const sets: string[] = [];
      const p: Record<string, unknown> = { id };
      const put = (sqlSet: string, key: string, value: unknown) => { sets.push(sqlSet); p[key] = value; };
      if (get(c.name)) put('Name = @n', 'n', get(c.name).slice(0, 100));
      if (get(c.no)) put('BadgeNo = @b', 'b', get(c.no).slice(0, 30));
      if (get(c.gender)) put('Gender = @g', 'g', get(c.gender).slice(0, 10));
      if (get(c.title)) put('Designation = @t', 't', get(c.title).slice(0, 100));
      if (get(c.mobile)) put('Phone = @m', 'm', get(c.mobile).slice(0, 20));
      if (get(c.card)) put('CardNo = @c', 'c', get(c.card).slice(0, 20));
      // Text dates are day-first (as exported); real Excel date cells are read as dates.
      const jt = get(c.join);
      const jm = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(jt);
      const jv = c.join > 0 ? row.getCell(c.join).value : null;
      const joinSet = 'JoinDate = CONVERT(datetime2, @j, 120)';
      if (jm) put(joinSet, 'j', `${jm[3]}-${jm[2].padStart(2, '0')}-${jm[1].padStart(2, '0')}`);
      else if (/^\d{4}-\d{2}-\d{2}$/.test(jt)) put(joinSet, 'j', jt);
      else if (jv instanceof Date) put(joinSet, 'j', sqlD(make(jv.getUTCFullYear(), jv.getUTCMonth() + 1, jv.getUTCDate())));
      const sal = money(get(c.salary));
      if (sal !== null) put('MonthlySalary = CAST(@sal AS decimal(18,2))', 'sal', sal);
      const ot = money(get(c.ot));
      if (ot !== null) put('OtRatePerHour = CAST(@ot AS decimal(18,2))', 'ot', ot);
      const sn = get(c.shift).toLowerCase();
      const sh = sn ? shifts.find((s) => s.Name.toLowerCase() === sn) : undefined;
      if (sh) put('ShiftId = @sh', 'sh', sh.Id);
      const dn = get(c.dept);
      if (dn) {
        let dep = depts.find((d) => d.Name.toLowerCase() === dn.toLowerCase());
        if (!dep) {
          dep = { Id: (await one('INSERT INTO Departments (Name) OUTPUT INSERTED.Id VALUES (@n)', { n: dn.slice(0, 100) }, tx))!.Id, Name: dn };
          depts.push(dep);
        }
        put('DepartmentId = @d', 'd', dep.Id);
      }
      if (sets.length) await exec(`UPDATE Employees SET ${sets.join(', ')} WHERE Id = @id`, p, tx);
      if (!get(c.name)) await exec(`UPDATE Employees SET Name = 'User ' + EnrollNo WHERE Id = @id AND LTRIM(Name) = ''`, { id }, tx);
    }
  });
  return `Import complete.\nNew: ${added}\nUpdated: ${updated}`;
}
