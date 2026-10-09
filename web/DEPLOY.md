# Free deployment: Render (app) + Supabase (database) + Pi on the office Wi-Fi

```
 Office Wi-Fi                          Internet (free)
 LX50 ── USB hub ── Raspberry Pi ──https──►  Render: zk-attendance.onrender.com  ──►  Supabase PostgreSQL
                                              (React app + API, one service)          (Singapore)
 Browser / mobile app (anywhere) ─────https──►        ▲
```
The Pi only calls out over HTTPS: no port forwarding, no fixed IP, any Wi-Fi with internet works.
The Windows program's SQL Server database is not used or changed.

## 1. Database: Supabase (free)
1. https://supabase.com → sign in with GitHub → **New project**: name `zk-attendance`, a strong **database password**
   (write it down), region **Southeast Asia (Singapore)**, Free plan.
2. Project → **Connect** → **Session pooler** (not "Direct": Render has no IPv6) → copy the URI:
   `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`
   Put the password in place of `[YOUR-PASSWORD]` (characters like `@ # / ?` must be URL-encoded, e.g. `@` → `%40`).
3. Nothing else: the web server creates the tables on its first start.

Optional — take over the current data (employees, punches, leave ...) from the Windows program, on the Windows PC
(SQL Server is only read):
```
cd D:\attendance\web\server
set DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
npx tsx scripts/copy-from-sqlserver.ts
```

## 2. App: Render (free)
1. Push this branch to GitHub (`git push -u origin render-postgres`, or merge it into `main`).
2. https://render.com → sign in with GitHub → **New → Blueprint** → choose the repository and the branch. Render reads
   `render.yaml` (one free web service `zk-attendance`, Singapore, `TZ=Asia/Kolkata`).
3. It asks for the secret values:
   - `DATABASE_URL` = the Supabase URI from step 1
   - `ADMIN_PASSWORD` = the first administrator password (used only while none is set; change it later in
     Maintenance/Options → Administrator)
4. **Apply**. The first build takes ~5 minutes. Then open `https://zk-attendance.onrender.com` (the name Render shows),
   log in with any user name and `ADMIN_PASSWORD`.

With the Blueprint (GitHub connected) every push deploys again. A service created from the public repo URL (as the
live one) does not get the pushes: Render → the service → **Manual Deploy → Deploy latest commit**. Logs: the service → Logs.

## 2b. Inventory service: its own Render service and its own Supabase database
The inventory (`inventory-api/`) is a separate backend with a separate database. The browser / app only talks to
`zk-attendance`, which checks the login and forwards `/api/inventory` and `/api/portal/store`; the two services talk only
over HTTP with a shared secret `SERVICE_TOKEN`.

1. **Database**: supabase.com → **New project** (e.g. `zk-inventory`, region Southeast Asia (Singapore), own password) →
   Connect → **Session pooler** URI (as in step 1). This is the inventory's `DATABASE_URL`, not the attendance one.
2. **Secret**: make one long random text, e.g. in PowerShell
   `[Convert]::ToBase64String((1..32 | % { Get-Random -Max 256 }) -as [byte[]])`. It is `SERVICE_TOKEN` on both services.
3. **Service**: Render → **New → Web Service** → the same repository and branch → Name `zk-inventory`, Region Singapore,
   **Root Directory** `inventory-api`, Build `npm install`, Start `npm start`, Health check path `/health`, plan Free.
   Environment: `DATABASE_URL` (step 1), `SERVICE_TOKEN` (step 2), `ATTENDANCE_URL` = `https://zk-attendance.onrender.com`,
   `TZ` = `Asia/Kolkata`, `NODE_VERSION` = `22`. Create → it shows `https://zk-inventory.onrender.com` (or similar).
   (With the Blueprint, `render.yaml` already describes `zk-inventory`; only the secrets are asked.)
4. **Attendance service** (`zk-attendance`) → Environment → add `SERVICE_TOKEN` (the same text) and `INVENTORY_URL` =
   the inventory service's address → Save (it restarts).
5. **Data that was already in the inventory** (when the inventory still lived in the attendance database): on a PC,
   ```
   cd inventory-api
   npm install
   set SOURCE_DATABASE_URL=<attendance DATABASE_URL>
   set DATABASE_URL=<inventory DATABASE_URL>
   set SERVICE_TOKEN=x
   npx tsx scripts/migrate-from-attendance.ts --yes
   ```
   It only reads the attendance database. Then restart `zk-inventory` (Manual Deploy) and check the inventory screens.
   The old `Inv*` tables in the attendance database are no longer used; drop them later in the Supabase SQL editor if you like.
6. **Backup**: the attendance backup does not contain the inventory any more. Inventory → Automation settings →
   *Backup inventory database* (SuperAdmin); restore with `npx tsx scripts/restore-backup.ts <file> --yes` in `inventory-api`.

Free plan: `zk-inventory` sleeps after 15 minutes without use; the first inventory screen after that waits up to a minute
(the app says so: try again). The attendance part is not affected.

## 3. Raspberry Pi on the office Wi-Fi
1. Wi-Fi (once, on the Pi): `sudo nmcli dev wifi connect "<office Wi-Fi>" password "<password>"` — it reconnects by itself
   after a reboot. Check: `curl -I https://zk-attendance.onrender.com`.
2. LX50: Pi → **USB 2.0 hub** → LX50, LX50 on its own DC power (without the hub it drops off the bus).
3. In the web app: **Database Option → Raspberry Pi** → **Copy**, and put the lines in the `[cloud]` part of
   `/etc/lx50pi/config.ini` (`sudo nano /etc/lx50pi/config.ini`). They look like:
   ```
   [cloud]
   url = https://zk-attendance.onrender.com/api/lx50/punches
   users_url = https://zk-attendance.onrender.com/api/lx50/users
   commands_url = https://zk-attendance.onrender.com/api/lx50/commands
   token = <token shown there>
   verify_tls = yes
   ```
4. `sudo systemctl enable --now lx50pi` (or `sudo systemctl restart lx50pi`), then `journalctl -u lx50pi -f`: punch on the
   LX50 and watch it arrive; the device shows **Online** in the Machine List.

Wi-Fi from anywhere: `https://<app>.onrender.com/wifisetup` (password = Render env `WIFI_SETUP_PASSWORD`) lists the
networks around the Pi and switches it to the chosen one (Pi service `lx50pi-wifi`, see `pi/lx50pi/wifi.py`). Only the
chosen network (priority 999) and the fallback hotspot (`[wifi] fallback_ssid`, priority 900) stay saved.

Working from home: install Tailscale on the Pi and your laptop (free): `curl -fsSL https://tailscale.com/install.sh | sh`,
`sudo tailscale up`. Then `ssh housys@<pi name>` works from anywhere.

## 4. Employees / mobile app
Portal: `https://zk-attendance.onrender.com/me`. Mobile app → Server address: `https://zk-attendance.onrender.com`
(write the `https://`).

## Free plan limits (good to know)
| | Limit | What it means here |
|---|---|---|
| Render | 512 MB RAM, sleeps after 15 min without requests, 750 h / month | the Pi calls every 15 s, so it stays awake; one service all month = 720–744 h |
| Render | disk is not kept between deploys | nothing is stored on disk; everything is in the database |
| Supabase | 500 MB database, paused after 7 days without activity | photos / documents take the most space; the Pi keeps it active |
| Supabase | no downloadable backups on Free | **Database Option → Backup Database** downloads a JSON of all tables — do it weekly; `scripts/restore-backup.ts` loads it |

If the Render service is asleep (Pi off for a long time), the first page load takes up to a minute.
