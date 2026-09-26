using System.Globalization;

namespace ZkAttendance.Device;

/// <summary>
/// Parses attendance files exported to a pendrive from the device menu
/// (USB Mgmt → Download Attlog). Supports the common ZKTeco formats:
///   1_attlog.dat : "PIN \t yyyy-MM-dd HH:mm:ss \t DevId \t Status \t Verify \t WorkCode"
///   GLG_001.TXT  : header "No Mchn EnNo Name Mode IOMd DateTime" (older B&amp;W firmware)
/// </summary>
public static class UsbFileImporter
{
    private static readonly string[] DateFormats =
    [
        "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm", "yyyy/MM/dd HH:mm:ss", "yyyy/MM/dd HH:mm",
        "yyyy/MM/dd  HH:mm:ss", "yyyy/MM/dd  HH:mm", "dd-MM-yyyy HH:mm:ss", "dd/MM/yyyy HH:mm:ss",
        "dd-MM-yyyy HH:mm", "dd/MM/yyyy HH:mm", "M/d/yyyy h:mm:ss tt", "M/d/yyyy H:mm:ss"
    ];

    public static List<DevicePunch> Parse(string path)
    {
        var result = new List<DevicePunch>();
        int enrollIdx = 0, stateIdx = 3, verifyIdx = 4, dateIdx = -1;
        bool header = false;

        foreach (var raw in File.ReadLines(path))
        {
            var line = raw.Trim('﻿', ' ', '\r');
            if (line.Length == 0) continue;
            var f = line.Contains('\t') ? line.Split('\t') : line.Split(',');
            for (int i = 0; i < f.Length; i++) f[i] = f[i].Trim().Trim('"');

            // Header row (GLG_001.TXT / CSV exports) - map columns by name.
            if (!header && f.Any(x => x.Equals("EnNo", StringComparison.OrdinalIgnoreCase) ||
                                      x.Equals("DateTime", StringComparison.OrdinalIgnoreCase)))
            {
                header = true;
                enrollIdx = Find(f, "EnNo", "PIN", "UserID", "User ID", "AC-No.");
                stateIdx = Find(f, "IOMd", "Status", "State");
                verifyIdx = Find(f, "Mode", "Verify", "VerifyMode");
                dateIdx = Find(f, "DateTime", "Time", "Date Time");
                continue;
            }

            int di = dateIdx >= 0 && dateIdx < f.Length ? dateIdx : Array.FindIndex(f, x => TryDate(x, out _));
            if (di < 0 || !TryDate(f[di], out var time)) continue;
            if (enrollIdx < 0 || enrollIdx >= f.Length) continue;

            var enroll = f[enrollIdx].TrimStart('0');
            if (enroll.Length == 0) enroll = "0";
            result.Add(new DevicePunch(enroll, time, Int(f, verifyIdx), Int(f, stateIdx), 0));
        }
        return result;
    }

    private static int Find(string[] f, params string[] names)
    {
        for (int i = 0; i < f.Length; i++)
            if (names.Any(n => f[i].Equals(n, StringComparison.OrdinalIgnoreCase))) return i;
        return -1;
    }

    private static int Int(string[] f, int idx) =>
        idx >= 0 && idx < f.Length && int.TryParse(f[idx], out var v) ? v : 0;

    private static bool TryDate(string s, out DateTime dt) =>
        DateTime.TryParseExact(s, DateFormats, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out dt);
}
