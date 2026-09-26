using System.Data;
using ClosedXML.Excel;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace ZkAttendance.Services;

public static class ExcelExporter
{
    public static void Export(ReportResult r, string path)
    {
        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add(SafeSheetName(r.Title));
        int cols = Math.Max(1, r.Table.Columns.Count);

        ws.Cell(1, 1).Value = ReportService.CompanyName;
        ws.Range(1, 1, 1, cols).Merge().Style.Font.SetBold().Font.SetFontSize(15);
        ws.Cell(2, 1).Value = $"{r.Title} — {r.Subtitle}";
        ws.Range(2, 1, 2, cols).Merge().Style.Font.SetBold().Font.SetFontSize(11);
        ws.Cell(3, 1).Value = $"Generated: {DateTime.Now:dd-MM-yyyy HH:mm}";
        ws.Range(3, 1, 3, cols).Merge().Style.Font.SetFontColor(XLColor.Gray);

        const int headerRow = 5;
        for (int c = 0; c < r.Table.Columns.Count; c++)
        {
            var cell = ws.Cell(headerRow, c + 1);
            cell.Value = r.Table.Columns[c].ColumnName;
            cell.Style.Font.SetBold().Font.SetFontColor(XLColor.White)
                .Fill.SetBackgroundColor(XLColor.FromArgb(30, 64, 175))
                .Alignment.SetHorizontal(XLAlignmentHorizontalValues.Center);
        }

        for (int i = 0; i < r.Table.Rows.Count; i++)
        {
            for (int c = 0; c < r.Table.Columns.Count; c++)
            {
                var text = r.Table.Rows[i][c]?.ToString() ?? "";
                var cell = ws.Cell(headerRow + 1 + i, c + 1);
                if (double.TryParse(text, out var num) && !text.Contains(':') && !text.StartsWith('0')) cell.Value = num;
                else cell.Value = text;

                if (r.StatusColumns.Contains(r.Table.Columns[c].ColumnName) && ReportService.StatusColor(text) is { } col)
                {
                    cell.Style.Fill.SetBackgroundColor(XLColor.FromColor(col.back)).Font.SetFontColor(XLColor.FromColor(col.fore))
                        .Alignment.SetHorizontal(XLAlignmentHorizontalValues.Center);
                }
            }
        }

        var table = ws.Range(headerRow, 1, headerRow + r.Table.Rows.Count, cols);
        table.Style.Border.SetOutsideBorder(XLBorderStyleValues.Thin).Border.SetInsideBorder(XLBorderStyleValues.Thin)
             .Border.SetOutsideBorderColor(XLColor.LightGray).Border.SetInsideBorderColor(XLColor.LightGray);
        ws.SheetView.FreezeRows(headerRow);
        ws.Columns().AdjustToContents(headerRow, headerRow + r.Table.Rows.Count, 4, 45);
        ws.PageSetup.PageOrientation = cols > 10 ? XLPageOrientation.Landscape : XLPageOrientation.Portrait;
        ws.PageSetup.FitToPages(1, 0);
        wb.SaveAs(path);
    }

    private static string SafeSheetName(string s)
    {
        foreach (var ch in @"[]:*?/\") s = s.Replace(ch, ' ');
        return s.Length > 31 ? s[..31] : s;
    }
}

public static class PdfExporter
{
    static PdfExporter() => QuestPDF.Settings.License = LicenseType.Community;

    public static void Export(ReportResult r, string path)
    {
        var t = r.Table;
        int cols = t.Columns.Count;
        bool landscape = cols > 9;
        float fontSize = cols > 30 ? 5.5f : cols > 16 ? 7 : 8.5f;
        var company = ReportService.CompanyName;
        var address = ReportService.CompanyAddress;

        // Relative widths from content length so names/remarks get more room than codes.
        var widths = Enumerable.Range(0, cols).Select(c =>
        {
            int max = t.Columns[c].ColumnName.Length;
            foreach (DataRow row in t.Rows) max = Math.Max(max, row[c]?.ToString()?.Length ?? 0);
            return (float)Math.Clamp(max, 2, 32);
        }).ToArray();

        Document.Create(doc => doc.Page(page =>
        {
            page.Size(landscape ? PageSizes.A4.Landscape() : PageSizes.A4);
            page.Margin(20);
            page.DefaultTextStyle(x => x.FontSize(fontSize));

            page.Header().PaddingBottom(8).Column(h =>
            {
                h.Item().Text(company).FontSize(15).Bold().FontColor(Colors.Blue.Darken3);
                if (!string.IsNullOrWhiteSpace(address)) h.Item().Text(address).FontSize(8).FontColor(Colors.Grey.Darken1);
                h.Item().PaddingTop(4).Row(row =>
                {
                    row.RelativeItem().Text($"{r.Title}  |  {r.Subtitle}").FontSize(10).SemiBold();
                    row.AutoItem().AlignRight().Text($"Generated {DateTime.Now:dd-MM-yyyy HH:mm}").FontSize(7).FontColor(Colors.Grey.Medium);
                });
            });

            page.Content().Table(table =>
            {
                table.ColumnsDefinition(cd => { foreach (var w in widths) cd.RelativeColumn(w); });

                table.Header(header =>
                {
                    foreach (DataColumn c in t.Columns)
                        header.Cell().Background(Colors.Blue.Darken3).Padding(2)
                              .AlignCenter().Text(c.ColumnName).FontColor(Colors.White).Bold();
                });

                int i = 0;
                foreach (DataRow row in t.Rows)
                {
                    var zebra = i++ % 2 == 0 ? Colors.White : Colors.Grey.Lighten5;
                    for (int c = 0; c < cols; c++)
                    {
                        var text = row[c]?.ToString() ?? "";
                        var bg = zebra;
                        string? fg = null;
                        if (r.StatusColumns.Contains(t.Columns[c].ColumnName) && ReportService.StatusColor(text) is { } sc)
                        {
                            bg = Hex(sc.back);
                            fg = Hex(sc.fore);
                        }
                        var cell = table.Cell().Background(bg).BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Padding(2);
                        var txt = (r.StatusColumns.Contains(t.Columns[c].ColumnName) ? cell.AlignCenter() : cell).Text(text);
                        if (fg != null) txt.FontColor(fg).SemiBold();
                    }
                }
            });

            page.Footer().AlignCenter().Text(x =>
            {
                x.Span("Page ").FontSize(7);
                x.CurrentPageNumber().FontSize(7);
                x.Span(" of ").FontSize(7);
                x.TotalPages().FontSize(7);
            });
        })).GeneratePdf(path);
    }

    private static string Hex(System.Drawing.Color c) => $"#{c.R:X2}{c.G:X2}{c.B:X2}";
}
