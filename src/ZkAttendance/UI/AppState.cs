using ZkAttendance.Data;
using ZkAttendance.Device;
using ZkAttendance.Services;

namespace ZkAttendance.UI;

/// <summary>App-wide state: one driver instance per device in the Machine List, plus the connection log.</summary>
public static class AppState
{
    private static readonly Dictionary<int, (ConnectionKind kind, IAttendanceDevice device)> Devices = new();

    /// <summary>Device selected in the Machine List; used by Employee window upload/download.</summary>
    public static int? CurrentDeviceId { get; set; }

    public static event Action? DeviceStatusChanged;
    public static void RaiseDeviceStatus() => DeviceStatusChanged?.Invoke();

    /// <summary>Raised after punches/employees change so open windows can refresh.</summary>
    public static event Action? DataChanged;
    public static void RaiseDataChanged() => DataChanged?.Invoke();

    /// <summary>Connection log line: (device id, message).</summary>
    public static event Action<int, string>? Logged;
    public static void Log(int deviceId, string message) => Logged?.Invoke(deviceId, message);

    /// <summary>
    /// Driver instance for a device profile; recreated if the connection type needs another driver. USB, Serial and
    /// Ethernet share the SDK driver, so a USB → COM switch by auto-detect keeps the live connection.
    /// </summary>
    public static IAttendanceDevice Device(DeviceProfile p)
    {
        lock (Devices)
        {
            if (Devices.TryGetValue(p.Id, out var e) && (e.kind == ConnectionKind.Adms) == (p.Kind == ConnectionKind.Adms))
                return e.device;
            e.device?.Dispose();
            var d = DeviceDrivers.Create(p);
            Devices[p.Id] = (p.Kind, d);
            return d;
        }
    }

    public static IAttendanceDevice Device(int profileId) => Device(DeviceActions.Load(profileId));

    public static bool IsConnected(int profileId)
    {
        lock (Devices) return Devices.TryGetValue(profileId, out var d) && d.device.IsConnected;
    }

    public static int ConnectedCount
    {
        get { lock (Devices) return Devices.Values.Count(d => d.device.IsConnected); }
    }

    public static void Remove(int profileId)
    {
        lock (Devices)
        {
            if (Devices.Remove(profileId, out var d)) d.device.Dispose();
        }
    }

    public static void DisposeAll()
    {
        lock (Devices)
        {
            foreach (var d in Devices.Values) d.device.Dispose();
            Devices.Clear();
        }
        AdmsServer.Stop();
    }
}

/// <summary>Device operations shared by the main window and the Employee window.</summary>
public static class DeviceActions
{
    public static DeviceProfile Load(int id)
    {
        using var db = new AppDbContext();
        return db.DeviceProfiles.First(p => p.Id == id);
    }

    public static List<DeviceProfile> All()
    {
        using var db = new AppDbContext();
        return db.DeviceProfiles.OrderBy(p => p.Id).ToList();
    }

    /// <summary>The selected device, or the first connected / first configured one.</summary>
    public static DeviceProfile Current()
    {
        var all = All();
        if (all.Count == 0) throw new DeviceException("No device has been added. Click 'Device' on the toolbar to add a device.");
        return all.FirstOrDefault(p => p.Id == AppState.CurrentDeviceId)
               ?? all.FirstOrDefault(p => AppState.IsConnected(p.Id))
               ?? all[0];
    }

    /// <param name="quiet">Background auto-sync: saved settings only (no port scan) and no log lines on failure.</param>
    public static async Task Connect(DeviceProfile p, bool quiet = false)
    {
        var dev = AppState.Device(p);
        if (dev.IsConnected) return;
        if (!quiet) AppState.Log(p.Id, "Connecting to device, please wait...");
        DeviceProfile used;
        try
        {
            used = await dev.ConnectAsync(p, quiet ? null : new LogProgress(p.Id), autoDetect: !quiet);
        }
        catch (Exception ex)
        {
            if (!quiet) AppState.Log(p.Id, "Failed to connect to device");
            AppState.RaiseDeviceStatus();
            throw new DeviceException(ex.Message);
        }
        AppState.Log(p.Id, "Connected to device successfully");
        AutoSync.MarkConnected(p.Id);
        if (used.Kind != p.Kind || used.MachineNumber != p.MachineNumber || used.ComPort != p.ComPort || used.BaudRate != p.BaudRate)
            SaveDetected(used);
        AppState.RaiseDeviceStatus();
        try { await RefreshInfo(p.Id); } catch (Exception ex) { AppState.Log(p.Id, "Read info failed: " + ex.Message); }
    }

