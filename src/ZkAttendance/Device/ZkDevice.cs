using ZkAttendance.Data;

namespace ZkAttendance.Device;

public record DevicePunch(string EnrollNo, DateTime Time, int VerifyMode, int InOutMode, int WorkCode);

public record DeviceFinger(int FingerIndex, int Flag, string Template);

public class DeviceUser
{
    public string EnrollNo { get; set; } = "";
    public string Name { get; set; } = "";
    public string Password { get; set; } = "";
    public int Privilege { get; set; }
    public bool Enabled { get; set; } = true;
    public string CardNo { get; set; } = "";
    public List<DeviceFinger> Fingers { get; } = new();
}

public record DeviceInfo(string SerialNumber, string Firmware, string Platform, string ProductName, int UserCount, int AdminCount,
    int FingerCount, int FaceCount, int PasswordCount, int LogCount, DateTime? DeviceTime);

public class DeviceException(string message) : Exception(message);

/// <summary>
/// Driver for ZKTeco devices through the zkemkeeper COM SDK (Standalone SDK): USB client, Serial/RS485 and TCP/IP,
/// both old B&amp;W firmware (integer user IDs) and TFT firmware (SSR string user IDs). Also works for OEM rebrands (eSSL etc.).
/// Uses late binding so the project builds without the SDK installed; the SDK must be
/// registered on the PC at runtime (see README). LX50 connects over its Mini-USB client port.
/// </summary>
public sealed class ZkDevice : IAttendanceDevice
{
    public string Driver => "ZKTeco SDK";
    public DeviceFeatures Features => DeviceFeatures.DownloadLogs | DeviceFeatures.DownloadUsers | DeviceFeatures.Fingerprints |
        DeviceFeatures.UploadUsers | DeviceFeatures.DeleteUser | DeviceFeatures.SyncTime | DeviceFeatures.ClearLogs |
        DeviceFeatures.Restart | DeviceFeatures.RemoteEnroll | DeviceFeatures.Info;

    private readonly StaWorker _worker = new("ZKTeco SDK");
    private dynamic? _zk;
    private int _machine = 1;
    /// <summary>Newer firmware uses string user IDs (SSR_* calls), old B&W firmware uses ints.</summary>
    private bool? _ssr;

    public bool IsConnected { get; private set; }
    public DeviceProfile? Profile { get; private set; }

    public static string[] FingerNames => DeviceDrivers.FingerNames;

    public Task ConnectAsync(DeviceProfile p) => _worker.Run(() =>
    {
        _zk ??= CreateSdk();
        if (IsConnected) _zk.Disconnect();
        _machine = p.MachineNumber;
        if (p.CommPassword != 0) _zk.SetCommPassword(p.CommPassword);

        bool ok = p.Kind switch
        {
            ConnectionKind.Usb => _zk.Connect_USB(_machine),
            ConnectionKind.Serial => _zk.Connect_Com(ParseComPort(p.ComPort), _machine, p.BaudRate),
            ConnectionKind.Tcp => _zk.Connect_Net(p.IpAddress, p.TcpPort),
            _ => throw new DeviceException($"{p.Kind} ZKTeco SDK driver se connect nahi hota."),
        };
        if (!ok)
            throw new DeviceException($"Device connect nahi hua ({p.Kind}). Error code: {LastError()}. " +
                "Check: USB cable, device ON, COM/USB driver, Comm Key (password) aur Machine No.");
        IsConnected = true;
        Profile = p;
        _ssr = null;
    });

    public Task DisconnectAsync() => _worker.Run(() =>
    {
        if (_zk != null && IsConnected) _zk!.Disconnect();
        IsConnected = false;
    });

    public Task<DeviceInfo> GetInfoAsync() => _worker.Run(() =>
    {
        EnsureConnected();
        string serial = "", firmware = "", platform = "", product = "";
        try { _zk!.GetSerialNumber(_machine, ref serial); } catch { }
        try { _zk!.GetFirmwareVersion(_machine, ref firmware); } catch { }
        try { _zk!.GetPlatform(_machine, ref platform); } catch { }
        try { _zk!.GetProductCode(_machine, ref product); } catch { }
        if (string.IsNullOrWhiteSpace(product))
            try { _zk!.GetSysOption(_machine, "~DeviceName", ref product); } catch { }
        return new DeviceInfo(serial, firmware, platform, product.Trim(), Status(2), Status(1), Status(3), Status(21), Status(4), Status(6), ReadTime());
    });

    /// <summary>GetDeviceStatus codes: 1 admins, 2 users, 3 fingerprints, 4 passwords, 6 attendance logs, 21 faces.</summary>
    private int Status(int code)
    {
        int value = 0;
        try { _zk!.GetDeviceStatus(_machine, code, ref value); } catch { }
        return value;
    }

