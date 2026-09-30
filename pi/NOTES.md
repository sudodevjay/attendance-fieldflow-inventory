# Notes

## 2026-09-28
- Installed USBPcap 1.5.4.0 and Wireshark 4.6.9 (silent, exit code 0). USBPcap control devices `\\.\USBPcap1..3` exist
  but list no attached devices yet: the filter driver needs a PC restart.
- Built `sdk-driver` (0 errors). Not run yet.
- Next: restart PC, keep the attendance software closed, run `capture.ps1` as administrator.
- Moved folder from D:\pi to D:\attendance\pi (paths in capture.ps1 updated).
- PC restart scheduled so USBPcap attaches. After restart: check `USBPcapCMD --extcap-config` lists devices,
  keep the attendance software closed, then run capture.ps1 as administrator.
- After restart (boot 18:01): USBPcap service Running, `USBPcap1` now lists devices (camera, Bluetooth) — filter
  driver attached. LX50 (`VID_1B55&PID_0A01`, libusb-win32) not present at check time: not plugged in / no power.
- Next: connect LX50 (mini-USB + DC power), confirm it shows under USBPcap, close attendance software, run capture.ps1 as admin.
- 19:21 capture attempt failed: LX50 still not connected (Connect_USB err=-2). "Couldn't open device - 2" was
  capture.ps1 trying USBPcap3/4, which don't exist on this PC. Fixed: capture.ps1 now uses only the hubs USBPcap
  lists and stops early if the LX50 is not present.
- Pre-device work done: `lx50pi` Python package (protocol, USB/UDP/TCP transport, read-only device client, SQLite
  buffer, HTTPS uploader, service loop, CLI, fake device), `analyze/usbpcap_dump.py`, `deploy/` (install.sh,
  systemd, udev, config example). 12 tests pass on Windows (no device needed).
- Open until the capture: USB framing (raw / tcp / other), endpoints, vendor control requests, checksum style,
  chunk size. Cloud API format is a proposal.
- Next: connect the LX50, run capture.ps1 as admin, run the analyser, set config, then try `lx50pi info` on the Pi.

## 2026-09-29
- capture.ps1 as admin: `captures/20260929_095608` (sdk-driver exit 0, all 10 steps ok). The LX50 was plugged in
  before the capture, so no descriptors; its bulk transfers show under address 255. The analyser now finds it by
  its 0xF3/0xF4 vendor requests.
- **USB protocol solved:** same packets as UDP (pyzk checksum), framing `zkusb`: ctrl 0x40/0xF3 wValue=len then bulk
  OUT 0x03; after ~200 ms ctrl 0x40/0xF4 wValue=4 -> bulk IN 0x82 u32 length n; ctrl 0xF4 wValue=n -> bulk IN reply.
- Differences found and fixed in lx50pi: GET_FREE_SIZES takes a field index (4/6/8/14/15/16) and answers 4 bytes;
  punches are 22-byte records (new layout in protocol.parse_attendance). Simulator has `lx50=True` for this.
- Tested on Windows with pyusb + libusb-win32 against the real LX50: `info` (NPT6262703374, 7/500 users,
  7/500 fingers, 30/50000 punches), `users` (7), `logs` (30) - all identical to the SDK output in markers.txt.
- Experiment with `usb_reply_delay = 0`: the LX50 stopped answering on USB (lx50pi and the ZKTeco SDK both hang on
  connect; clear_halt / USB reset do not help). Needs power off/on. The delay is now clamped to >= 0.2 s.
- 17 tests pass (new: zkusb framing against a fake USB device, LX50 simulator mode, 22-byte records from the
  capture, analyser without descriptors).
- Next: power-cycle the LX50, re-run `info` / `once` on Windows, then copy the pi folder to the Pi, `install.sh`,
  move the mini-USB cable to the Pi, `lx50pi info`.
- After the power cycle: `info`, `users`, `logs` and two `once` cycles OK (30 punches stored, second cycle 0 new).
- User management added (for a React page via a cloud command queue): `Device.set_user / delete_user /
  start_enroll`, `commands.py`, commands table in SQLite, user list upload, CLI `setuser / deluser / enroll`.
  Packets are the standard ones (CMD_USER_WRQ 8 with the 72-byte record, CMD_DELETE_USER 18 by slot,
  CMD_REFRESHDATA 1013, CMD_CANCELCAPTURE 62 + CMD_STARTENROLL 61). 22 tests pass (simulator).
