# ZK Attendance Manager — web version

The Windows program (`src/ZkAttendance`, .NET WinForms) rebuilt for the browser:

| Part | Tech | Folder |
|---|---|---|
| Frontend | React 19 + TypeScript + Tailwind CSS 4 (Vite) | `client/` |
| Backend | Node.js + TypeScript + Express 5 | `server/` |
| Database | **its own PostgreSQL database** (Supabase in the cloud) with the Windows program's tables plus the web tables | `server/src/config/schema.ts` |

The web version does not use or change the Windows program's SQL Server database; `server/scripts/copy-from-sqlserver.ts`
copies its data over once (read only). The Windows program's code is not changed.
**Free cloud deployment (Render + Supabase): see [DEPLOY.md](DEPLOY.md).**

## Screens
The sidebar holds everything the Windows program has in its header — the toolbar (Employees, AC Log, Report, Device,
Del Device, Connect, Disconnect, Exit system) and the menu bar (Data, Attendance, Search/Print, Maintenance/Options,
Device management, Help) — plus its left panel groups (Machine, Employee Schedule).

| Screen | What it does (same rules as the Windows program) |
|---|---|
| Machine List | devices, right-click commands, records received, connection log, Raspberry Pi command queue |
| Employee List | department tree (include sub department), grid, Basic Information / Addition / AC Options, photo, Excel import / export, Upload / Download / Del(Device) |
| AC Log | raw punches with photo, IN / OUT, live refresh every 30 s, manual punch, delete, Excel |
| Reports | Daily, Register, Muster Roll, Monthly Summary, Late, Early, Overtime, Absent, Punch Log, Salary Sheet, Leave Balance — grid, Excel, PDF; salary slip PDF |
| Department List | tree with sub-departments, add / rename / delete, drag & drop to move |
| Maintenance Timetables / Employee Schedule | shifts (night shifts, grace, half day, OT, weekly off), bulk shift assignment |
| Leave / Holidays | leave entries with approve / reject and yearly quota warning, leave balance, holidays, leave types |
| Dialogs | Attendance Rule, Salary Rule, Administrator password, Backup Database, Import (pendrive `1_attlog.dat` / `GLG_001.TXT` / CSV), Add / Edit Device, Help |
| Database Option | company, auto-sync, ADMS settings, connection string, backup, **Raspberry Pi setup** |

Attendance calculation, payroll, leave quota, report layouts, Excel / PDF and the salary slip are ported one-to-one
from `AttendanceProcessor.cs`, `ReportService.cs`, `PayrollService.cs`, `Exporters.cs` and `SalarySlipPdf.cs`.
Login uses the same Supervisor password (Administrator); no password set = no login.

## Employee portal (/me) and mobile app
Employees open **http://<server>:4000/me** (or the mobile app in `../mobile`) and log in with their **AC No** and a
password. HR creates the logins in **Employee Portal → Employee Logins** (random temporary password, or one you type;
the employee must choose their own at the first login) and ticks **Manager** for team leads.

| Employee sees | |
|---|---|
| Home | check-in / out (can be turned off in Portal Settings), attendance % / punctuality %, leaves availed / remaining, requests (late, leave, check-in), birthdays, holidays |
| Requests | leave (goes into Leave / Holidays as Pending, so the Windows program sees it too), attendance regularisation (an approved one adds the punch to the AC Log), expense claims with receipt photo, advances / loans |
| Attendance | month calendar with every day's punches |
| Payroll | own payslip PDF (same salary slip as the Reports screen), yearly report, reimbursements, financial-year summary for tax |
| Leave Management | apply leave with balance per type, holidays, leave report / cancel pending requests |
| Managers | Team Space / Team Stats (their department and its sub-departments) and approve / reject team requests |

HR approves the other requests in **Employee Portal → Employee Requests** (Attendance menu of the sidebar).