    public Task<DateTime?> GetTimeAsync() => _worker.Run(() => { EnsureConnected(); return ReadTime(); });

    public Task SyncTimeAsync() => _worker.Run(() =>
    {
        EnsureConnected();
        if (!_zk!.SetDeviceTime(_machine)) throw Fail("Time sync failed");
    });

    public Task<List<DevicePunch>> ReadLogsAsync() => _worker.Run(() =>
    {
        EnsureConnected();
        var list = new List<DevicePunch>();
        Locked(() =>
        {
            if (!_zk!.ReadGeneralLogData(_machine))
            {
                int err = LastError();
                if (err == 0 || err == -100) return; // no records
                throw new DeviceException($"Attendance read failed. Error code: {err}");
            }

            if (_ssr != false)
            {
                string enroll = ""; int verify = 0, state = 0, y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0, wc = 0;
                while (_zk.SSR_GetGeneralLogData(_machine, ref enroll, ref verify, ref state,
                           ref y, ref mo, ref d, ref h, ref mi, ref s, ref wc))
                {
                    list.Add(new DevicePunch(enroll.Trim(), SafeDate(y, mo, d, h, mi, s), verify, state, wc));
                }
                if (list.Count > 0) { _ssr = true; return; }
                // Nothing returned via SSR: re-read buffer and try the legacy integer API.
                _zk.ReadGeneralLogData(_machine);
            }

            int tm = 0, en = 0, em = 0, v = 0, st = 0, yy = 0, mm = 0, dd = 0, hh = 0, mn = 0;
            while (_zk.GetGeneralLogData(_machine, ref tm, ref en, ref em, ref v, ref st, ref yy, ref mm, ref dd, ref hh, ref mn))
                list.Add(new DevicePunch(en.ToString(), SafeDate(yy, mm, dd, hh, mn, 0), v, st, 0));
            if (list.Count > 0) _ssr = false;
        });
        return list;
    });

    public Task<List<DeviceUser>> ReadUsersAsync(bool withFingerprints, IProgress<string>? progress = null) => _worker.Run(() =>
    {
        EnsureConnected();
        var users = new List<DeviceUser>();
        Locked(() =>
        {
            _zk!.ReadAllUserID(_machine);
            if (withFingerprints) _zk.ReadAllTemplate(_machine);

            if (_ssr != false)
            {
                string id = "", name = "", pwd = ""; int priv = 0; bool enabled = false;
                while (_zk.SSR_GetAllUserInfo(_machine, ref id, ref name, ref pwd, ref priv, ref enabled))
                {
                    string card = "";
                    try { _zk.GetStrCardNumber(ref card); } catch { }
                    users.Add(new DeviceUser { EnrollNo = id.Trim(), Name = CleanName(name), Password = pwd, Privilege = priv, Enabled = enabled, CardNo = card });
                }
                if (users.Count > 0) _ssr = true;
            }
            if (users.Count == 0)
            {
                _zk.ReadAllUserID(_machine);
                int id = 0, priv = 0; string name = "", pwd = ""; bool enabled = false;
                while (_zk.GetAllUserInfo(_machine, ref id, ref name, ref pwd, ref priv, ref enabled))
                    users.Add(new DeviceUser { EnrollNo = id.ToString(), Name = CleanName(name), Password = pwd, Privilege = priv, Enabled = enabled });
                if (users.Count > 0) _ssr = false;
            }

            if (!withFingerprints) return;
            int n = 0;
            foreach (var u in users)
            {
                progress?.Report($"Fingerprints: {++n}/{users.Count} ({u.EnrollNo})");
                for (int f = 0; f < 10; f++)
                {
                    string tmp = ""; int flag = 0, len = 0;
                    bool got;
                    try { got = _zk.GetUserTmpExStr(_machine, u.EnrollNo, f, ref flag, ref tmp, ref len); }
                    catch { got = _zk.SSR_GetUserTmpStr(_machine, u.EnrollNo, f, ref tmp, ref len); flag = 1; }
                    if (got && !string.IsNullOrEmpty(tmp)) u.Fingers.Add(new DeviceFinger(f, flag, tmp));
                }
            }
        });
        return users;
    });