- NOT yet tested on the LX50 (writing to the device was not run from here). sdk-driver has a `write` mode for this:
  test user 99 only (stops if 99 exists): add, RefreshData, edit name/password/card, StartEnrollEx + cancel,
  delete. To confirm, the owner runs as administrator, attendance software closed:
    1. `powershell -ExecutionPolicy Bypass -File D:\attendance\pi\capture.ps1 -Mode write`
       then `python analyze\usbpcap_dump.py captures\<folder>`: compare the SDK's packets with lx50pi's.
    2. `python -m lx50pi setuser 99 "LX50 Test" --password 4321 --card 1234567`, `python -m lx50pi users`,
       `python -m lx50pi enroll 99` (cancel on the device), `python -m lx50pi deluser 99`, `python -m lx50pi users`.
- On the Pi (Raspberry Pi 4, Debian 13, housys@housys.local): install.sh run, 22 tests pass there.
  LX50 plugged in DIRECTLY failed: without its DC power the Pi hit undervoltage; with DC power it still dropped
  off the bus (error -71, "device not accepting address", connect/disconnect loop). usbmon showed the LX50 firmware
  answers the language-id request (string 0) with its manufacturer string, then returns garbage for string 2, and
  drops off ~400 ms after SET_CONFIGURATION. Not fixed by: old_scheme_first, autosuspend=-1, usbcore quirks g/n/d,
  keeping mtp-probe away (/etc/udev/rules.d/60-lx50-no-mtp.rules left in place, harmless).
- **Fix: a USB 2.0 hub between Pi and LX50** (Pi -> hub -> LX50, LX50 on its own DC power). Stable, no disconnects.
  On the Pi: `info` (7/500 users, 31/50000 punches), `users` (7), `logs` (31) and two `once` cycles (31 new, then 0).
- Next: enable the service (cloud URL empty until the server exists), test the write commands with test user 99,
  cloud server + React page.
- Service enabled on the Pi (cloud URLs empty = store locally only). Fixed deploy/lx50pi.service: `Group=plugdev`
  made the service lose its own lx50pi group, so it could not read /etc/lx50pi/config.ini (root:lx50pi 640);
  now `SupplementaryGroups=plugdev`. Survives a reboot: starts by itself, finds the LX50 through the hub.
- Write test on the real LX50 from the Pi (test user 99, service stopped meanwhile):
  - add `setuser 99 "LX50 Test" --password 4321 --card 1234567`: ACK_OK, read back in slot 8 with all fields. OK
  - edit `setuser 99 "LX50 Test2" --password 5678 --card 7654321`: same slot, no duplicate, all fields changed. OK
  - delete `deluser 99`: ACK_OK, count back to 7. OK. The user buffer then still holds the freed slot as an
    all-zero 72-byte record (7 users, 576 bytes): parse_users now takes the record size from the buffer and skips it.
  - enrol: CMD_STARTENROLL (61) and CMD_CANCELCAPTURE (62) answer ACK_UNKNOWN in every payload format tried
    (24s/b/b, <Ib, 9s/b/b). The device keeps working. Remote enrolment is not available on this LX50 over this
    protocol (maybe the SDK uses another command: `capture.ps1 -Mode write` on Windows would show it); enrol_finger
    commands now fail with a clear message. Fingerprints are enrolled in the device menu.
  - Other users untouched throughout; service restarted afterwards.

## 2026-09-30 — cloud, office LX50, Wi-Fi
- Pi talks to the cloud (Render, https://zk-attendance.onrender.com), Tailscale `housys-pi` 100.107.8.31,
  Wi-Fi agent `lx50pi-wifi` (/wifisetup page; only the chosen network 999 + fallback `satyendra` 900 are saved).
- Office LX50 on the cable: serial NPT6253601761, Ver 6.60 May 19 2023, 37 users, 2306 punches.
  - Without its DC adapter it dropped off the USB every ~15 s (as on 2026-09-29).
  - With DC power the service still failed ("control request 0xf3 failed: [Errno 5]" ~4 s after connect,
    then USB disconnect) while a plain `info` worked: the full read with chunk_size 16384 made it drop.
    chunk_size 1024: users + 2306 punches read without a disconnect; uploaded to the cloud. Default now 1024.
  - The Pi still had the serial of the test LX50 (NPT6262703374): the service now reads the serial every cycle
    and does a full read when another device is on the cable.
- The Pi's Wi-Fi chip hung for ~8 min ("brcmf_proto_bcdc_query_dcmd ... -110"): Wi-Fi power save is now off
  (NetworkManager conf.d/lx50pi-wifi-powersave.conf + iw), the agent reads the Wi-Fi status once a minute, and a
  watchdog restarts the Wi-Fi after 3 min without the server and reloads brcmfmac after 10 min.
