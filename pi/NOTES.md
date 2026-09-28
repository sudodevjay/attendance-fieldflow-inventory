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
