# ZK Attendance Manager (ZKTeco LX50)

.NET 8 WinForms + SQL Server attendance software for the ZKTeco LX50 fingerprint device.

## Screens (classic ZKTime 5.0 / "Attendance Management Program" layout)

**Main window**: menu (Data, Attendance, Search/Print, Maintenance/Options, Device management, Help), toolbar
(Employees, AC Log, Report, Device ▾, Del Device, Connect, Disconnect, Exit system), left blue panel, **Machine List**
(multiple devices: USB / Serial / Ethernet with UserCount, Fp Count, Log Count, Serial Number), downloaded records grid
and the connection log (`[3] Connecting with device.please wait...`, `Succeed` / `failed`).

| Left panel | Kya karta hai |
|---|---|
| Data Maintenance | Import (pendrive `1_attlog.dat` / `GLG_001.TXT`), Export (AC Log → Excel), Backup Database, Usb Disk Manage |
| Machine | Download attendance logs, Download user info and Fp, Upload user info and FP (Photo / AC Manage LX50 me nahi hain) |
| Maintenance/Options | Department List (tree + sub-departments, drag & drop), Administrator (login password), Employees, Database Option |
| Employee Schedule | Maintenance Timetables / Shifts (timing, grace, half day, OT, weekly off), Employee Schedule (bulk shift assign), Attendance Rule |

**Employee List window**: department tree + "include sub department", grid (AC No, No., Name, Gender, Title, Mobile),
tabs Basic Information / Addition / AC Options, Photo, Fingerprint manage (Connect Device, Enroll), Upload / Download /
Del(Device), Excel Import / Export.

**Reports** (Search/Print or toolbar Report): Daily, Register, Monthly Muster Roll, Monthly Summary (paid days), Late,
Early, Overtime, Absent, Punch Log — Excel + PDF. **Leave / Holidays** under Attendance menu.

Right-click a device in the Machine List for: Connect, Disconnect, Download, Upload, Device Information, Synchronize
Time, Clear Attendance Logs, Restart, Edit / Delete.

## Supported devices (hardware independent)

The program talks to devices only through the `IAttendanceDevice` interface (`Device/IAttendanceDevice.cs`).
Each connection type is a driver:

| Comm type | Driver | Devices |
|---|---|---|
| USB | ZKTeco SDK (zkemkeeper) | LX50 and other USB-client models |
| Serial Port/RS485 | ZKTeco SDK | Older / RS485 models, USB virtual COM |
| Ethernet (TCP/IP 4370) | ZKTeco SDK | K-series, iClock, F18, MB/iFace, eSSL and other OEM rebrands; B&W and TFT firmware |
| ADMS (Push / Cloud) | Built-in ADMS server | Newer ZKTeco push devices: they send punches live to this PC (default port 8081) |
| Pendrive file | File importer | Any brand that exports `attlog.dat` / `GLG_001.TXT` / CSV with user id + date-time |

Each driver declares which features it supports (download logs, users, fingerprints, upload, delete, time sync,
clear logs, restart, remote enroll, live push); unsupported actions show a clear message instead of failing.
Another brand's SDK can be added by writing a new class that implements `IAttendanceDevice` and adding it in `DeviceDrivers.Create`.

Note: fingerprint templates copy only between devices using the same fingerprint algorithm (e.g. ZKFinger 10 ↔ 10).

### ADMS setup
1. Database Option → **ADMS Server** ON → port (8081) → Save. The message shows this PC's IP.
2. Windows Firewall: allow inbound TCP on that port.
3. Device menu → Comm → **Cloud Server Setting**: Server Address = PC IP, Port = 8081 (Domain/Proxy off).
4. Within a few seconds the device appears in the Machine List as `ADMS <serial>` with status **Online**; punches then arrive
   in real time in the records grid.

## Requirements