**Set an Administrator password** once the portal is used on the network: without one the administrator program only
opens on the server PC itself (employees on the network get a message instead).

## HR features (web only, ZKBioTime-style)
Everything below is in the web server, the administrator program (sidebar group **HRMS**), the employee portal (/me) and
the mobile app. The Windows program does not know about it: its own reports keep using the employee's fixed shift and the
plain monthly salary.

| Area | What |
|---|---|
| Dashboard (start screen) | live cards Present / Absent / On Leave / Late / Early Exit / Half Day / Off, department-wise attendance, late arrivals, absent list, latest punches, month trend and top overtime, pending approvals, holidays, birthdays, work anniversaries; refreshes every 30 s |
| Shifts | break timing per shift: allowed minutes, optional window, "not working time". With 4 punches the real break is used (a longer break shows in the remark), with 2 punches the break is deducted when the day covers it. Night shifts as before (end before start) |
| Shift Roster | rotating shifts: month grid employees × days (shift or OFF per day, overrides the employee's own shift), rotation generator (shifts in order, change every N days, weekly days off, stagger) |
| Employee → HR Profile | reporting manager, emergency contact, blood group, marital status, bank account / IFSC, PAN, Aadhaar, UAN, PF / ESI no, PF / ESI / PT applicable, monthly TDS |
| Employee → Salary Structure / Documents | per-employee amounts for the salary components; documents (PDF / pictures / Word / Excel, 5 MB) that the employee also sees |
| Approvals | the **reporting manager** approves (else the department manager as before). New request types: **overtime** (with *Salary Rule → Overtime needs approval* only approved hours are paid), **comp-off** (for work on a holiday / weekly off; used as leave type **CO**, valid N days, FIFO), **profile change** (HR approves, then it is written to the employee) |
| Payroll Setup | salary components (Basic % of salary, HRA % of Basic, fixed allowances, "rest of the salary", fixed deductions), PF (employee / employer %, wage ceiling), ESI (%, salary limit), Professional Tax, advance / loan recovery in installments, comp-off validity. All statutory items are **off** until turned on here |
| Payslip | components, PF / ESI / PT / TDS / advance lines, PAN / UAN / bank, company logo and profile (Database Option → Company profile) |
| Reports | new: Department-wise Attendance, Payroll Register, Bank Transfer Statement, PF / ESI / PT / TDS, Approvals (regularisation / overtime / comp-off / claims), Comp-off Balance — grid, Excel, PDF |
| Notifications | bell in the administrator program (new requests), portal and app (decisions, announcements); HR sends announcements to everybody or a department. In-app only, no phone push |
| Users & Roles | own logins with a role: **Admin** (everything), **HR** (employees, attendance, leave, requests, reports), **Payroll** (salary setup and reports), **Viewer** (read only). The Supervisor password still logs in as Admin |
| Audit Log | every change in the administrator program and the portal / app, and administrator logins (failed ones too), with Excel export; passwords and pictures are never logged |

Tables the server adds for this (created on start if missing): `EmployeeProfiles`, `EmployeeDocuments`, `ShiftExtras`,
`ShiftRoster`, `SalaryComponents` (seeded Basic 50 % / HRA 40 % of Basic / Special Allowance), `EmployeeSalaryComponents`,
`Notifications`, `AuditLog`, `AdminUsers`, `WebBlobs`, the column `EmployeeRequests.Payload`, and the leave type
`CO - Compensatory Off`; settings `Salary.*`, `Company.*`, `Payroll.OtRequiresApproval`, `Leave.CompOffExpiryDays`.

## Devices
The LX50 is read by the **Raspberry Pi** (`pi/`, see `pi/README.md`); the Pi talks to this server:
punches and the user list come in, and Upload / Del(Device) / Download attendance logs go out as commands the Pi runs.
Set it up in **Database Option → Raspberry Pi**: copy the `[cloud]` lines into `/etc/lx50pi/config.ini` on the Pi and
`sudo systemctl restart lx50pi`. The device then shows **Online** in the Machine List.

- In the cloud (Render) the Pi only needs internet (any Wi-Fi): it calls `https://<app>.onrender.com/api/lx50/...`.
- Server on a PC: PC and Pi must reach each other (same Wi-Fi / LAN), and Windows Firewall must allow inbound TCP 4000
  (`netsh advfirewall firewall add rule name="ZK Attendance web" dir=in action=allow protocol=TCP localport=4000`, as administrator).
- Not available through the Pi (the LX50 / Pi do not offer it): remote fingerprint enrolment, synchronize time, clear logs,
  restart, fingerprint templates. Devices on a Windows PC's USB / Serial / Ethernet and ADMS devices stay with the Windows program.

## Run
Requirements: Node.js 20+ and a PostgreSQL database (Supabase, or local, e.g.
`docker run -d --name zk-pg -e POSTGRES_PASSWORD=zkpass -p 127.0.0.1:5433:5432 postgres:17`). The tables are created on the
first start. To take over the Windows program's data (SQL Server is only read):
`cd server && set DATABASE_URL=... && npx tsx scripts/copy-from-sqlserver.ts`.

```
cd web
npm run install:all
npm run build          # builds client/dist
npm start              # http://localhost:4000  (also serves the React app)
```
Development: `npm run dev:server` and `npm run dev:client` (http://localhost:5173, `/api` proxied to 4000).

Connection string / port: `server/config.json` (see `server/config.example.json`), or the environment variables `PORT`,
`DATABASE_URL` (`postgresql://user:password@host:5432/db`), `PUBLIC_URL` (address shown for the Pi; Render sets
`RENDER_EXTERNAL_URL` itself), `ADMIN_PASSWORD` (first administrator password when none is set) and `TZ` (e.g.
`Asia/Kolkata`: the local time of punches, "today" and `DEFAULT LOCALTIMESTAMP` in the database).

Backup: **Database Option → Backup Database** downloads every table as JSON; `server/scripts/restore-backup.ts` loads it.

Tests: `powershell -File test\make_test_db.ps1` (PostgreSQL in Docker on port 5433, filled from the SQL Server data), then
`npm run test:e2e`.

## Backend structure (`server/src`)
A request goes **route → controller → service → database**:

| Folder | What is in it |
|---|---|
| `server.ts` / `app.ts` | start-up (database, web tables, listen on port 4000) / the Express app (JSON, `/api`, React app, errors) |
| `config/` | `index.ts` settings from `config.json` / environment, `db.ts` PostgreSQL pool and `query` / `one` / `exec` / `transaction` (@name parameters, PascalCase result columns), `schema.ts` all tables and seed rows |
| `models/` | table rows and their loaders: employee, shift (with break), roster, leave, holiday, report result |
| `routes/` | URL → controller, one file per area (`employee.routes.ts` = `/api/employees`, …); `index.ts` mounts them all and puts the administrator login in front |
| `controllers/` | read the request (body, query, params), call a service, send JSON or a file |
| `services/` | the business logic: attendance calculation, payroll and salary structure, reports, leave and comp-off, devices / Raspberry Pi, employee portal, teams and reporting hierarchy, requests, notifications, dashboard, roster, documents, audit log, logins and users |
| `middlewares/` | `auth` (administrator with role check, employee, Pi token, audit trail), `cors` (mobile app), `error` (404, error messages) |
| `utils/` | dates / times, `UserError`, number formatting, HTTP helpers (file downloads, ids), `permissions` (what each role may do) |

## Tests
On a copy of the database (the real one is not touched):
```
powershell -ExecutionPolicy Bypass -File test\make_test_db.ps1
npm run test:e2e       # API writes + reports / Excel / PDF, Pi code <-> server with a fake LX50, employee portal, HR features
powershell -ExecutionPolicy Bypass -File test\make_test_db.ps1 -Drop
```