    /// <summary>Auto-detect found the device on other settings (e.g. USB → COM5 @ 115200); keep them for next time.</summary>
    private static void SaveDetected(DeviceProfile used)
    {
        using var db = new AppDbContext();
        var p = db.DeviceProfiles.First(x => x.Id == used.Id);
        p.Kind = used.Kind;
        p.MachineNumber = used.MachineNumber;
        p.ComPort = used.ComPort;
        p.BaudRate = used.BaudRate;
        db.SaveChanges();
        AppState.Log(used.Id, used.Kind == ConnectionKind.Serial
            ? $"Settings saved: Comm type = Serial Port/RS485, {used.ComPort}, {used.BaudRate}, Machine No. {used.MachineNumber}"
            : $"Settings saved: Comm type = USB, Machine No. {used.MachineNumber}");
    }

    /// <summary>Sends driver progress lines to the connection log (the log marshals to the UI thread itself).</summary>
    private sealed class LogProgress(int deviceId) : IProgress<string>
    {
        public void Report(string value) => AppState.Log(deviceId, value);
    }

    public static async Task Disconnect(int id)
    {
        AutoSync.MarkDisconnected(id);
        await AppState.Device(id).DisconnectAsync();
        AppState.Log(id, "Disconnect");
        AppState.RaiseDeviceStatus();
    }

    public static async Task<IAttendanceDevice> Ensure(DeviceProfile p)
    {
        await Connect(p);
        return AppState.Device(p);
    }

    /// <summary>Reads serial/product/counters and caches them for the Machine List.</summary>
    public static async Task<DeviceInfo> RefreshInfo(int id)
    {
        var info = await AppState.Device(id).GetInfoAsync();
        using var db = new AppDbContext();
        var p = db.DeviceProfiles.First(x => x.Id == id);
        if (!string.IsNullOrWhiteSpace(info.SerialNumber)) p.SerialNumber = info.SerialNumber;
        p.ProductName = string.IsNullOrWhiteSpace(info.ProductName) ? info.Platform : info.ProductName;
        p.Firmware = info.Firmware;
        p.UserCount = info.UserCount;
        p.AdminCount = info.AdminCount;
        p.FpCount = info.FingerCount;
        p.FaceCount = info.FaceCount;
        p.PasswordCount = info.PasswordCount;
        p.LogCount = info.LogCount;
        db.SaveChanges();
        AppState.RaiseDeviceStatus();
        return info;
    }

    /// <summary>Downloads punches from the device into the database; returns the punches read.</summary>
    public static async Task<(List<DevicePunch> punches, SyncService.SaveResult result)> DownloadAttendance(DeviceProfile p)
    {
        var dev = await Ensure(p);
        dev.Require(DeviceFeatures.DownloadLogs, "Download attendance logs");
        AppState.Log(p.Id, dev.Features.HasFlag(DeviceFeatures.LivePush)
            ? "Requesting all attendance logs (device sends on next poll)..." : "Downloading attendance logs...");
        var punches = await dev.ReadLogsAsync();
        var result = await Task.Run(() => SyncService.SavePunches(punches, PunchSource.Device));
        using (var db = new AppDbContext())
        {
            db.DeviceProfiles.First(x => x.Id == p.Id).LastDownload = DateTime.Now;
            db.SaveChanges();
        }
        AppState.Log(p.Id, $"Download logs: {punches.Count} read, {result.Added} new");
        AppState.RaiseDataChanged();
        return (punches, result);
    }

    public static async Task<(int added, int updated, int fingers)> DownloadUsers(DeviceProfile p, bool overwriteNames)
    {
        var dev = await Ensure(p);
        dev.Require(DeviceFeatures.DownloadUsers, "Download user info");
        AppState.Log(p.Id, "Downloading user info and Fp...");
        var users = await dev.ReadUsersAsync(true);
        var (added, updated) = await Task.Run(() => SyncService.SaveUsers(users, overwriteNames));
        int fingers = users.Sum(u => u.Fingers.Count);
        AppState.Log(p.Id, $"Users: {users.Count} ({added} new), Fp: {fingers}");
        AppState.RaiseDataChanged();
        return (added, updated, fingers);
    }

