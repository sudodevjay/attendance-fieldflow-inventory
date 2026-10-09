/** Excel and PDF files of a report (the same layout as the attendance reports). The company name comes from attendance. */
import ExcelJS from 'exceljs';
import { companyAddress, companyName } from './attendance';
import { fmt, now } from './utils/time';

export interface ReportResult {
  title: string;
  subtitle: string;
  columns: string[];
  rows: (string | number)[][];
  /** Columns whose values are status codes (colored). */
  statusColumns: string[];
}

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

  ws.getCell(1, 1).value = companyName();
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
  const company = companyName();
  const address = companyAddress();
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
