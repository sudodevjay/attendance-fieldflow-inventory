using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace ZkAttendance.Services;

/// <summary>Salary slip PDF: one page per employee with attendance, earnings, deductions and net pay in words.</summary>
public static class SalarySlipPdf
{
    static SalarySlipPdf() => QuestPDF.Settings.License = LicenseType.Community;

    private const string Blue = "#1E3A8A";
    private const string Light = "#EEF2FF";
    private const string Line = "#CBD5E1";

    public static void Export(IReadOnlyList<PayLine> lines, DateTime monthStart, string path)
    {
        var company = ReportService.CompanyName;
        var address = ReportService.CompanyAddress;
        var monthEnd = monthStart.AddMonths(1).AddDays(-1);
        bool inProgress = monthEnd >= DateTime.Today;

        Document.Create(doc =>
        {
            foreach (var l in lines)
                doc.Page(page =>
                {
                    page.Size(PageSizes.A4);
                    page.Margin(30);
                    page.DefaultTextStyle(x => x.FontSize(9.5f));
                    page.Content().Column(col =>
                    {
                        col.Spacing(10);
                        Header(col, company, address, monthStart);
                        if (inProgress)
                            col.Item().Background("#FEF3C7").Padding(5)
                               .Text($"Month in progress: days after {DateTime.Today:dd-MM-yyyy} are not counted as paid yet.").FontSize(8.5f).FontColor("#92400E");
                        EmployeeBlock(col, l);
                        AttendanceBlock(col, l);
                        PayBlock(col, l);
                        NetPay(col, l);
                        if (!string.IsNullOrEmpty(l.Remark))
                            col.Item().Text($"Note: {l.Remark}").FontSize(8.5f).FontColor(Colors.Grey.Darken2);
                        Signatures(col);
                    });
                    page.Footer().AlignCenter().Text($"This is a computer-generated salary slip.   Generated {DateTime.Now:dd-MM-yyyy HH:mm}")
                        .FontSize(7.5f).FontColor(Colors.Grey.Medium);
                });
        }).GeneratePdf(path);
    }

    private static void Header(ColumnDescriptor col, string company, string address, DateTime month)
    {
        col.Item().BorderBottom(2).BorderColor(Blue).PaddingBottom(8).Row(row =>
        {
            row.RelativeItem().Column(c =>
            {
                c.Item().Text(company).FontSize(18).Bold().FontColor(Blue);
                if (!string.IsNullOrWhiteSpace(address)) c.Item().Text(address).FontSize(9).FontColor(Colors.Grey.Darken1);
            });
            row.AutoItem().AlignRight().AlignMiddle().Column(c =>
            {
                c.Item().AlignRight().Text("SALARY SLIP").FontSize(15).Bold();
                c.Item().AlignRight().Text(month.ToString("MMMM yyyy")).FontSize(11).SemiBold().FontColor(Blue);
            });
        });
    }

    private static void EmployeeBlock(ColumnDescriptor col, PayLine l)
    {
        var e = l.Employee;
        Section(col, "Employee Details");
        col.Item().Border(0.5f).BorderColor(Line).Padding(6).Row(row =>
        {
            row.RelativeItem().Column(c =>
            {
                Pair(c, "Name", e.Name);
                Pair(c, "AC No", e.EnrollNo);
                Pair(c, "Department", e.Department?.Name ?? "-");
            });
            row.RelativeItem().Column(c =>
            {
                Pair(c, "Designation", string.IsNullOrWhiteSpace(e.Designation) ? "-" : e.Designation);
                Pair(c, "Date of Joining", e.JoinDate?.ToString("dd-MM-yyyy") ?? "-");
                Pair(c, "Shift", e.Shift?.ToString() ?? "-");
            });
        });
    }

    private static void AttendanceBlock(ColumnDescriptor col, PayLine l)
    {
        var s = l.Summary;
        var items = new (string label, string value)[]
        {
            ("Days in Month", l.MonthDays.ToString()), ("Present", PayrollService.Num(s.Present)),
            ("Paid Leave", PayrollService.Num(s.PaidLeave)), ("Unpaid Leave (LWP)", PayrollService.Num(s.Leave - s.PaidLeave)),
            ("Holidays", s.Holidays.ToString()), ("Weekly Off", s.WeeklyOffs.ToString()),
            ("Absent", PayrollService.Num(s.Absent)), ("Late Arrivals", s.LateCount.ToString()),
            ("Overtime", string.IsNullOrEmpty(AttendanceProcessor.Hm(s.OvertimeMinutes)) ? "0:00" : AttendanceProcessor.Hm(s.OvertimeMinutes)),
            ("Paid Days", PayrollService.Num(s.PaidDays)), ("Late Deduction (days)", PayrollService.Num(l.LateCutDays)),
            ("Payable Days", PayrollService.Num(l.PayableDays)),
        };
        Section(col, "Attendance");
        col.Item().Table(t =>
        {
            t.ColumnsDefinition(cd => { for (int i = 0; i < 4; i++) { cd.RelativeColumn(3); cd.RelativeColumn(2); } });
            foreach (var (label, value) in items)
            {
                t.Cell().Border(0.5f).BorderColor(Line).Background(Light).Padding(4).Text(label).FontSize(8.5f);
                t.Cell().Border(0.5f).BorderColor(Line).Padding(4).AlignRight().Text(value).SemiBold();
            }
        });
    }

