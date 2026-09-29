/** Excel and PDF files of a report, and the salary slip PDF (Exporters.cs + SalarySlipPdf.cs of the Windows program). */
import ExcelJS from 'exceljs';
import { hm } from './attendance.service';
import { money, num, round2 } from '../utils/format';
import type { PayLine } from './payroll.service';
import { companyAddress, companyLogo, companyName, companyProfile } from './settings.service';
import { addDays, addMonths, fmt, now, today, type DT } from '../utils/time';
import { shiftLabel, type ReportResult } from '../models';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfmake = require('pdfmake');
pdfmake.setFonts({
  Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' },
});
pdfmake.setUrlAccessPolicy(() => false);
// Only the built-in PDF fonts may be opened (no other local files).
pdfmake.setLocalAccessPolicy((p: string) => /^(Helvetica|Times|Courier|Symbol|ZapfDingbats)/.test(p));

/** Background / foreground of a status code, shared by grid, Excel and PDF (ReportService.StatusColor). */
export function statusColor(status: string): { back: string; fore: string } | null {
  switch (status) {
    case 'P': case 'Approved': return { back: 'DCF5E2', fore: '166534' };
    case 'A': case 'Rejected': return { back: 'FEE2E2', fore: '991B1B' };
    case 'HD': case 'Pending': return { back: 'FEF3C7', fore: '92400E' };
    case 'H': return { back: 'E0E7FF', fore: '3730A3' };
    case 'WO': return { back: 'EDEDF0', fore: '52525B' };
    case '': case '-': return null;
    default: return { back: 'F3E8FF', fore: '6B21A8' }; // leave codes
  }
}

const safeSheetName = (s: string) => s.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);

export async function excel(r: ReportResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(safeSheetName(r.title));
  const cols = Math.max(1, r.columns.length);
  const status = new Set(r.statusColumns);

  ws.getCell(1, 1).value = await companyName();
  ws.mergeCells(1, 1, 1, cols);
  ws.getCell(1, 1).font = { bold: true, size: 15 };
  ws.getCell(2, 1).value = `${r.title} — ${r.subtitle}`;
  ws.mergeCells(2, 1, 2, cols);
  ws.getCell(2, 1).font = { bold: true, size: 11 };
  ws.getCell(3, 1).value = `Generated: ${fmt(now(), 'dd-MM-yyyy HH:mm')}`;
  ws.mergeCells(3, 1, 3, cols);
  ws.getCell(3, 1).font = { color: { argb: 'FF808080' } };

  const headerRow = 5;
  const border: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFD3D3D3' } }, bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
    left: { style: 'thin', color: { argb: 'FFD3D3D3' } }, right: { style: 'thin', color: { argb: 'FFD3D3D3' } },
  };
  r.columns.forEach((c, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = c;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    cell.alignment = { horizontal: 'center' };
    cell.border = border;
  });
  const widths = r.columns.map((c) => c.length);
  r.rows.forEach((row, ri) => {
    row.forEach((v, ci) => {
      const text = String(v ?? '');
      const cell = ws.getCell(headerRow + 1 + ri, ci + 1);
      const n = Number(text.replace(/,/g, ''));
      cell.value = text !== '' && !isNaN(n) && !text.includes(':') && !text.startsWith('0') ? n : text;
      cell.border = border;
      widths[ci] = Math.max(widths[ci], text.length);
      const sc = status.has(r.columns[ci]) ? statusColor(text) : null;
      if (sc) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + sc.back } };
        cell.font = { color: { argb: 'FF' + sc.fore } };
        cell.alignment = { horizontal: 'center' };
      }
    });
  });
  ws.columns.forEach((c, i) => (c.width = Math.min(45, Math.max(4, (widths[i] ?? 4) + 2))));
  ws.views = [{ state: 'frozen', ySplit: headerRow }];
  ws.pageSetup = { orientation: cols > 10 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The built-in PDF fonts only have the Windows-1252 characters: replace the few others the texts use. */
function pdfSafe(v: any): any {
  if (typeof v === 'string') return v.replace(/→/g, '->').replace(/₹/g, 'Rs.').replace(/✔/g, 'v');
  if (Array.isArray(v)) return v.map(pdfSafe);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'function' ? x : pdfSafe(x)]));
  return v;
}

