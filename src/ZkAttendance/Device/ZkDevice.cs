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
    int FingerCount, int FaceCount, int PasswordCount, int LogCount, DateTime? DeviceTime,
    int UserCapacity = 0, int FingerCapacity = 0, int LogCapacity = 0);

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

    public Task<DeviceProfile> ConnectAsync(DeviceProfile p, IProgress<string>? progress = null, bool autoDetect = true) => _worker.Run(() =>
    {
        _zk ??= CreateSdk();
        if (IsConnected) { try { _zk.Disconnect(); } catch { } IsConnected = false; }

        if (TryConnect(p)) return Connected(p);
        int firstError = LastError();
        if (!autoDetect)
            throw new DeviceException($"Could not connect to the device ({Describe(p)}). {ErrorText(firstError)}");
        if (p.Kind is not (ConnectionKind.Usb or ConnectionKind.Serial))
            throw new DeviceException($"Could not connect to the device ({p.Kind}). {ErrorText(firstError)}\n" +
                "Check the IP address, port, network cable, Comm Key (password) and Machine No.");

        // The mini-USB port shows up either as a ZKTeco USB-client device or as a virtual COM port, depending on the
        // PC driver, and the device baud rate may differ from the saved one. Try every combination before giving up.
        progress?.Report("Auto-detecting USB / COM port...");
        foreach (var c in Candidates(p))
        {
            progress?.Report($"Trying {Describe(c)}...");
            if (!TryConnect(c)) continue;
            progress?.Report($"Device found on {Describe(c)}");
            return Connected(c);
        }
        throw new DeviceException(NotFoundMessage(p, firstError));
    });

    private bool TryConnect(DeviceProfile p)
    {
        try { _zk!.SetCommPassword(p.CommPassword); } catch { }
        try
        {
            return p.Kind switch
            {
                ConnectionKind.Usb => _zk!.Connect_USB(p.MachineNumber),
                ConnectionKind.Serial => _zk!.Connect_Com(ParseComPort(p.ComPort), p.MachineNumber, p.BaudRate),
                ConnectionKind.Tcp => _zk!.Connect_Net(p.IpAddress, p.TcpPort),
                _ => throw new DeviceException($"{p.Kind} connections are not supported by the ZKTeco SDK driver."),
            };
        }
        catch (DeviceException) { throw; }
        catch { return false; } // older SDK builds lack some Connect_* methods
    }

    private DeviceProfile Connected(DeviceProfile p)
    {
        IsConnected = true;
        Profile = p;
        _machine = p.MachineNumber;
        _ssr = null;
        _tmpApi = null;
        return p;
    }

    /// <summary>USB with the saved and the default machine no., then every COM port × common baud rates.</summary>
    private static IEnumerable<DeviceProfile> Candidates(DeviceProfile p)
    {
        int[] machines = new[] { p.MachineNumber, 1 }.Distinct().ToArray();
        var list = new List<DeviceProfile>();
        foreach (int m in machines) list.Add(With(p, ConnectionKind.Usb, m, p.ComPort, p.BaudRate));
        foreach (var port in DeviceDrivers.ComPorts())
            foreach (int baud in new[] { p.BaudRate, 115200, 38400, 57600, 19200, 9600 }.Distinct())
                foreach (int m in machines)
                    list.Add(With(p, ConnectionKind.Serial, m, port, baud));
        var tried = new HashSet<string> { Describe(p) };
        return list.Where(c => tried.Add(Describe(c)));
    }

    private static DeviceProfile With(DeviceProfile p, ConnectionKind kind, int machine, string port, int baud) => new()
    {
        Id = p.Id, Name = p.Name, Kind = kind, MachineNumber = machine, ComPort = port, BaudRate = baud,
        IpAddress = p.IpAddress, TcpPort = p.TcpPort, CommPassword = p.CommPassword, SerialNumber = p.SerialNumber,
    };

    private static string Describe(DeviceProfile p) => p.Kind switch
    {
        ConnectionKind.Usb => $"USB (Machine No. {p.MachineNumber})",
        ConnectionKind.Serial => $"{p.ComPort} @ {p.BaudRate} (Machine No. {p.MachineNumber})",
        _ => $"{p.IpAddress}:{p.TcpPort}",
    };

    private static string NotFoundMessage(DeviceProfile p, int error)
    {
        var ports = DeviceDrivers.ComPorts();
        return $"Device not found on any USB / COM port. {ErrorText(error)}\n\n" +
               "1. Make sure the Mini-USB cable is fully inserted at both the device and the PC, and that it is a data cable (not charge-only). The device must be ON.\n" +
               "2. Open Device Manager, then unplug and reconnect the cable: a new COM port under 'Ports (COM & LPT)' or a 'ZKTeco USB' " +
               "device should appear. If nothing appears, try another cable or another USB port on the PC; if a yellow ! appears, install the " +
               "driver (ZKTeco USB Client driver, CP210x or CH340).\n" +
               $"3. On the device menu → Comm: Device ID must be {p.MachineNumber} (the Machine No. in the software) and Comm Key must be {p.CommPassword}.\n" +
               $"4. COM ports on this PC: {(ports.Length == 0 ? "none" : string.Join(", ", ports))}.";
    }

    public Task DisconnectAsync() => _worker.Run(() =>
    {
        if (_zk != null && IsConnected) _zk!.Disconnect();
        IsConnected = false;
    });

    public Task<DeviceInfo> GetInfoAsync() => Op(() =>
    {
        string serial = "", firmware = "", platform = "", product = "";
        try { _zk!.GetSerialNumber(_machine, ref serial); } catch { }
        try { _zk!.GetFirmwareVersion(_machine, ref firmware); } catch { }
        try { _zk!.GetPlatform(_machine, ref platform); } catch { }
        try { _zk!.GetProductCode(_machine, ref product); } catch { }
        if (string.IsNullOrWhiteSpace(product))
            try { _zk!.GetSysOption(_machine, "~DeviceName", ref product); } catch { }
        return new DeviceInfo(serial, firmware, platform, product.Trim(), Status(2), Status(1), Status(3), Status(21), Status(4), Status(6), ReadTime(),
            Status(8), Status(7), Status(9));
    });

    /// <summary>
    /// GetDeviceStatus codes: 1 admins, 2 users, 3 fingerprints, 4 passwords, 6 attendance logs, 21 faces;
    /// capacities: 7 fingerprints, 8 users, 9 attendance logs.
    /// </summary>
    private int Status(int code)
    {
        int value = 0;
        try { _zk!.GetDeviceStatus(_machine, code, ref value); } catch { }
        return value;
    }

    public Task<DateTime?> GetTimeAsync() => Op(ReadTime);

    public Task SyncTimeAsync() => Op(() =>
    {
        if (!_zk!.SetDeviceTime(_machine)) throw Fail("Time sync failed");
    });

    public Task<List<DevicePunch>> ReadLogsAsync() => Op(() =>
    {
        var list = new List<DevicePunch>();
        Locked(() =>
        {
            if (!_zk!.ReadGeneralLogData(_machine))
            {
                int err = LastError();
                if (err == 0 || err == -100) return; // no records
                throw new DeviceException($"Attendance read failed. {ErrorText(err)}");
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

    public Task<List<DeviceUser>> ReadUsersAsync(bool withFingerprints, IProgress<string>? progress = null) => Op(() =>
    {
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
                    if (ReadFinger(u.EnrollNo, f) is { } finger) u.Fingers.Add(finger);
            }
        });
        return users;
    });

    public Task UploadUsersAsync(IEnumerable<DeviceUser> users, IProgress<string>? progress = null) => Op(() =>
    {
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
                    if (!WriteFinger(u.EnrollNo, f))
                        progress?.Report($"  Finger {f.FingerIndex} of {u.EnrollNo} rejected (template format mismatch?)");
            }
        });
        _zk!.RefreshData(_machine);
    });

    public Task DeleteUserAsync(string enrollNo) => Op(() =>
    {
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
    public Task StartEnrollAsync(string enrollNo, int fingerIndex) => Op(() =>
    {
        try { _zk!.CancelOperation(); } catch { }
        try { _zk!.SSR_DelUserTmpExt(_machine, enrollNo, fingerIndex); } catch { }
        bool ok;
        try { ok = _zk!.StartEnrollEx(enrollNo, fingerIndex, 1); }
        catch { ok = int.TryParse(enrollNo, out int id) && _zk!.StartEnroll(id, fingerIndex); }
        if (!ok)
            throw new DeviceException("This device does not support remote enrollment from the software (e.g. LX50).\n\n" +
                $"Enroll on the device: Menu → User Mgt → New User / Edit → AC No {enrollNo} → Fingerprint → place the finger 3 times.\n" +
                "Then click 'Download user info and Fp' (if auto-sync is ON, it is downloaded automatically within a few minutes).");
        try { _zk!.StartIdentify(); } catch { }
    });

    public Task ClearLogsAsync() => Op(() =>
    {
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

    /// <summary>
    /// Runs a device operation on the STA thread. If it fails because the link dropped (USB cable moved, device went to
    /// sleep), reconnects once with the same settings and retries.
    /// </summary>
    private Task<T> Op<T>(Func<T> op) => _worker.Run(() =>
    {
        EnsureConnected();
        try { return op(); }
        catch
        {
            if (Profile == null || Alive()) throw;
            IsConnected = false;
            try { _zk!.Disconnect(); } catch { }
            if (!TryConnect(Profile))
                throw new DeviceException("Connection to the device was lost and could not be restored. " +
                                          "Check the USB cable and device power, then click Connect.");
            IsConnected = true;
            return op();
        }
    });

    private Task Op(Action op) => Op(() => { op(); return true; });

    private bool Alive()
    {
        int y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0;
        try { return _zk!.GetDeviceTime(_machine, ref y, ref mo, ref d, ref h, ref mi, ref s); }
        catch { return false; }
    }

    /// <summary>Template API this firmware answers to: 0 = *TmpExStr, 1 = SSR_*TmpStr, 2 = legacy integer IDs (old B&amp;W).</summary>
    private int? _tmpApi;

    /// <summary>The legacy integer API hangs on SSR/TFT firmware (seen on LX50 6.60), so only B&amp;W firmware tries it.</summary>
    private int LastTmpApi => _ssr == false ? 2 : 1;

    private DeviceFinger? ReadFinger(string enrollNo, int finger)
    {
        for (int api = _tmpApi ?? 0; api <= (_tmpApi ?? LastTmpApi); api++)
        {
            string tmp = ""; int flag = 1, len = 0;
            bool got = false;
            try
            {
                got = api switch
                {
                    0 => _zk!.GetUserTmpExStr(_machine, enrollNo, finger, ref flag, ref tmp, ref len),
                    1 => _zk!.SSR_GetUserTmpStr(_machine, enrollNo, finger, ref tmp, ref len),
                    _ => int.TryParse(enrollNo, out int id) && _zk!.GetUserTmpStr(_machine, id, finger, ref tmp, ref len),
                };
            }
            catch { }
            if (!got || string.IsNullOrEmpty(tmp)) continue;
            _tmpApi = api;
            return new DeviceFinger(finger, api == 0 ? flag : 1, tmp);
        }
        return null;
    }

    private bool WriteFinger(string enrollNo, DeviceFinger f)
    {
        for (int api = _tmpApi ?? 0; api <= (_tmpApi ?? LastTmpApi); api++)
        {
            bool ok = false;
            try
            {
                ok = api switch
                {
                    0 => _zk!.SetUserTmpExStr(_machine, enrollNo, f.FingerIndex, f.Flag, f.Template),
                    1 => _zk!.SSR_SetUserTmpStr(_machine, enrollNo, f.FingerIndex, f.Template),
                    _ => int.TryParse(enrollNo, out int id) && _zk!.SetUserTmpStr(_machine, id, f.FingerIndex, f.Template),
                };
            }
            catch { }
            if (!ok) continue;
            _tmpApi = api;
            return true;
        }
        return false;
    }

    /// <summary>zkemkeeper GetLastError codes (Standalone SDK manual).</summary>
    private static string ErrorText(int code) => code switch
    {
        -1 => "Error -1: SDK not initialized / no connection.",
        -2 => "Error -2: read/write error on the cable or port.",
        -3 => "Error -3: invalid data size.",
        -4 => "Error -4: device memory is full.",
        -5 => "Error -5: data already exists.",
        -10 => "Error -10: invalid data length.",
        -100 => "Error -100: operation not supported by the device, or no data.",
        0 => "Error 0: no data found / the device did not respond.",
        4 => "Error 4: invalid parameter.",
        101 => "Error 101: could not allocate buffer.",
        _ => $"Error code: {code}.",
    };

    private static dynamic CreateSdk()
    {
        var type = Type.GetTypeFromProgID("zkemkeeper.ZKEM") ?? Type.GetTypeFromProgID("zkemkeeper.CZKEM");
        if (type == null)
            throw new DeviceException(
                "The ZKTeco SDK (zkemkeeper.dll) is not registered on this PC.\n\n" +
                "Download the ZKTeco Standalone SDK and run 'Register_SDK.bat' (32-bit) as Administrator, " +
                "or run: regsvr32 C:\\Windows\\SysWOW64\\zkemkeeper.dll\nSee README.md for details.");
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
        if (!IsConnected || _zk == null) throw new DeviceException("Device is not connected. Click Connect on the Device page first.");
    }

    private int LastError()
    {
        int code = 0;
        try { _zk?.GetLastError(ref code); } catch { }
        return code;
    }

    private DeviceException Fail(string msg) => new($"{msg}. {ErrorText(LastError())}");

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