    private static void PayBlock(ColumnDescriptor col, PayLine l)
    {
        string M(decimal v) => "Rs. " + PayrollService.Money(v);
        var earnings = new List<(string, string)> { ("Monthly Salary", M(l.Employee.MonthlySalary)) };
        if (l.OtAmount > 0 || l.Summary.OvertimeMinutes > 0)
            earnings.Add(($"Overtime ({AttendanceProcessor.Hm(l.Summary.OvertimeMinutes)} h × {M(l.OtRate)}/h)", M(l.OtAmount)));
        var deductions = new List<(string, string)>
        {
            ($"Absent / unpaid days ({PayrollService.Num(l.UnpaidDays)} × {M(Math.Round(l.PerDay, 2))})", M(l.UnpaidDeduction)),
            ($"Late arrivals ({l.Summary.LateCount} late = {PayrollService.Num(l.LateCutDays)} day)", M(l.LateDeduction)),
        };

        col.Item().Row(row =>
        {
            row.RelativeItem().Element(c => Side(c, "Earnings", earnings, "Gross Earnings", M(l.GrossEarnings)));
            row.ConstantItem(12);
            row.RelativeItem().Element(c => Side(c, "Deductions", deductions, "Total Deductions", M(l.TotalDeductions)));
        });
    }

    private static void Side(IContainer container, string title, List<(string label, string amount)> rows, string totalLabel, string total)
    {
        container.Table(t =>
        {
            t.ColumnsDefinition(cd => { cd.RelativeColumn(3); cd.RelativeColumn(1.4f); });
            t.Header(h =>
            {
                h.Cell().Background(Blue).Padding(5).Text(title).FontColor(Colors.White).Bold();
                h.Cell().Background(Blue).Padding(5).AlignRight().Text("Amount").FontColor(Colors.White).Bold();
            });
            foreach (var (label, amount) in rows)
            {
                t.Cell().BorderBottom(0.5f).BorderColor(Line).Padding(5).Text(label);
                t.Cell().BorderBottom(0.5f).BorderColor(Line).Padding(5).AlignRight().Text(amount);
            }
            t.Cell().Background(Light).Padding(5).Text(totalLabel).Bold();
            t.Cell().Background(Light).Padding(5).AlignRight().Text(total).Bold();
        });
    }

    private static void NetPay(ColumnDescriptor col, PayLine l)
    {
        col.Item().Border(1).BorderColor(Blue).Background(Light).Padding(8).Column(c =>
        {
            c.Item().Row(r =>
            {
                r.RelativeItem().Text("NET PAY").FontSize(12).Bold().FontColor(Blue);
                r.AutoItem().Text("Rs. " + PayrollService.Money(l.NetPay)).FontSize(14).Bold().FontColor(Blue);
            });
            c.Item().PaddingTop(3).Text(AmountInWords(l.NetPay)).Italic().FontSize(9);
        });
    }

    private static void Signatures(ColumnDescriptor col)
    {
        col.Item().PaddingTop(45).Row(r =>
        {
            r.RelativeItem().Column(c => { c.Item().Width(150).BorderTop(0.8f).PaddingTop(3).Text("Employee Signature").FontSize(8.5f); });
            r.RelativeItem().AlignRight().Column(c => { c.Item().Width(150).BorderTop(0.8f).PaddingTop(3).AlignRight().Text("Authorised Signatory").FontSize(8.5f); });
        });
    }

    private static void Section(ColumnDescriptor col, string title) =>
        col.Item().PaddingTop(2).Text(title).FontSize(10.5f).Bold().FontColor(Blue);

    private static void Pair(ColumnDescriptor c, string label, string value) =>
        c.Item().PaddingVertical(1.5f).Row(r =>
        {
            r.ConstantItem(95).Text(label).FontColor(Colors.Grey.Darken2);
            r.RelativeItem().Text(value).SemiBold();
        });

    /// <summary>"Rupees Twenty Seven Thousand Seven Hundred Twenty Two and Twenty Two Paise Only" (Indian lakh / crore grouping).</summary>
    public static string AmountInWords(decimal amount)
    {
        long rupees = (long)Math.Floor(amount);
        int paise = (int)Math.Round((amount - rupees) * 100);
        if (paise == 100) { rupees++; paise = 0; }
        var text = "Rupees " + (rupees == 0 ? "Zero" : Words(rupees));
        if (paise > 0) text += " and " + Words(paise) + " Paise";
        return text + " Only";
    }

    private static readonly string[] Ones =
        ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
         "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    private static readonly string[] Tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

    private static string Words(long n)
    {
        var parts = new List<string>();
        void Add(long value, string unit) { if (value > 0) parts.Add(BelowThousand((int)value) + (unit == "" ? "" : " " + unit)); }
        if (n >= 10_000_000) { parts.Add(Words(n / 10_000_000) + " Crore"); n %= 10_000_000; }
        Add(n / 100_000, "Lakh"); n %= 100_000;
        Add(n / 1000, "Thousand"); n %= 1000;
        Add(n, "");
        return string.Join(" ", parts);
    }

    private static string BelowThousand(int n)
    {
        var parts = new List<string>();
        if (n >= 100) { parts.Add(Ones[n / 100] + " Hundred"); n %= 100; }
        if (n >= 20) { parts.Add(Tens[n / 10] + (n % 10 > 0 ? " " + Ones[n % 10] : "")); }
        else if (n > 0) parts.Add(Ones[n]);
        return string.Join(" ", parts);
    }
}