    public Task UploadUsersAsync(IEnumerable<DeviceUser> users, IProgress<string>? progress = null) => _worker.Run(() =>
    {
        EnsureConnected();
        var list = users.ToList();
        Locked(() =>
        {
            int n = 0;
            foreach (var u in list)
            {
                progress?.Report($"Uploading {++n}/{list.Count}: {u.EnrollNo} {u.Name}");
                if (!string.IsNullOrEmpty(u.CardNo)) { try { _zk!.SetStrCardNumber(u.CardNo); } catch { } }
                bool ok = _ssr == false && int.TryParse(u.EnrollNo, out int numId)
                    ? _zk!.SetUserInfo(_machine, numId, u.Name, u.Password, u.Privilege, u.Enabled)
                    : _zk!.SSR_SetUserInfo(_machine, u.EnrollNo, u.Name, u.Password, u.Privilege, u.Enabled);
                if (!ok) throw Fail($"User {u.EnrollNo} upload failed");

                foreach (var f in u.Fingers)
                {
                    bool fok;
                    try { fok = _zk.SetUserTmpExStr(_machine, u.EnrollNo, f.FingerIndex, f.Flag, f.Template); }
                    catch { fok = _zk.SSR_SetUserTmpStr(_machine, u.EnrollNo, f.FingerIndex, f.Template); }
                    if (!fok) progress?.Report($"  Finger {f.FingerIndex} of {u.EnrollNo} rejected (template format mismatch?)");
                }
            }
        });
        _zk!.RefreshData(_machine);
    });

    public Task DeleteUserAsync(string enrollNo) => _worker.Run(() =>
    {
        EnsureConnected();
        Locked(() =>
        {
            bool ok = _ssr == false && int.TryParse(enrollNo, out int id)
                ? _zk!.DeleteEnrollData(_machine, id, _machine, 12)
                : _zk!.SSR_DeleteEnrollData(_machine, enrollNo, 12);
            if (!ok) throw Fail($"Delete {enrollNo} failed");
        });
        _zk!.RefreshData(_machine);
    });

    /// <summary>Puts the device in enroll mode for a user/finger. Supported on firmware with remote enroll.</summary>
    public Task StartEnrollAsync(string enrollNo, int fingerIndex) => _worker.Run(() =>
    {
        EnsureConnected();
        try { _zk!.CancelOperation(); } catch { }
        try { _zk!.SSR_DelUserTmpExt(_machine, enrollNo, fingerIndex); } catch { }
        bool ok;
        try { ok = _zk!.StartEnrollEx(enrollNo, fingerIndex, 1); }
        catch { ok = int.TryParse(enrollNo, out int id) && _zk!.StartEnroll(id, fingerIndex); }
        if (!ok) throw Fail("Remote enroll is device par support nahi hai. Device par hi finger enroll karke 'Download Users' karein");
        try { _zk!.StartIdentify(); } catch { }
    });

    public Task ClearLogsAsync() => _worker.Run(() =>
    {
        EnsureConnected();
        Locked(() => { if (!_zk!.ClearGLog(_machine)) throw Fail("Clear logs failed"); });
        _zk!.RefreshData(_machine);
    });

    public Task RestartAsync() => _worker.Run(() =>
    {
        EnsureConnected();
        _zk!.RestartDevice(_machine);
        IsConnected = false;
    });

    // ---------- helpers (run on the STA thread) ----------

    private static dynamic CreateSdk()
    {
        var type = Type.GetTypeFromProgID("zkemkeeper.ZKEM") ?? Type.GetTypeFromProgID("zkemkeeper.CZKEM");
        if (type == null)
            throw new DeviceException(
                "ZKTeco SDK (zkemkeeper.dll) is PC par registered nahi hai.\n\n" +
                "ZKTeco Standalone SDK download karke 'Register_SDK.bat' (32-bit) Administrator se chalayein, " +
                "ya: regsvr32 C:\\Windows\\SysWOW64\\zkemkeeper.dll\nDetails README.md me hain.");
        return Activator.CreateInstance(type)!;
    }

    /// <summary>Disables the device keypad/sensor during bulk operations, as the SDK recommends.</summary>
    private void Locked(Action action)
    {
        _zk!.EnableDevice(_machine, false);
        try { action(); }
        finally { _zk.EnableDevice(_machine, true); }
    }

    private DateTime? ReadTime()
    {
        int y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0;
        try
        {
            if (_zk!.GetDeviceTime(_machine, ref y, ref mo, ref d, ref h, ref mi, ref s))
                return SafeDate(y, mo, d, h, mi, s);
        }
        catch { }
        return null;
    }

    private void EnsureConnected()
    {
        if (!IsConnected || _zk == null) throw new DeviceException("Device connected nahi hai. Pehle Device page se Connect karein.");
    }

    private int LastError()
    {
        int code = 0;
        try { _zk?.GetLastError(ref code); } catch { }
        return code;
    }

    private DeviceException Fail(string msg) => new($"{msg}. Error code: {LastError()}");

    private static DateTime SafeDate(int y, int mo, int d, int h, int mi, int s)
    {
        try { return new DateTime(y, mo, d, h, mi, s); }
        catch { return DateTime.MinValue; }
    }

    private static string CleanName(string name) => name.Split('\0')[0].Trim();

    private static int ParseComPort(string port) =>
        int.TryParse(new string(port.Where(char.IsDigit).ToArray()), out var n) ? n : 1;

    public void Dispose()
    {
        try { DisconnectAsync().Wait(2000); } catch { }
        _worker.Dispose();
    }
}
