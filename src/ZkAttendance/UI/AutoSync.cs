using ZkAttendance.Data;
using ZkAttendance.Device;

namespace ZkAttendance.UI;

/// <summary>
/// Background pull sync for SDK devices (USB / Serial / Ethernet): every few minutes it reads the device counters and
/// downloads only when they changed, so the device keypad is not locked for nothing. Also syncs the device clock once
/// a day and warns when the attendance log memory is nearly full. Never shows popups; problems go to the connection log.
/// ADMS devices push by themselves and are skipped.
/// </summary>
public static class AutoSync
{
    public const int DefaultMinutes = 5;
    private const double FullWarning = 0.8;

    /// <summary>Raised when a sync saved new punches: (device, all punches read) for the records grid.</summary>
    public static event Action<DeviceProfile, List<DevicePunch>>? NewPunches;

    public static int Minutes =>
        int.TryParse(AppDbContext.GetSetting("AutoSync.Minutes", DefaultMinutes.ToString()), out var m) ? Math.Clamp(m, 0, 1440) : DefaultMinutes;

    /// <summary>Devices the user wants synced: connected once and not disconnected by hand. They are reconnected quietly.</summary>
    private static readonly HashSet<int> Wanted = new();
    /// <summary>Devices whose last sync failed, so the failure is logged once and not every tick.</summary>
    private static readonly HashSet<int> Failing = new();
    private static System.Windows.Forms.Timer? _timer;
    private static bool _running;

    public static void MarkConnected(int id) { lock (Wanted) Wanted.Add(id); }
    public static void MarkDisconnected(int id) { lock (Wanted) Wanted.Remove(id); }

    /// <summary>Starts the timer (call on the UI thread) and, when enabled, connects all SDK devices and syncs right away.</summary>
    public static void Start()
    {
        if (_timer == null)
        {
            _timer = new System.Windows.Forms.Timer();
            _timer.Tick += async (_, _) => await RunOnce();
        }
        if (Minutes == 0) { Apply(); return; }
        foreach (var p in DeviceActions.All().Where(p => p.Kind != ConnectionKind.Adms)) MarkConnected(p.Id);
        Apply();
        _ = RunOnce();
    }

    /// <summary>Applies the saved interval (after Settings → Save).</summary>
    public static void Apply()
    {
        if (_timer == null) return;
        int m = Minutes;
        _timer.Enabled = m > 0;
        if (m > 0) _timer.Interval = m * 60_000;
        AppState.Log(0, m > 0 ? $"Auto-sync ON: har {m} minute" : "Auto-sync OFF");
    }

    public static async Task RunOnce()
    {
        if (_running) return;
        _running = true;
        try
        {
            List<DeviceProfile> devices;
            lock (Wanted)
                devices = DeviceActions.All()
                    .Where(p => p.Kind != ConnectionKind.Adms && (Wanted.Contains(p.Id) || AppState.IsConnected(p.Id)))
                    .ToList();
            foreach (var p in devices) await SyncDevice(p);
        }
        catch (Exception ex) { AppState.Log(0, "Auto-sync: " + FirstLine(ex)); }
        finally { _running = false; }
    }

    private static async Task SyncDevice(DeviceProfile p)
    {
        try
        {
            if (!AppState.IsConnected(p.Id)) await DeviceActions.Connect(p, quiet: true);
            if (Failing.Remove(p.Id)) AppState.Log(p.Id, "Auto-sync: device se connection wapas mil gaya");

            var info = await DeviceActions.RefreshInfo(p.Id);

            // Download only what changed since the last successful auto-sync.
            string logsKey = $"AutoSync.{p.Id}.Logs", usersKey = $"AutoSync.{p.Id}.Users";
            string logsNow = info.LogCount.ToString(), usersNow = $"{info.UserCount}/{info.FingerCount}/{info.PasswordCount}";
            if (AppDbContext.GetSetting(logsKey) != logsNow)
            {
                var (punches, result) = await DeviceActions.DownloadAttendance(p);
                AppDbContext.SetSetting(logsKey, logsNow);
                if (result.Added > 0) NewPunches?.Invoke(p, punches);
            }
            if (AppDbContext.GetSetting(usersKey) != usersNow)
            {
                await DeviceActions.DownloadUsers(p, overwriteNames: false);
                AppDbContext.SetSetting(usersKey, usersNow);
            }

            string today = DateTime.Today.ToString("yyyy-MM-dd");
            var dev = AppState.Device(p);
            if (dev.Features.HasFlag(DeviceFeatures.SyncTime) && AppDbContext.GetSetting($"AutoSync.{p.Id}.TimeSync") != today)
            {
                await dev.SyncTimeAsync();
                AppDbContext.SetSetting($"AutoSync.{p.Id}.TimeSync", today);
                AppState.Log(p.Id, $"Auto-sync: device time synchronized ({DateTime.Now:HH:mm:ss})");
            }

            if (info.LogCapacity > 0 && info.LogCount >= info.LogCapacity * FullWarning &&
                AppDbContext.GetSetting($"AutoSync.{p.Id}.FullWarned") != today)
            {
                AppDbContext.SetSetting($"AutoSync.{p.Id}.FullWarned", today);
                AppState.Log(p.Id, $"WARNING: device memory {info.LogCount * 100 / info.LogCapacity}% bhar gayi " +
                                   $"({info.LogCount}/{info.LogCapacity} logs). Sab download ho chuka hai; right-click → Clear Attendance Logs karein.");
            }
        }
        catch (Exception ex)
        {
            AppState.RaiseDeviceStatus();
            if (Failing.Add(p.Id))
                AppState.Log(p.Id, $"Auto-sync failed: {FirstLine(ex)} (har {Minutes} minute me dobara try hoga)");
        }
    }

    private static string FirstLine(Exception ex) => ex.Message.Split('\n')[0].Trim();
}