    /// <summary>Uploads employees; returns how many fingerprint templates the device refused.</summary>
    public static async Task<int> UploadUsers(DeviceProfile p, List<int> employeeIds)
    {
        var dev = await Ensure(p);
        dev.Require(DeviceFeatures.UploadUsers, "Upload user info");
        AppState.Log(p.Id, $"Uploading {employeeIds.Count} user(s) and FP...");
        var rejected = new Collector();
        await dev.UploadUsersAsync(SyncService.ToDeviceUsers(employeeIds), rejected);
        AppState.Log(p.Id, rejected.Count == 0 ? "Upload user info and FP finished"
            : $"Upload user info finished; {rejected.Count} fingerprint(s) not accepted by the device");
        try { await RefreshInfo(p.Id); } catch { }
        return rejected.Count;
    }

    public static string RejectedFingersNote(int rejected) => rejected == 0 ? "" :
        $"\n\nName / password / card were updated on the device. {rejected} fingerprint(s) could not be sent from the software " +
        "(this device does not accept this template format). Fingerprints already enrolled on the device are unchanged; " +
        "enroll new fingers on the device.";

    /// <summary>Counts the per-finger "rejected" lines the driver reports during upload (reported synchronously on the device thread).</summary>
    private sealed class Collector : IProgress<string>
    {
        private int _count;
        public int Count => Volatile.Read(ref _count);
        public void Report(string value) { if (value.Contains("rejected")) Interlocked.Increment(ref _count); }
    }
}

/// <summary>Runs the ADMS push server and saves pushed data; unknown devices are added to the Machine List.</summary>
public static class AdmsHost
{
    public const int DefaultPort = 8081;
    private static bool _wired;

    /// <summary>Raised to show pushed punches live: (device id, device name, punches).</summary>
    public static event Action<int, string, List<DevicePunch>>? LivePunches;

    public static bool Enabled => AppDbContext.GetSetting("Adms.Enabled") == "1";
    public static int ConfiguredPort => int.TryParse(AppDbContext.GetSetting("Adms.Port"), out var p) ? p : DefaultPort;

    public static void StartIfEnabled()
    {
        using (var db = new AppDbContext())
            if (!Enabled && !db.DeviceProfiles.Any(p => p.Kind == ConnectionKind.Adms)) return;
        Start(ConfiguredPort);
    }

    public static void Start(int port)
    {
        if (!_wired)
        {
            _wired = true;
            AdmsServer.DeviceSeen += OnSeen;
            AdmsServer.PunchesReceived += OnPunches;
            AdmsServer.Log += (sn, msg) => AppState.Log(ProfileFor(sn)?.Id ?? 0, msg);
        }
        AdmsServer.Start(port);
        AppState.Log(0, $"ADMS server listening on port {port}");
    }

    private static DeviceProfile? ProfileFor(string sn)
    {
        using var db = new AppDbContext();
        return db.DeviceProfiles.FirstOrDefault(p => p.Kind == ConnectionKind.Adms && p.SerialNumber == sn);
    }

    private static void OnSeen(AdmsDeviceState s)
    {
        try
        {
            using var db = new AppDbContext();
            var p = db.DeviceProfiles.FirstOrDefault(x => x.Kind == ConnectionKind.Adms && x.SerialNumber == s.SerialNumber);
            if (p == null)
            {
                p = new DeviceProfile { Name = "ADMS " + s.SerialNumber, Kind = ConnectionKind.Adms, SerialNumber = s.SerialNumber, ProductName = "ADMS" };
                db.DeviceProfiles.Add(p);
                AppState.Log(0, $"New ADMS device {s.SerialNumber} added to Machine List");
            }
            p.IpAddress = s.RemoteIp;
            p.Firmware = s.Firmware;
            p.UserCount = s.UserCount;
            p.FpCount = s.FpCount;
            p.FaceCount = s.FaceCount;
            p.LogCount = s.LogCount;
            db.SaveChanges();
            AppState.RaiseDeviceStatus();
        }
        catch (Exception ex) { AppState.Log(0, "ADMS: " + ex.Message); }
    }

    private static void OnPunches(string sn, List<DevicePunch> punches)
    {
        try
        {
            var result = SyncService.SavePunches(punches, PunchSource.Device);
            var p = ProfileFor(sn);
            if (result.Added > 0)
            {
                AppState.Log(p?.Id ?? 0, $"Realtime: {result.Added} new punch(es)");
                LivePunches?.Invoke(p?.Id ?? 0, p?.Name ?? sn, punches);
                AppState.RaiseDataChanged();
            }
        }
        catch (Exception ex) { AppState.Log(0, "ADMS save failed: " + ex.Message); }
    }
}