async function toBuffer(doc: any): Promise<Buffer> {
  const footer = doc.footer;
  const safe = pdfSafe(doc);
  if (typeof footer === 'function') safe.footer = (...a: any[]) => pdfSafe(footer(...a));
  return pdfmake.createPdf({ defaultStyle: { font: 'Helvetica' }, ...safe }).getBuffer();
}

export async function pdf(r: ReportResult): Promise<Buffer> {
  const cols = r.columns.length;
  const landscape = cols > 9;
  const fontSize = cols > 30 ? 5.5 : cols > 16 ? 7 : 8.5;
  const status = new Set(r.statusColumns);
  const company = await companyName();
  const address = await companyAddress();
  // Relative widths from content length (headers wrap at spaces, so only their longest word counts).
  const widths = r.columns.map((c, i) => {
    let max = Math.max(...c.split(' ').map((w) => w.length));
    for (const row of r.rows) max = Math.max(max, String(row[i] ?? '').length);
    return Math.min(32, Math.max(4, max));
  });
  const total = widths.reduce((a, b) => a + b, 0);

  const body = [
    r.columns.map((c) => ({ text: c, bold: true, color: 'white', fillColor: '#1E3A8A', alignment: 'center' })),
    ...r.rows.map((row, i) => row.map((v, ci) => {
      const text = String(v ?? '');
      const sc = status.has(r.columns[ci]) ? statusColor(text) : null;
      return {
        text, fillColor: sc ? '#' + sc.back : i % 2 === 0 ? '#FFFFFF' : '#FAFAFA', color: sc ? '#' + sc.fore : undefined,
        bold: !!sc, alignment: status.has(r.columns[ci]) ? 'center' : 'left',
      };
    })),
  ];

  return toBuffer({
    pageSize: 'A4',
    pageOrientation: landscape ? 'landscape' : 'portrait',
    pageMargins: [20, 70, 20, 30],
    defaultStyle: { font: 'Helvetica', fontSize },
    header: {
      margin: [20, 15, 20, 0],
      stack: [
        { text: company, fontSize: 15, bold: true, color: '#1E3A8A' },
        ...(address ? [{ text: address, fontSize: 8, color: '#616161' }] : []),
        {
          columns: [
            { text: `${r.title}  |  ${r.subtitle}`, fontSize: 10, bold: true },
            { text: `Generated ${fmt(now(), 'dd-MM-yyyy HH:mm')}`, fontSize: 7, color: '#9E9E9E', alignment: 'right', width: 'auto' },
          ],
          margin: [0, 4, 0, 0],
        },
      ],
    },
    footer: (page: number, pages: number) => ({ text: `Page ${page} of ${pages}`, alignment: 'center', fontSize: 7, margin: [0, 10, 0, 0] }),
    content: [{
      table: { headerRows: 1, widths: widths.map((w) => `${(w / total) * 100}%`), body },
      layout: {
        hLineWidth: (i: number) => (i === 0 ? 0 : 0.5), vLineWidth: () => 0, hLineColor: () => '#E0E0E0',
        paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 2, paddingBottom: () => 2,
      },
    }],
  });
}

// ------------------------------------------------------------------ salary slip

const BLUE = '#1E3A8A';
const LIGHT = '#EEF2FF';
const LINE = '#CBD5E1';

