# ZK Attendance Manager (ZKTeco LX50)

.NET 8 WinForms + SQL Server attendance software for the ZKTeco LX50 fingerprint device.

## Live deployment (cloud) — sab details yahan

Web version internet par free chalta hai. **Passwords / tokens / keys is file mein NAHI hain** (repo public hai): wo
sirf PC par `D:\attendance\CREDENTIALS.local.md` mein hain (`.gitignore` me, kabhi push nahi hoti). Us file ki ek copy
Google Drive / pendrive par bhi rakhein.

```
 Office Wi-Fi                              Internet
 LX50 ─ USB hub ─ Raspberry Pi ──https──► Render (React app + API) ──► Supabase PostgreSQL
                      ▲                         ▲
   Tailscale (SSH kahin se bhi)       Browser / mobile app (kahin se bhi)
```

| Kya | Detail |
|---|---|
| **App (admin)** | https://zk-attendance.onrender.com — login: koi bhi user name + admin password |
| **Employee portal** | https://zk-attendance.onrender.com/me (AC No + password) |
| **Mobile app** | Server address: `https://zk-attendance.onrender.com` (`https://` zaroor likhein) |
| **Code** | GitHub `sudodevjay/attendancecontroller`, branch **`render-postgres`** (push = Render apne aap deploy karta hai) |
| **Render** (hosting, free) | https://dashboard.render.com → service **zk-attendance** (`srv-dau99mek1f9s73at5u9g`), region Singapore, root `web/`, build `npm run install:all && npm run build`, start `npm start`, health check `/api/auth/status` |
| Render env vars | `DATABASE_URL` (Supabase URI), `ADMIN_PASSWORD` (pehla admin password, sirf jab koi password set na ho), `TZ=Asia/Kolkata`, `NODE_VERSION=22` |
| **Supabase** (database, free) | https://supabase.com/dashboard/project/jvwliosayqsnfbgvefnu — PostgreSQL 17, region Southeast Asia (Singapore) |
| Database connection | **Session pooler**: host `aws-0-ap-southeast-1.pooler.supabase.com`, port `5432`, database `postgres`, user `postgres.jvwliosayqsnfbgvefnu` → `postgresql://postgres.jvwliosayqsnfbgvefnu:<PASSWORD>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres` ("Direct connection" Render par nahi chalta: IPv6) |
| **Raspberry Pi** | Raspberry Pi 4, Debian 13, user `housys`, hostname `housys` (`housys.local` same Wi-Fi par) |
| Pi remote access | **Tailscale**: naam `housys-pi`, IP `100.107.8.31` → `ssh housys@housys-pi` (laptop / phone par Tailscale on, same account) |
| Pi service | `lx50pi` (systemd, boot par chalu). Config `/etc/lx50pi/config.ini` (purani copy `config.ini.bak-*`), local punches `/var/lib/lx50pi/lx50.db` |
| Pi → cloud | `[cloud]` me `url / users_url / commands_url = https://zk-attendance.onrender.com/api/lx50/{punches,users,commands}`, `token = <Pi token>`, `verify_tls = yes` |
| LX50 | Pi → **USB 2.0 hub** → LX50 (LX50 apne DC power par; hub ke bina USB se gir jata hai). Serial `NPT6262703374` |
| Windows program | apna SQL Server database (`.\SQLEXPRESS`, `ZkAttendance`) — cloud use nahi karta, na badalta hai. Data ek baar copy kiya gaya (2026-09-30) |

### Roz ke / kabhi-kabhi ke kaam

