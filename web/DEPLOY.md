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
