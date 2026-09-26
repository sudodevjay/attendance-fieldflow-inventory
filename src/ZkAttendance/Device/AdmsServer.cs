using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace ZkAttendance.Device;

/// <summary>State of one device that talks to us over ADMS (ZKTeco push / "iclock" protocol).</summary>
public class AdmsDeviceState
{
    public string SerialNumber { get; init; } = "";
    public string RemoteIp { get; set; } = "";
    public DateTime LastSeen { get; set; }
    public string Firmware { get; set; } = "";
    public int UserCount { get; set; }
    public int FpCount { get; set; }
    public int LogCount { get; set; }
    public int FaceCount { get; set; }
    public string PushVersion { get; set; } = "";
    public ConcurrentQueue<string> Commands { get; } = new();
    public bool Online => (DateTime.Now - LastSeen).TotalSeconds < 90;
}

/// <summary>
/// Minimal HTTP server for the ZKTeco ADMS push protocol (/iclock/cdata, /iclock/getrequest, /iclock/devicecmd).
/// Devices are configured with this PC's IP and port (device menu: Comm → Cloud Server Setting / ADMS).
/// Punches are pushed in real time; commands (upload user, delete, reboot ...) are queued and fetched by the device.
/// A raw TcpListener is used so no URL ACL / admin rights are needed (Windows Firewall must allow the port).
/// </summary>
public static class AdmsServer
{
    private static TcpListener? _listener;
    private static CancellationTokenSource? _cts;
    private static int _commandId;
    private static readonly ConcurrentDictionary<string, AdmsDeviceState> Devices = new(StringComparer.OrdinalIgnoreCase);

    public static int Port { get; private set; }
    public static bool Running => _listener != null;

    /// <summary>A device contacted the server (first contact or info update).</summary>
    public static event Action<AdmsDeviceState>? DeviceSeen;
    /// <summary>Attendance punches pushed by a device (real time or in answer to a query).</summary>
    public static event Action<string, List<DevicePunch>>? PunchesReceived;
    /// <summary>User / fingerprint records pushed by a device.</summary>
    public static event Action<string, List<DeviceUser>>? UsersReceived;
    public static event Action<string, string>? Log;

    public static AdmsDeviceState? Get(string? sn) => sn != null && Devices.TryGetValue(sn, out var d) ? d : null;
    public static bool IsOnline(string? sn) => Get(sn)?.Online == true;

    public static void Start(int port)
    {
        if (Running && Port == port) return;
        Stop();
        _listener = new TcpListener(IPAddress.Any, port);
        _listener.Start();
        Port = port;
        _cts = new CancellationTokenSource();
        _ = AcceptLoop(_listener, _cts.Token);
    }

    public static void Stop()
    {
        _cts?.Cancel();
        try { _listener?.Stop(); } catch { }
        _listener = null;
    }

    /// <summary>Queues a command for the device; returns the command id.</summary>
    public static int Enqueue(string sn, string command)
    {
        var d = Devices.GetOrAdd(sn, s => new AdmsDeviceState { SerialNumber = s });
        int id = Interlocked.Increment(ref _commandId);
        d.Commands.Enqueue($"C:{id}:{command}");
        return id;
    }

    // ------------------------------------------------------------------ HTTP