| Kaam | Kaise |
|---|---|
| Pi me login (kahin se bhi) | `ssh housys@housys-pi` (na chale to `ssh housys@100.107.8.31`) |
| Pi ke logs | `journalctl -u lx50pi -f` (live) / `journalctl -u lx50pi -n 50` |
| Pi service restart | `sudo systemctl restart lx50pi` |
| Pi device check | `sudo systemctl stop lx50pi` → `sudo -u lx50pi /opt/lx50pi/venv/bin/python -m lx50pi -c /etc/lx50pi/config.ini info` → `sudo systemctl start lx50pi` (program `/opt/lx50pi`) |
| Naya Wi-Fi (office) jodna | `sudo nmcli dev wifi connect "<naam>" password "<password>"` — save ho jata hai, apne aap judta hai. Saved list: `nmcli con show` |
| Pi ka internet check | `curl -I https://zk-attendance.onrender.com` |
| Code change deploy | `git push` (branch `render-postgres`) → Render ~3–5 min me deploy. Status / logs: Render dashboard → zk-attendance → Events / Logs |
| Manual redeploy | Render dashboard → zk-attendance → **Manual Deploy → Deploy latest commit** |
| Env var badalna | Render → zk-attendance → **Environment** → edit → Save (service restart hoti hai) |
| Admin password badalna | App me **Maintenance/Options → Administrator** (`ADMIN_PASSWORD` sirf pehli baar kaam aata hai) |
| Database password badalna | Supabase → Project Settings → Database → **Reset database password** → phir Render me `DATABASE_URL` update karein |
| Pi token badalna | App → **Database Option → Raspberry Pi → New token** → Pi ki `config.ini` me `token =` badlein → `sudo systemctl restart lx50pi` |
| Backup (hafte me ek baar) | App → **Database Option → Backup Database** → JSON file download (Supabase free me backup download nahi hota) |
| Backup wapas daalna | `cd web/server`, `set DATABASE_URL=<URI>`, `npx tsx scripts/restore-backup.ts <file.json> --yes` |
| SQL Server data dobara copy | `cd web/server`, `set DATABASE_URL=<URI>`, `npx tsx scripts/copy-from-sqlserver.ts --yes` (cloud ka data **replace** hota hai; SQL Server sirf padha jata hai) |
| Tailscale key expiry band | https://login.tailscale.com/admin/machines → housys-pi → ⋯ → **Disable key expiry** (warna ~6 mahine baad Pi hat jata hai) |
| Pi Tailscale se hat gaya | Pi par (same Wi-Fi / screen se): `sudo tailscale up --hostname=housys-pi --ssh` → link kholein; ya admin → Settings → Keys → auth key → `sudo tailscale up --auth-key=<key> --hostname=housys-pi --ssh` |

### Jab kuch na chale

| Problem | Dekhein |
|---|---|
| App pehli baar bahut dheere khulti hai | Render free 15 min bina request ke so jata hai; Pi har 15 s call karta hai to jaagta rehta hai. Pi band = pehli request ~1 min |
| Machine List me Pi **Offline** | Pi on hai? Wi-Fi? `ssh housys@housys-pi` → `journalctl -u lx50pi -n 30` ("cannot reach server" = internet; "USB device not found" = LX50 / hub / power) |
| "wrong token" Pi ke log me | App → Database Option → Raspberry Pi ka token aur Pi ki `config.ini` ka token same karein |
| App "Could not start" / 500 errors | Render → Logs. Supabase project **paused**? (7 din bina activity) → Supabase dashboard → **Restore project** |
| Database bhar gaya | Supabase free = 500 MB (photos / documents sabse zyada jagah lete hain). Dashboard → Database → usage |
| Login bhool gaye | Supabase → SQL Editor: `DELETE FROM appsettings WHERE key = 'AdminPasswordHash';` → Render me `ADMIN_PASSWORD` set karke Manual Deploy (ab naya password lagega) |

Poori deploy guide (shuru se): [web/DEPLOY.md](web/DEPLOY.md). Pi ka protocol / setup: [pi/README.md](pi/README.md).

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

LX50 ke ports: **DC pin** = power, **bada USB (Type-A)** = pendrive, **mini/micro USB** = PC se connection (USB Client).

