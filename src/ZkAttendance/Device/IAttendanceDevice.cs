using ZkAttendance.Data;

namespace ZkAttendance.Device;

/// <summary>What a driver/device can do. The UI checks these instead of assuming a device model.</summary>
[Flags]
public enum DeviceFeatures
{
    None = 0,
    DownloadLogs = 1,
    DownloadUsers = 2,
    Fingerprints = 4,
    UploadUsers = 8,
    DeleteUser = 16,
    SyncTime = 32,
    ClearLogs = 64,
    Restart = 128,
    RemoteEnroll = 256,
    Info = 512,
    /// <summary>Device pushes punches to the PC in real time.</summary>
    LivePush = 1024,
}

/// <summary>
/// Hardware-independent device contract. Everything above this layer (employees, reports, UI) talks only to this
/// interface, so new device families or brands are supported by adding a driver, not by changing the program.
/// </summary>
public interface IAttendanceDevice : IDisposable
{
    /// <summary>Driver name shown to the user, e.g. "ZKTeco SDK".</summary>
    string Driver { get; }
    DeviceFeatures Features { get; }
    bool IsConnected { get; }

    /// <summary>
    /// Connects and returns the settings that actually worked. A driver may auto-detect (e.g. USB → virtual COM port),
    /// so the result can differ from <paramref name="profile"/>; the caller saves it back. Progress lines go to the log.
    /// <paramref name="autoDetect"/> = false tries only the saved settings (used by background auto-sync).
    /// </summary>
    Task<DeviceProfile> ConnectAsync(DeviceProfile profile, IProgress<string>? progress = null, bool autoDetect = true);
    Task DisconnectAsync();
    Task<DeviceInfo> GetInfoAsync();
    Task SyncTimeAsync();
    Task<List<DevicePunch>> ReadLogsAsync();
    Task<List<DeviceUser>> ReadUsersAsync(bool withFingerprints, IProgress<string>? progress = null);
    Task UploadUsersAsync(IEnumerable<DeviceUser> users, IProgress<string>? progress = null);
    Task DeleteUserAsync(string enrollNo);
    Task StartEnrollAsync(string enrollNo, int fingerIndex);
    Task ClearLogsAsync();
    Task RestartAsync();
}

public static class DeviceDrivers
{
    /// <summary>Picks the driver for a device profile. Add new brands/protocols here.</summary>
    public static IAttendanceDevice Create(DeviceProfile p) => p.Kind switch
    {
        ConnectionKind.Adms => new AdmsDevice(),
        _ => new ZkDevice(), // USB, Serial/RS485, TCP/IP via ZKTeco Standalone SDK
    };

    public static readonly string[] KindNames = ["USB", "Serial Port/RS485", "Ethernet", "ADMS (Push / Cloud)"];

    public static string KindName(ConnectionKind k) => KindNames[(int)k];

    /// <summary>COM ports present on this PC (a USB-client device with a virtual COM driver appears here).</summary>
    public static string[] ComPorts()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"HARDWARE\DEVICEMAP\SERIALCOMM");
            return key?.GetValueNames().Select(n => key.GetValue(n)?.ToString() ?? "").Where(s => s != "")
                       .OrderBy(s => s.Length).ThenBy(s => s).ToArray() ?? [];
        }
        catch { return []; }
    }

    public static void Require(this IAttendanceDevice d, DeviceFeatures f, string what)
    {
        if (!d.Features.HasFlag(f))
            throw new DeviceException($"'{what}' is not supported by this device / driver ({d.Driver}).");
    }

    public static readonly string[] FingerNames =
    [
        "Left Little", "Left Ring", "Left Middle", "Left Index", "Left Thumb",
        "Right Thumb", "Right Index", "Right Middle", "Right Ring", "Right Little"
    ];
}