1. Windows 10/11, [.NET 8 Desktop Runtime **x86**](https://dotnet.microsoft.com/download/dotnet/8.0) (dev PC par SDK already hai)
2. SQL Server / SQL Express (default: `.\SQLEXPRESS`, database `ZkAttendance` pehli baar chalane par apne aap ban jata hai)
3. **ZKTeco Standalone SDK (zkemkeeper.dll)** — device se baat karne ke liye zaroori

### ZKTeco SDK install (ek baar)

1. ZKTeco website / dealer se **"Standalone SDK"** (ZKemkeeper, 32-bit) download karein.
2. Zip extract karein, `SDK` folder me **`Register_SDK.bat` ko Right-click → Run as administrator** karein.
   Manual tareeka: saari DLLs `C:\Windows\SysWOW64\` me copy karke (Admin CMD):
   ```
   regsvr32 C:\Windows\SysWOW64\zkemkeeper.dll
   ```
3. App x86 (32-bit) build hota hai kyunki zkemkeeper 32-bit COM hai — isse change na karein.

SDK na ho tab bhi baaki sab (employees, reports, pendrive import) chalta hai; sirf direct device commands kaam nahi karenge.

## LX50 connect karna

1. Device ko Mini-USB (USB Client) cable se PC se jodein.
2. Main window → Machine List me device **3 (USB)** chunein (ya toolbar **Device** se naya add karein: Comm type = USB, Machine No. = 1, Comm Key = 0) → toolbar **Connect**.
3. Agar USB se connect na ho: Device Manager me dekhein ki cable lagane par koi **COM port** bana hai kya (ZKTeco USB driver / CP210x / CH340). Bana hai to device edit karke Comm type = *Serial Port/RS485*, woh COM port aur baud rate (device menu → Comm → Baudrate, aam taur par 115200) daalein.
4. Connect hone par Machine List me Status = Connected, ProductName, UserCount, Serial Number dikhenge aur log me `Succeed in connecting with device` aayega.

> Note: Maine yeh code aapke device par test nahi kiya hai (yahan device nahi hai). Firmware ke hisab se kuch SDK calls alag behave kar sakti hain; code SSR (new) aur legacy (old B&W) dono APIs try karta hai. Error aaye to Device page ka log / error code bhejein.

### Backup plan: Pendrive

Device menu → **USB Mgmt / PenDrive Mgmt → Download AttLog** → pendrive PC par lagayein →
Main window → **Data Maintenance → Import Attendance Checking Data** → `1_attlog.dat` ya `GLG_001.TXT` chunein. Duplicates apne aap skip hote hain.

## Roz ka workflow

1. Device select → **Connect** → Machine → **Download attendance logs** (ya Database Option me auto-download ON karein)
2. Naye AC No. "User 5" jaise naam se aate hain → **Employees** window me naam, department, shift bharein
   (ya **Download user info and Fp** se device ke naam le lein)
3. **Report** → report chunein → **Generate** → **Excel / PDF**

## Attendance rules

- Attendance Rule: punch window (default shift se 4 ghante pehle), repeat punch ignore (default 1 minute), sirf ek punch = Present / Half Day / Absent.
- Shift window: shift start se 4 ghante pehle se agle 24 ghante tak ke punches us din ke maane jaate hain (night shift support).
- **Pehla punch = IN, aakhri punch = OUT** (LX50 par staff aksar In/Out key nahi dabate, isliye state par depend nahi karte).
- Late = IN > shift start + late grace (poore late minutes dikhaye jaate hain).
- Early = OUT < shift end − early grace.
- Half day = worked minutes < "Half day if worked <".
- OT = worked − shift duration, agar ≥ "OT counted after". Holiday / weekly off par poora kaam OT.
- Status codes: `P` Present, `A` Absent, `HD` Half Day, `H` Holiday, `WO` Weekly Off, leave code (`CL`, `SL`...), `½CL` half-day leave.
- Paid Days = Present + Paid Leave + Holidays + Weekly Offs.

## Build / run

```
cd D:\attendance
dotnet build
dotnet run --project src\ZkAttendance
```
Ya `ZkAttendance.sln` Visual Studio 2022 me kholein.

Release folder banane ke liye:
```
dotnet publish src\ZkAttendance -c Release -o publish
```
`publish` folder client PC par copy karein (wahan .NET 8 Desktop Runtime x86 + ZKTeco SDK + SQL Express chahiye). `appsettings.json` me connection string badal sakte hain.

## Project structure

```
src/ZkAttendance/
  Data/        Entities + EF Core DbContext (SQL Server, auto-create + seed)
  Device/      ZkDevice (zkemkeeper wrapper on a dedicated STA thread), pendrive file parser
  Services/    SyncService (device ↔ DB), AttendanceProcessor (shift rules), ReportService, Excel/PDF exporters
  UI/          MainForm (sidebar), PageBase, FormDialog builder, Pages/*
```

Libraries: EF Core SqlServer 8, ClosedXML (Excel), QuestPDF (PDF — Community license, free for businesses under USD 1M annual revenue).
