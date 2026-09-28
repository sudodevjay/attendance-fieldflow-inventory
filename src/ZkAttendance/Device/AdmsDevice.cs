using ZkAttendance.Data;

namespace ZkAttendance.Device;

/// <summary>
/// Driver for ZKTeco devices using ADMS (push). The device connects to <see cref="AdmsServer"/>; punches arrive in
/// real time. Other operations are sent as queued commands which the device picks up on its next poll (~10 s).
/// </summary>
public sealed class AdmsDevice : IAttendanceDevice
{
    private DeviceProfile? _profile;

    public string Driver => "ADMS Push";
    public DeviceFeatures Features => DeviceFeatures.DownloadLogs | DeviceFeatures.DownloadUsers | DeviceFeatures.Fingerprints |
        DeviceFeatures.UploadUsers | DeviceFeatures.DeleteUser | DeviceFeatures.ClearLogs | DeviceFeatures.Restart |
        DeviceFeatures.RemoteEnroll | DeviceFeatures.Info | DeviceFeatures.LivePush | DeviceFeatures.SyncTime;

    private string Sn => _profile?.SerialNumber ?? "";
    public bool IsConnected => _profile != null && AdmsServer.IsOnline(Sn);

    public async Task<DeviceProfile> ConnectAsync(DeviceProfile p, IProgress<string>? progress = null, bool autoDetect = true)
    {
        if (string.IsNullOrWhiteSpace(p.SerialNumber))
            throw new DeviceException("Serial Number is required for an ADMS device (device menu → System Info → Serial No.).");
        if (!AdmsServer.Running)
            throw new DeviceException("ADMS server is off. Turn on 'ADMS server' in Database Option.");
        _profile = p;
        // The device polls on its own schedule; wait briefly for it to show up.
        for (int i = 0; i < 30 && !AdmsServer.IsOnline(p.SerialNumber); i++) await Task.Delay(1000);
        if (!AdmsServer.IsOnline(p.SerialNumber))
            throw new DeviceException($"Device {p.SerialNumber} has not contacted the server yet.\n\n" +
                $"On the device menu → Comm → Cloud Server Setting, set Server Address = this PC's IP and Port = {AdmsServer.Port}, " +
                "and allow this port in Windows Firewall.");
        return p;
    }

    public Task DisconnectAsync()
    {
        _profile = null;
        return Task.CompletedTask;
    }

    public Task<DeviceInfo> GetInfoAsync()
    {
        var s = AdmsServer.Get(Sn) ?? throw new DeviceException("Device is not online.");
        AdmsServer.Enqueue(Sn, "INFO");
        return Task.FromResult(new DeviceInfo(s.SerialNumber, s.Firmware, "ADMS " + s.PushVersion, "ADMS", s.UserCount, 0,
            s.FpCount, s.FaceCount, 0, s.LogCount, null));
    }

    public Task SyncTimeAsync()
    {
        // Devices take the server time from the HTTP Date header; this asks the device to re-check with the server.
        AdmsServer.Enqueue(Sn, "CHECK");
        return Task.CompletedTask;
    }

    public async Task<List<DevicePunch>> ReadLogsAsync()
    {
        var result = new List<DevicePunch>();
        void OnPunches(string sn, List<DevicePunch> p) { if (string.Equals(sn, Sn, StringComparison.OrdinalIgnoreCase)) lock (result) result.AddRange(p); }
        AdmsServer.PunchesReceived += OnPunches;
        try
        {
            AdmsServer.Enqueue(Sn, $"DATA QUERY ATTLOG StartTime=2000-01-01 00:00:00\tEndTime={DateTime.Now.AddDays(1):yyyy-MM-dd} 23:59:59");
            await WaitForData(() => { lock (result) return result.Count; });
        }
        finally { AdmsServer.PunchesReceived -= OnPunches; }
        return result;
    }

    public async Task<List<DeviceUser>> ReadUsersAsync(bool withFingerprints, IProgress<string>? progress = null)
    {
        var users = new Dictionary<string, DeviceUser>();
        void OnUsers(string sn, List<DeviceUser> list)
        {
            if (!string.Equals(sn, Sn, StringComparison.OrdinalIgnoreCase)) return;
            lock (users)
                foreach (var u in list)
                {
                    if (!users.TryGetValue(u.EnrollNo, out var existing)) users[u.EnrollNo] = existing = new DeviceUser { EnrollNo = u.EnrollNo };
                    if (u.Name.Length > 0 || u.Password.Length > 0) { existing.Name = u.Name; existing.Password = u.Password; existing.CardNo = u.CardNo; existing.Privilege = u.Privilege; }
                    existing.Fingers.AddRange(u.Fingers);
                }
        }
        AdmsServer.UsersReceived += OnUsers;
        try
        {
            AdmsServer.Enqueue(Sn, "DATA QUERY USERINFO");
            if (withFingerprints) AdmsServer.Enqueue(Sn, "DATA QUERY FINGERTMP");
            progress?.Report("Waiting for device to send users...");
            await WaitForData(() => { lock (users) return users.Count + users.Values.Sum(u => u.Fingers.Count); });
        }
        finally { AdmsServer.UsersReceived -= OnUsers; }
        return users.Values.ToList();
    }

    public Task UploadUsersAsync(IEnumerable<DeviceUser> users, IProgress<string>? progress = null)
    {
        foreach (var u in users)
        {
            AdmsServer.Enqueue(Sn, $"DATA UPDATE USERINFO PIN={u.EnrollNo}\tName={u.Name}\tPri={u.Privilege}\tPasswd={u.Password}\tCard={u.CardNo}\tGrp=1\tTZ=0000000100000000\tVerify=0");
            foreach (var f in u.Fingers)
                AdmsServer.Enqueue(Sn, $"DATA UPDATE FINGERTMP PIN={u.EnrollNo}\tFID={f.FingerIndex}\tSize={f.Template.Length}\tValid=1\tTMP={f.Template}");
        }
        progress?.Report("Commands queued; device will apply them on its next poll.");
        return Task.CompletedTask;
    }

    public Task DeleteUserAsync(string enrollNo)
    {
        AdmsServer.Enqueue(Sn, $"DATA DELETE USERINFO PIN={enrollNo}");
        return Task.CompletedTask;
    }

    public Task StartEnrollAsync(string enrollNo, int fingerIndex)
    {
        AdmsServer.Enqueue(Sn, $"ENROLL_FP PIN={enrollNo}\tFID={fingerIndex}\tRETRY=3\tOVERWRITE=1");
        return Task.CompletedTask;
    }

    public Task ClearLogsAsync()
    {
        AdmsServer.Enqueue(Sn, "CLEAR LOG");
        return Task.CompletedTask;
    }

    public Task RestartAsync()
    {
        AdmsServer.Enqueue(Sn, "REBOOT");
        return Task.CompletedTask;
    }

    /// <summary>Waits until the device has answered and gone quiet (or timeout), since answers arrive over several posts.</summary>
    private static async Task WaitForData(Func<int> count, int maxSeconds = 90)
    {
        int last = 0, quiet = 0;
        for (int s = 0; s < maxSeconds; s++)
        {
            await Task.Delay(1000);
            int now = count();
            if (now > 0 && now == last) { if (++quiet >= 6) return; }
            else quiet = 0;
            last = now;
            if (now == 0 && s >= 30) return; // device never answered
        }
    }

    public void Dispose() => _profile = null;
}