export async function salarySlip(lines: PayLine[], first: DT): Promise<Buffer> {
  const company = await companyName();
  const address = await companyAddress();
  const cp = await companyProfile();
  const logo = await companyLogo();
  const contact = [cp.Phone && `Ph: ${cp.Phone}`, cp.Email, cp.Gstin && `GSTIN: ${cp.Gstin}`, cp.PfCode && `PF Code: ${cp.PfCode}`,
    cp.EsiCode && `ESI Code: ${cp.EsiCode}`].filter(Boolean).join('   ');
  const monthEnd = addDays(addMonths(first, 1), -1);
  const inProgress = monthEnd >= today();
  const M = (v: number) => 'Rs. ' + money(v);
  const cell = (text: string, extra: object = {}) => ({ text, ...extra });

  const pages = lines.map((l, i): any[] => {
    const e = l.employee, s = l.summary;
    const pair = (label: string, value: string) => ({ columns: [{ text: label, width: 95, color: '#616161' }, { text: value, bold: true }], margin: [0, 1.5, 0, 1.5] });
    const attendance: [string, string][] = [
      ['Days in Month', String(l.monthDays)], ['Present', num(s.Present)], ['Paid Leave', num(s.PaidLeave)],
      ['Unpaid Leave (LWP)', num(s.Leave - s.PaidLeave)], ['Holidays', String(s.Holidays)], ['Weekly Off', String(s.WeeklyOffs)],
      ['Absent', num(s.Absent)], ['Late Arrivals', String(s.LateCount)], ['Overtime', hm(s.OvertimeMinutes) || '0:00'],
      ['Paid Days', num(s.PaidDays)], ['Late Deduction (days)', num(l.lateCutDays)], ['Payable Days', num(l.payableDays)],
    ];
    const attRows: any[][] = [];
    for (let k = 0; k < attendance.length; k += 4)
      attRows.push(attendance.slice(k, k + 4).flatMap(([label, value]) => [
        cell(label, { fillColor: LIGHT, fontSize: 8.5 }), cell(value, { alignment: 'right', bold: true })]));

    const earnings: [string, string][] = l.earnings.map((x) => [x.name, M(x.amount)]);
    if (l.otAmount > 0 || s.OvertimeMinutes > 0) earnings.push([`Overtime (${hm(l.paidOtMinutes) || '0:00'} h × ${M(l.otRate)}/h)`, M(l.otAmount)]);
    const deductions: [string, string][] = [
      [`Absent / unpaid days (${num(l.unpaidDays)} × ${M(round2(l.perDay))})`, M(l.unpaidDeduction)],
      [`Late arrivals (${s.LateCount} late = ${num(l.lateCutDays)} day)`, M(l.lateDeduction)],
      ...l.otherDeductions.map((x): [string, string] => [x.name, M(x.amount)]),
    ];
    const p = l.profile;
    const side = (title: string, rows: [string, string][], totalLabel: string, total: string) => ({
      table: {
        widths: ['*', 'auto'],
        body: [
          [cell(title, { fillColor: BLUE, color: 'white', bold: true }), cell('Amount', { fillColor: BLUE, color: 'white', bold: true, alignment: 'right' })],
          ...rows.map(([a, b]) => [cell(a), cell(b, { alignment: 'right' })]),
          [cell(totalLabel, { fillColor: LIGHT, bold: true }), cell(total, { fillColor: LIGHT, bold: true, alignment: 'right' })],
        ],
      },
      layout: { hLineWidth: (k: number) => (k === 0 ? 0 : 0.5), vLineWidth: () => 0, hLineColor: () => LINE, paddingTop: () => 5, paddingBottom: () => 5 },
    });
    const section = (t: string) => ({ text: t, fontSize: 10.5, bold: true, color: BLUE, margin: [0, 8, 0, 4] });

    return [
      {
        columns: [
          ...(logo ? [{ image: logo, fit: [60, 45], width: 66 }] : []),
          { stack: [{ text: company, fontSize: 18, bold: true, color: BLUE }, ...(address ? [{ text: address, fontSize: 9, color: '#616161' }] : []),
            ...(contact ? [{ text: contact, fontSize: 7.5, color: '#616161' }] : [])] },
          { width: 'auto', stack: [{ text: 'SALARY SLIP', fontSize: 15, bold: true, alignment: 'right' }, { text: fmt(first, 'MMMM yyyy'), fontSize: 11, bold: true, color: BLUE, alignment: 'right' }] },
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 6, x2: 535, y2: 6, lineWidth: 2, lineColor: BLUE }], margin: [0, 0, 0, 6] },
      ...(inProgress ? [{
        table: { widths: ['*'], body: [[cell(`Month in progress: days after ${fmt(today(), 'dd-MM-yyyy')} are not counted as paid yet.`, { fillColor: '#FEF3C7', color: '#92400E', fontSize: 8.5 })]] },
        layout: 'noBorders', margin: [0, 4, 0, 0],
      }] : []),
      section('Employee Details'),
      {
        table: {
          widths: ['*', '*'],
          body: [[
            { stack: [pair('Name', e.Name), pair('AC No', e.EnrollNo), pair('Department', e.DepartmentName ?? '-'),
              ...(p.Pan ? [pair('PAN', p.Pan)] : []), ...(p.Uan ? [pair('UAN', p.Uan)] : [])] },
            { stack: [pair('Designation', e.Designation?.trim() ? e.Designation : '-'), pair('Date of Joining', e.JoinDate !== null ? fmt(e.JoinDate, 'dd-MM-yyyy') : '-'), pair('Shift', l.shift ? shiftLabel(l.shift) : '-'),
              ...(p.BankAccount ? [pair('Bank A/c', `${p.BankName ? p.BankName + ' ' : ''}${p.BankAccount}`)] : []), ...(p.EsiNo ? [pair('ESI No', p.EsiNo)] : [])] },
          ]],
        },
        layout: { hLineColor: () => LINE, vLineColor: (k: number) => (k === 1 ? 'white' : LINE), hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingLeft: () => 6, paddingTop: () => 6, paddingBottom: () => 6 },
      },
      section('Attendance'),
      {
        table: { widths: ['*', 38, '*', 38, '*', 38, '*', 38], body: attRows },
        layout: { hLineColor: () => LINE, vLineColor: () => LINE, hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingTop: () => 4, paddingBottom: () => 4 },
      },
      {
        columns: [
          side('Earnings', earnings, 'Gross Earnings', M(l.grossEarnings)),
          { width: 12, text: '' },
          side('Deductions', deductions, 'Total Deductions', M(l.totalDeductions)),
        ],
        margin: [0, 12, 0, 0],
      },
      {
        table: {
          widths: ['*'],
          body: [[{
            fillColor: LIGHT,
            stack: [
              { columns: [{ text: 'NET PAY', fontSize: 12, bold: true, color: BLUE }, { text: M(l.netPay), fontSize: 14, bold: true, color: BLUE, alignment: 'right', width: 'auto' }] },
              { text: amountInWords(l.netPay), italics: true, fontSize: 9, margin: [0, 3, 0, 0] },
            ],
          }]],
        },
        layout: { hLineColor: () => BLUE, vLineColor: () => BLUE, paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 8, paddingBottom: () => 8 },
        margin: [0, 12, 0, 0],
      },
      ...(l.remark ? [{ text: `Note: ${l.remark}`, fontSize: 8.5, color: '#616161', margin: [0, 10, 0, 0] }] : []),
      {
        columns: [
          { stack: [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 150, y2: 0, lineWidth: 0.8 }] }, { text: 'Employee Signature', fontSize: 8.5, margin: [0, 3, 0, 0] }] },
          { stack: [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 150, y2: 0, lineWidth: 0.8 }], alignment: 'right' }, { text: 'Authorised Signatory', fontSize: 8.5, alignment: 'right', margin: [0, 3, 0, 0] }] },
        ],
        margin: [0, 45, 0, 0],
      },
      ...(i < lines.length - 1 ? [{ text: '', pageBreak: 'after' }] : []),
    ];
  });

  return toBuffer({
    pageSize: 'A4',
    pageMargins: [30, 30, 30, 40],
    defaultStyle: { font: 'Helvetica', fontSize: 9.5 },
    footer: () => ({ text: `This is a computer-generated salary slip.   Generated ${fmt(now(), 'dd-MM-yyyy HH:mm')}`, alignment: 'center', fontSize: 7.5, color: '#9E9E9E' }),
    content: pages.flat(),
  });
}

