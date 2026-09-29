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
