# Records the USB traffic between the ZKTeco SDK and the LX50 while sdk-driver runs read-only commands.
# Run as administrator (USBPcap needs it). The attendance software must be CLOSED (only one program can use the device).
#   powershell -ExecutionPolicy Bypass -File D:\attendance\pi\capture.ps1
# Afterwards:  python D:\attendance\pi\analyze\usbpcap_dump.py <the capture folder printed at the end>
$ErrorActionPreference = 'Stop'
$usbpcap = 'C:\Program Files\USBPcap\USBPcapCMD.exe'
$driver = 'D:\attendance\pi\sdk-driver\bin\sdk-driver.exe'

if (Get-Process ZkAttendance -ErrorAction SilentlyContinue) { throw 'Attendance software is running. Close it first (the device can be used by one program at a time).' }
$lx50 = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object InstanceId -like 'USB\VID_1B55&PID_0A01*'
if (-not $lx50) { throw 'LX50 not connected (USB\VID_1B55&PID_0A01 not present). Check the mini-USB cable and the DC power, then run again.' }

# Only the USBPcap hubs that exist on this PC (this PC has USBPcap1 and USBPcap2)
$hubs = & $usbpcap --extcap-interfaces | ForEach-Object { if ($_ -match 'value=(\\\\\.\\USBPcap\d+)') { $Matches[1] } }
if (-not $hubs) { throw 'USBPcap lists no hubs. Is USBPcap installed and the PC restarted after installing it?' }

$dir = "D:\attendance\pi\captures\{0:yyyyMMdd_HHmmss}" -f (Get-Date)
New-Item -ItemType Directory -Force $dir | Out-Null

# One capture per root hub; the LX50 is on one of them. -A = all devices on that hub, descriptors included.
$procs = @()
foreach ($h in $hubs) {
    $name = $h.Substring($h.LastIndexOf('\') + 1)
    $procs += Start-Process $usbpcap -ArgumentList "-d $h -o `"$dir\$name.pcap`" -A" -PassThru -WindowStyle Hidden
}
Start-Sleep -Seconds 3

& $driver "$dir\markers.txt"
$code = $LASTEXITCODE
Start-Sleep -Seconds 2

$procs | Where-Object { -not $_.HasExited } | Stop-Process -Force
Start-Sleep -Seconds 1
Get-ChildItem $dir -Filter *.pcap | Where-Object Length -le 24 | Remove-Item  # header only = nothing recorded
"sdk-driver exit code: $code"
Get-ChildItem $dir | Select-Object Name, Length | Format-Table -AutoSize | Out-String
"Saved in $dir"
"Analyse:  python D:\attendance\pi\analyze\usbpcap_dump.py $dir"