    private static async Task AcceptLoop(TcpListener listener, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            TcpClient client;
            try { client = await listener.AcceptTcpClientAsync(ct); }
            catch { break; }
            _ = Task.Run(() => Handle(client), ct);
        }
    }

    private static async Task Handle(TcpClient client)
    {
        using (client)
        {
            try
            {
                client.ReceiveTimeout = client.SendTimeout = 15000;
                var stream = client.GetStream();
                var (method, target, body) = await ReadRequest(stream);
                if (method == null) return;
                var ip = (client.Client.RemoteEndPoint as IPEndPoint)?.Address.ToString() ?? "";
                string reply = Process(method, target!, body, ip);
                var bytes = Encoding.UTF8.GetBytes(reply);
                var header = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n" +
                             $"Date: {DateTime.UtcNow.ToString("r", CultureInfo.InvariantCulture)}\r\n" +
                             $"Content-Length: {bytes.Length}\r\nConnection: close\r\n\r\n";
                await stream.WriteAsync(Encoding.ASCII.GetBytes(header));
                await stream.WriteAsync(bytes);
            }
            catch (Exception ex) { Log?.Invoke("", "ADMS error: " + ex.Message); }
        }
    }

    private static async Task<(string? method, string? target, string body)> ReadRequest(NetworkStream s)
    {
        var buffer = new MemoryStream();
        var chunk = new byte[8192];
        int headerEnd = -1;
        while (headerEnd < 0)
        {
            int n = await s.ReadAsync(chunk);
            if (n == 0) return (null, null, "");
            buffer.Write(chunk, 0, n);
            headerEnd = IndexOf(buffer.GetBuffer(), (int)buffer.Length, "\r\n\r\n"u8);
            if (buffer.Length > 1_000_000) return (null, null, "");
        }
        var headerText = Encoding.ASCII.GetString(buffer.GetBuffer(), 0, headerEnd);
        var lines = headerText.Split("\r\n");
        var parts = lines[0].Split(' ');
        if (parts.Length < 2) return (null, null, "");
        int length = 0;
        foreach (var l in lines.Skip(1))
            if (l.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase)) int.TryParse(l[15..].Trim(), out length);

        int bodyStart = headerEnd + 4;
        while (buffer.Length - bodyStart < length)
        {
            int n = await s.ReadAsync(chunk);
            if (n == 0) break;
            buffer.Write(chunk, 0, n);
        }
        var body = Encoding.UTF8.GetString(buffer.GetBuffer(), bodyStart, (int)Math.Max(0, Math.Min(length, buffer.Length - bodyStart)));
        return (parts[0], parts[1], body);
    }

    private static int IndexOf(byte[] data, int length, ReadOnlySpan<byte> pattern) =>
        data.AsSpan(0, length).IndexOf(pattern);

    // ------------------------------------------------------------------ protocol

    private static string Process(string method, string target, string body, string ip)
    {
        var qIndex = target.IndexOf('?');
        var path = (qIndex >= 0 ? target[..qIndex] : target).ToLowerInvariant();
        var query = ParseQuery(qIndex >= 0 ? target[(qIndex + 1)..] : "");
        var sn = query.GetValueOrDefault("SN", "");
        if (sn.Length == 0) return "OK";

        bool isNew = !Devices.ContainsKey(sn);
        var dev = Devices.GetOrAdd(sn, s => new AdmsDeviceState { SerialNumber = s });
        dev.LastSeen = DateTime.Now;
        dev.RemoteIp = ip;
        if (query.TryGetValue("pushver", out var pv)) dev.PushVersion = pv;
        if (query.TryGetValue("INFO", out var info)) ParseInfo(dev, info);
        if (isNew) Log?.Invoke(sn, $"ADMS device connected from {ip}");
        if (isNew || query.ContainsKey("INFO") || query.ContainsKey("options")) DeviceSeen?.Invoke(dev);

        if (path.EndsWith("/cdata"))
        {
            if (method == "GET") return Options(sn);
            var table = query.GetValueOrDefault("table", "").ToUpperInvariant();
            var lines = body.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            switch (table)
            {
                case "ATTLOG":
                    var punches = lines.Select(ParseAttLog).OfType<DevicePunch>().ToList();
                    if (punches.Count > 0) PunchesReceived?.Invoke(sn, punches);
                    return $"OK: {lines.Length}";
                case "OPERLOG":
                case "USERINFO":
                case "FINGERTMP":
                case "BIODATA":
                    var users = ParseUsers(lines);
                    if (users.Count > 0) UsersReceived?.Invoke(sn, users);
                    return $"OK: {lines.Length}";
                default:
                    return $"OK: {lines.Length}";
            }
        }
        if (path.EndsWith("/getrequest"))
        {
            var sb = new StringBuilder();
            while (sb.Length < 60000 && dev.Commands.TryDequeue(out var cmd)) sb.Append(cmd).Append('\n');
            return sb.Length > 0 ? sb.ToString() : "OK";
        }
        if (path.EndsWith("/devicecmd"))
        {
            foreach (var line in body.Split('\n', StringSplitOptions.RemoveEmptyEntries))
            {
                var r = ParseQuery(line.Trim());
                if (r.TryGetValue("Return", out var ret) && ret != "0")
                    Log?.Invoke(sn, $"Command {r.GetValueOrDefault("ID")} ({r.GetValueOrDefault("CMD")}) returned {ret}");
            }
            return "OK";
        }
        return "OK";
    }

    /// <summary>Reply to the device's first request: tells it which data to push and how often to poll.</summary>
    private static string Options(string sn) =>
        $"GET OPTION FROM: {sn}\n" +
        "ATTLOGStamp=None\nOPERLOGStamp=9999\nATTPHOTOStamp=None\n" +
        "ErrorDelay=30\nDelay=10\nTransTimes=00:00;14:05\nTransInterval=1\n" +
        "TransFlag=TransData AttLog\tOpLog\tEnrollUser\tChgUser\tEnrollFP\tChgFP\n" +
        "Realtime=1\nEncrypt=None\n";

    private static void ParseInfo(AdmsDeviceState d, string info)
    {
        // INFO=firmware,users,fingerprints,attlogs,ip,fpVersion,faceVersion,faceTemplates,faces,...
        var p = info.Split(',');
        if (p.Length > 0) d.Firmware = p[0];
        if (p.Length > 1 && int.TryParse(p[1], out var u)) d.UserCount = u;
        if (p.Length > 2 && int.TryParse(p[2], out var f)) d.FpCount = f;
        if (p.Length > 3 && int.TryParse(p[3], out var a)) d.LogCount = a;
        if (p.Length > 8 && int.TryParse(p[8], out var fc)) d.FaceCount = fc;
    }

    private static DevicePunch? ParseAttLog(string line)
    {
        // PIN \t yyyy-MM-dd HH:mm:ss \t Status \t Verify \t WorkCode ...
        var f = line.Split('\t');
        if (f.Length < 2 || !DateTime.TryParseExact(f[1].Trim(), "yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t))
            return null;
        int I(int i) => f.Length > i && int.TryParse(f[i], out var v) ? v : 0;
        return new DevicePunch(f[0].Trim(), t, I(3), I(2), I(4));
    }

    private static List<DeviceUser> ParseUsers(string[] lines)
    {
        var users = new Dictionary<string, DeviceUser>();
        DeviceUser U(string pin) => users.TryGetValue(pin, out var u) ? u : users[pin] = new DeviceUser { EnrollNo = pin };
        foreach (var line in lines)
        {
            int sp = line.IndexOf(' ');
            if (sp < 0) continue;
            var kind = line[..sp].ToUpperInvariant();
            var kv = line[(sp + 1)..].Split('\t').Select(x => x.Split('=', 2)).Where(x => x.Length == 2)
                        .GroupBy(x => x[0].Trim(), StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First()[1], StringComparer.OrdinalIgnoreCase);
            if (!kv.TryGetValue("PIN", out var pin) || pin.Length == 0) continue;
            if (kind == "USER")
            {
                var u = U(pin);
                u.Name = kv.GetValueOrDefault("Name", "");
                u.Password = kv.GetValueOrDefault("Passwd", "");
                u.CardNo = kv.GetValueOrDefault("Card", "");
                u.Privilege = int.TryParse(kv.GetValueOrDefault("Pri"), out var pri) ? pri : 0;
            }
            else if (kind is "FP" or "FINGERTMP" && kv.TryGetValue("TMP", out var tmp) && tmp.Length > 0)
            {
                int fid = int.TryParse(kv.GetValueOrDefault("FID"), out var x) ? x : 0;
                U(pin).Fingers.Add(new DeviceFinger(fid, 1, tmp));
            }
        }
        return users.Values.ToList();
    }

    private static Dictionary<string, string> ParseQuery(string q)
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in q.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var kv = part.Split('=', 2);
            d[WebUtility.UrlDecode(kv[0])] = kv.Length > 1 ? WebUtility.UrlDecode(kv[1]) : "";
        }
        return d;
    }
}