**USB driver (ek baar, har PC par):** LX50 PC par `USB\VID_1B55&PID_0A01` ke roop me dikhta hai aur SDK ki `usbstd.dll`
ise **libusb-win32 (libusb0)** se kholti hai. Device Manager me yellow ! (code 28) ho to:
[Zadig](https://zadig.akeo.ie/) chalayein → Options → *List All Devices* → USB ID `1B55 0A01` wala device chunein →
driver **libusb-win32** (WinUSB / libusbK nahi) → *Install Driver* → cable dobara lagayein. Device Manager me
*libusb-win32 devices* ke neeche OK dikhega. (ZKTime 5.0 ke `USBDriver\X20\ZKFP.inf` ki catalog hash mismatch deti hai, use install na karein.)
SDK: ZKTime 5.0 / Standalone SDK ka `zkemkeeper` 6.2.5.7 (usbstd.dll ke saath) `SysWOW64` me copy karke `SysWOW64\regsvr32` se register karein.

Tested: LX50, firmware Ver 6.60 May 19 2023, platform AK3750WIFI_TFT, ZKFinger v13: connect, info, logs, users, fingerprint download OK.

1. Device ko DC adapter se ON karein aur mini/micro USB **data cable** se PC se jodein.
2. Main window → Machine List me device **3 (USB)** chunein (ya toolbar **Device** se naya add karein: Comm type = USB,
   Machine No. = device menu → Comm → Device ID (default 1), Comm Key = device ka Comm Key (default 0)) → toolbar **Connect**.
3. **Auto detect**: USB se connect na ho to software khud try karta hai: USB (Machine No. aapka / 1), phir PC ke har
   COM port par baud 115200 / 38400 / 57600 / 19200 / 9600. Log me `Trying COM5 @ 115200...` dikhega. Device mil gaya to
   woh settings (jaise Serial Port/RS485, COM5, 115200) apne aap save ho jaati hain, agli baar seedha connect hoga.
4. Kuch na mile to error me COM ports ki list aur checklist aati hai. Device Manager me cable nikaal ke dobara lagayein:
   *Ports (COM & LPT)* me naya port ya *ZKTeco USB* device aana chahiye; yellow ! ho to driver (ZKTeco USB Client / CP210x / CH340) install karein.
5. Connect hone par Machine List me Status = Connected, ProductName, UserCount, Serial Number dikhenge aur log me `Succeed in connecting with device` aayega.
6. Cable hil jaaye ya device sleep ho jaaye to agla command (Download etc.) ek baar apne aap reconnect karke dobara chalta hai.

**LX50 (FW 6.60, ZKFinger v13) ki seema (device par test kiya):**
- *Remote enroll* nahi hota (`StartEnrollEx` / `StartEnroll` dono false). Finger device par enroll karein:
  Menu → User Mgt → AC No → Fingerprint → 3 baar; phir auto-sync / *Download user info and Fp* se software me aa jaata hai.
- Fingerprint template *upload* nahi hota (SDK 6.2.5.7 har v13 template par error -3 deta hai); naam, password, privilege,
  card upload aur user delete theek chalte hain. Software ab batata hai kitne fingerprint reject hue.
- Legacy integer API `GetUserTmpStr` is firmware par hang hoti hai, isliye sirf B&W firmware par try hoti hai.

Mini-USB se ye sab hota hai: Download attendance logs, Download user info and Fp, Upload user info and FP, Delete user,
Synchronize Time, Device Information, Clear Attendance Logs, Restart. Fingerprint ke liye naye (TmpEx / SSR) aur purane
B&W (integer ID) teeno SDK APIs try hote hain; jo chale wahi aage use hota hai.

> Note: Maine yeh code aapke device par test nahi kiya hai (yahan device nahi hai). Firmware ke hisab se kuch SDK calls alag behave kar sakti hain; code SSR (new) aur legacy (old B&W) dono APIs try karta hai. Error aaye to Device page ka log / error code bhejein.

### Backup plan: Pendrive

Device menu → **USB Mgmt / PenDrive Mgmt → Download AttLog** → pendrive PC par lagayein →
Main window → **Data Maintenance → Import Attendance Checking Data** → `1_attlog.dat` ya `GLG_001.TXT` chunein. Duplicates apne aap skip hote hain.

## Auto-sync (USB / Serial / Ethernet)

Software khula rahe to har **5 minute** (Database Option → *Auto-sync: har X minute*, 0 = band) yeh apne aap hota hai:
- Device se sirf ginti (logs / users / fingerprints) padhi jaati hai; badli ho tabhi download hota hai (keypad bina wajah lock nahi hota).
- Naye punch → database + records grid; naye users / fingerprint → Employees (software me badle naam overwrite nahi hote).
- Roz ek baar device ka time PC se sync.
- Device ki log memory 80% bharne par log me WARNING (tab *Clear Attendance Logs* karein, data pehle hi download ho chuka hota hai).
- Cable nikle / device off ho to popup nahi: log me ek line, aur har 5 minute chup-chaap dobara try. Toolbar se **Disconnect**
  karne par us device ka auto-sync ruk jaata hai; Connect karne par phir shuru.
- Download sirf padhta hai, isliye isse device ki memory nahi bharti.

## Roz ka workflow

1. Device select → **Connect** → Machine → **Download attendance logs** (ya Database Option me auto-download ON karein)
2. Naye AC No. "User 5" jaise naam se aate hain → **Employees** window me naam, department, shift bharein
   (ya **Download user info and Fp** se device ke naam le lein)
3. **Report** → report chunein → **Generate** → **Excel / PDF**

## AC Log (aaj ke punch, live)

Toolbar **AC Log** kholte hi **aaj** ke punch dikhte hain, sabse naya upar: employee ki photo, date, samay, AC No, naam,
IN / OUT (din ka pehla punch IN, baaki OUT), verify (Finger / Password / Card), source. Upar aaj ki ginti: aaye / late / nahi aaye.
Date range me aaj shamil ho aur *Live* tick ho to har **30 second** device se naye punch aate hain; screen sirf naya punch aane par
refresh hoti hai (chune hue rows nahi hat-te). **Aaj** button wapas aaj par le aata hai; purani date From / To se dekhein.

Photo: Employees → Basic Information → Photo → folder icon. Photo 300 px tak chhoti karke **base64 text** (`Employees.PhotoBase64`)
me database me save hoti hai; purane version ki binary photo pehli baar khulne par apne aap base64 me badal jaati hai.

## Salary aur leave

- **Salary**: Employees → *Addition* tab → *Monthly Salary (₹)* aur *OT Rate / Hour* (0 = salary se apne aap).
- **Salary Rule** (Attendance menu / Maintenance): kitni baar late = ½ din cut (default 3, 0 = band), OT multiplier (default 1).
- **Hisaab** (Report → *Salary Sheet (Monthly Pay)*, Excel / PDF):
  ek din = Salary ÷ mahine ke din; Payable Days = Paid Days − late cut; Salary = ek din × Payable Days;
  OT = OT ghante × rate (rate 0 ho to ek din ÷ shift ke ghante × multiplier); Net Pay = Salary + OT.
- **Salary Slip (PDF)**: Report → Month chunein (koi bhi report, "From" / "Month" picker) → employee chunein (ya *All employees*
  = har employee ka ek page) → **🧾 Salary Slip**. Slip me company, employee details, attendance, Earnings (salary + OT) /
  Deductions (absent / unpaid din, late), Net Pay aur rakam shabdon me (Indian lakh / crore) aati hai.
  Salary = Monthly Salary − unpaid din × ek din − late katauti; Salary Sheet aur Slip dono yahi hisaab use karte hain.
  Chalu mahine ki slip par chetavni aati hai ki aage ke din abhi paid nahi gine gaye.
- **Leave quota**: Leave / Holidays → *Leave Types* → Edit → *Yearly quota* (jaise CL 12). Quota khatam hone ke baad li gayi
  leave us din `LWP` (bina paise) dikhti hai aur Paid Days me nahi judti. Leave ke beech ke weekly off / holiday leave me nahi gine jaate.
- **Leave approval**: har leave ka Status *Pending / Approved / Rejected*, *Applied on* (email / request ki date),
  *Approved by*, *Decided on*. Sirf **Approved** leave attendance, salary aur quota me ginti hai; Pending wale din absent rehte hain
  (remark "leave pending") aur Salary Sheet me "PENDING: approve karein" aata hai. Leave Entries tab me Pending upar dikhti hain;
  kai select karke **✔ Approve** / **✖ Reject**, ya double-click / **✎ Edit**. Purane version me daali leave Approved maani jaati hai.
- **Leave Balance**: Leave / Holidays → *Leave Balance* tab, ya Report → *Leave Balance (Yearly)*: quota, li gayi leave
  (aage ki planned bhi), balance. Quota se zyada leave daalte waqt software pehle chetavni deta hai.

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
