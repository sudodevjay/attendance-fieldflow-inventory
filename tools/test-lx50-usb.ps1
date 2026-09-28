# LX50 mini-USB communication test (ZKTeco SDK / zkemkeeper).
# Run with 32-bit PowerShell because zkemkeeper is a 32-bit COM server:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ExecutionPolicy Bypass -File D:\attendance\tools\test-lx50-usb.ps1
param([int]$Machine = 1, [int]$CommKey = 0)

if ([Environment]::Is64BitProcess) { Write-Host "32-bit PowerShell (SysWOW64) se chalayein." -ForegroundColor Red; exit 1 }

try { $zk = New-Object -ComObject zkemkeeper.ZKEM } catch {
    try { $zk = New-Object -ComObject zkemkeeper.CZKEM } catch {
        Write-Host "zkemkeeper SDK registered nahi hai." -ForegroundColor Red; exit 1 }
}

function LastError { $c = 0; [void]$zk.GetLastError([ref]$c); $c }

if ($CommKey -ne 0) { [void]$zk.SetCommPassword($CommKey) }
Write-Host "Connecting via USB (Machine No. $Machine)..."
if (-not $zk.Connect_USB($Machine)) { Write-Host "Connect_USB failed. Error: $(LastError)" -ForegroundColor Red; exit 1 }
Write-Host "Connected." -ForegroundColor Green

$sn = ""; [void]$zk.GetSerialNumber($Machine, [ref]$sn)
$fw = ""; [void]$zk.GetFirmwareVersion($Machine, [ref]$fw)
$users = 0; [void]$zk.GetDeviceStatus($Machine, 2, [ref]$users)
$logs = 0; [void]$zk.GetDeviceStatus($Machine, 6, [ref]$logs)
Write-Host "Serial: $sn  Firmware: $fw  Users: $users  Logs: $logs"

[void]$zk.EnableDevice($Machine, $false)
[void]$zk.ReadAllUserID($Machine)
$id = ""; $name = ""; $pwd = ""; $priv = 0; $en = $false; $n = 0
while ($zk.SSR_GetAllUserInfo($Machine, [ref]$id, [ref]$name, [ref]$pwd, [ref]$priv, [ref]$en)) {
    $n++; Write-Host ("User  ID={0}  Name={1}  Privilege={2}  Enabled={3}" -f $id, ($name -split "`0")[0], $priv, $en)
}
if ($n -eq 0) {
    [void]$zk.ReadAllUserID($Machine)
    $iid = 0
    while ($zk.GetAllUserInfo($Machine, [ref]$iid, [ref]$name, [ref]$pwd, [ref]$priv, [ref]$en)) {
        $n++; Write-Host ("User  ID={0}  Name={1}  Privilege={2}  (legacy API)" -f $iid, ($name -split "`0")[0], $priv)
    }
}
[void]$zk.EnableDevice($Machine, $true)
Write-Host "$n user(s) read."
$zk.Disconnect()