/** "Rupees Twenty Seven Thousand Seven Hundred Twenty Two and Twenty Two Paise Only" (lakh / crore grouping). */
export function amountInWords(amount: number): string {
  let rupees = Math.floor(amount);
  let paise = Math.round((amount - rupees) * 100);
  if (paise === 100) { rupees++; paise = 0; }
  let text = 'Rupees ' + (rupees === 0 ? 'Zero' : words(rupees));
  if (paise > 0) text += ' and ' + words(paise) + ' Paise';
  return text + ' Only';
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen',
  'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function words(n: number): string {
  const parts: string[] = [];
  const add = (v: number, unit: string) => { if (v > 0) parts.push(belowThousand(v) + (unit ? ' ' + unit : '')); };
  if (n >= 10_000_000) { parts.push(words(Math.floor(n / 10_000_000)) + ' Crore'); n %= 10_000_000; }
  add(Math.floor(n / 100_000), 'Lakh'); n %= 100_000;
  add(Math.floor(n / 1000), 'Thousand'); n %= 1000;
  add(n, '');
  return parts.join(' ');
}

function belowThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(ONES[Math.floor(n / 100)] + ' Hundred'); n %= 100; }
  if (n >= 20) parts.push(TENS[Math.floor(n / 10)] + (n % 10 > 0 ? ' ' + ONES[n % 10] : ''));
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(' ');
}
