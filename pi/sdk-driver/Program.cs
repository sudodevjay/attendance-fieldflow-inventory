// Drives the LX50 through the ZKTeco SDK with READ-ONLY calls while USBPcap records the USB traffic.
// Every step prints a timestamp marker, so packets in the capture can be matched to SDK calls.
// Independent of the attendance software (talks to zkemkeeper directly).
using System.Diagnostics;

var sw = Stopwatch.StartNew();
var log = new StreamWriter(args.Length > 0 ? args[0] : "markers.txt") { AutoFlush = true };
void Mark(string step) { var line = $"{DateTime.Now:HH:mm:ss.fff}  +{sw.Elapsed.TotalSeconds,7:0.000}s  {step}"; Console.WriteLine(line); log.WriteLine(line); }
void Gap() => Thread.Sleep(1500); // clear pause between steps in the capture

dynamic zk = Activator.CreateInstance(Type.GetTypeFromProgID("zkemkeeper.ZKEM")!)!;
int m = 1;
int Err() { int e = 0; zk.GetLastError(ref e); return e; }

Gap();
Mark("STEP 1 Connect_USB begin");
bool ok = zk.Connect_USB(m);
Mark($"STEP 1 Connect_USB end ok={ok} err={Err()}");
if (!ok) return 1;
Gap();

Mark("STEP 2 GetSerialNumber begin");
string sn = ""; zk.GetSerialNumber(m, ref sn);
Mark($"STEP 2 GetSerialNumber end sn={sn}");
Gap();

Mark("STEP 3 GetFirmwareVersion begin");
string fw = ""; zk.GetFirmwareVersion(m, ref fw);
Mark($"STEP 3 GetFirmwareVersion end fw={fw}");
Gap();

Mark("STEP 4 GetDeviceTime begin");
int y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0; zk.GetDeviceTime(m, ref y, ref mo, ref d, ref h, ref mi, ref s);
Mark($"STEP 4 GetDeviceTime end {y:0000}-{mo:00}-{d:00} {h:00}:{mi:00}:{s:00}");
Gap();

Mark("STEP 5 GetDeviceStatus(users=2, fp=3, logs=6) begin");
int users = 0, fps = 0, logs = 0; zk.GetDeviceStatus(m, 2, ref users); zk.GetDeviceStatus(m, 3, ref fps); zk.GetDeviceStatus(m, 6, ref logs);
Mark($"STEP 5 GetDeviceStatus end users={users} fp={fps} logs={logs}");
Gap();

Mark("STEP 6 EnableDevice(false) begin");
zk.EnableDevice(m, false);
Mark("STEP 6 EnableDevice(false) end");
Gap();
try
{
    Mark("STEP 7 ReadGeneralLogData begin");
    zk.ReadGeneralLogData(m);
    var punches = new List<string>();
    string en = ""; int v = 0, st = 0, wc = 0;
    while (zk.SSR_GetGeneralLogData(m, ref en, ref v, ref st, ref y, ref mo, ref d, ref h, ref mi, ref s, ref wc))
        punches.Add($"{en} {y:0000}-{mo:00}-{d:00} {h:00}:{mi:00}:{s:00} verify={v} state={st}");
    Mark($"STEP 7 ReadGeneralLogData end count={punches.Count}");
    foreach (var p in punches) log.WriteLine("    PUNCH " + p);
    Gap();

    Mark("STEP 8 ReadAllUserID begin");
    zk.ReadAllUserID(m);
    var list = new List<string>();
    string id = "", name = "", pwd = ""; int priv = 0; bool enabled = false;
    while (zk.SSR_GetAllUserInfo(m, ref id, ref name, ref pwd, ref priv, ref enabled))
        list.Add($"{id} '{name.Split('\0')[0]}' priv={priv} enabled={enabled} pwd={(pwd.Length > 0 ? "yes" : "no")}");
    Mark($"STEP 8 ReadAllUserID end count={list.Count}");
    foreach (var u in list) log.WriteLine("    USER " + u);
    Gap();
}
finally
{
    Mark("STEP 9 EnableDevice(true) begin");
    zk.EnableDevice(m, true);
    Mark("STEP 9 EnableDevice(true) end");
    Gap();
    Mark("STEP 10 Disconnect begin");
    zk.Disconnect();
    Mark("STEP 10 Disconnect end");
    Gap();
}
return 0;
