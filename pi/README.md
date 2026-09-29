# LX50 on Raspberry Pi (USB protocol research)

Goal: read punches / users from the ZKTeco LX50 over its mini-USB port on a Raspberry Pi (Linux), without the
Windows-only ZKTeco SDK, and send them to a cloud server. This folder is separate from the attendance software;
nothing here changes that code.

## Why it looks possible
- The LX50 shows up as `USB\VID_1B55&PID_0A01`, class FF (vendor specific), no COM port.
- The SDK's USB layer (`usbstd.dll`) only uses libusb-0.1 calls: `usb_set_configuration`, `usb_claim_interface`,
  `usb_control_msg`, `usb_bulk_write`, `usb_bulk_read`. So the protocol is plain USB control + bulk transfers,
  which Linux libusb / Python `pyusb` can send too.
- ZKTeco's network protocol (8-byte header: command, checksum, session id, reply id) is already documented by
  open-source projects such as `pyzk`. **Confirmed (capture 2026-09-29):** the LX50 sends the very same packets
  over USB.

## LX50 USB protocol (confirmed, tested with lx50pi against the real device)
Every bulk transfer is announced by a vendor control request on endpoint 0 (bmRequestType 0x40, wIndex 0, no
data stage). Packets are the same as over UDP (pyzk checksum style).
```
send     ctrl 0xF3 wValue=len(packet)   -> bulk OUT 0x03: packet
         wait 200 ms (the SDK does; asking earlier makes the LX50 stop answering until power off/on)
receive  ctrl 0xF4 wValue=4             -> bulk IN 0x82: u32 reply length n
         ctrl 0xF4 wValue=n             -> bulk IN 0x82: reply packet
```
- `GET_FREE_SIZES` (50) takes the field index as u32 data and answers one u32 (4 users, 6 fingerprints,
  8 punches, 14/15/16 capacities: 500 / 500 / 50000).
- Users: 72-byte records. Punches: 22-byte records `u16 uid, 9s user id, u8 ?, u8 verify, u32 time, u8 state, 4x`.
- Users / punches are read with `1503` prepare buffer -> `1504` read chunk (answered with `1501` DATA) -> `1502`.

## Folder
| Path | What |
|---|---|
| `tools\` | USBPcap 1.5.4.0 and Wireshark 4.6.9 installers (official, signature checked) + install script |
| `sdk-driver\` | Small x86 program: runs READ-ONLY SDK calls (connect, serial, firmware, time, counts, logs, users, disconnect) and writes a timestamp for every step to `markers.txt` |
| `capture.ps1` | Checks the LX50 is connected, starts USBPcap on every hub, runs sdk-driver, stops the capture |
| `captures\<date_time>\` | `USBPcapN.pcap` recordings + `markers.txt` |
| `analyze\usbpcap_dump.py` | Reads a capture: LX50 transfers in time order with the SDK steps, decodes ZKTeco packets, prints the config values for the Pi |
| `lx50pi\` | The Pi program (Python 3.9+, only `pyusb` needed) |
| `deploy\` | Pi install: `install.sh`, systemd unit, udev rule, `config.example.ini` |
| `tests\` | Tests that run without the device (fake device on UDP/TCP, fake cloud server, synthetic capture) |

## lx50pi
```
protocol.py   packets, checksum, time format, user / punch record layouts
transport.py  USB (pyusb) + UDP/TCP;  USB framing / endpoints / init requests come from config
device.py     connect, serial, firmware, time, counts, users, punches; add / edit / delete user, start enrolment
commands.py   user commands from the cloud (React page -> server queue -> Pi -> LX50) and their results
store.py      SQLite buffer: punches until the cloud accepts them; commands with their results
uploader.py   HTTPS POST of punch batches and of the user list (JSON, Bearer token)
service.py    loop every 15 s: run cloud commands, read the device if the punch count changed, store, upload
simulator.py  fake device for testing
```
Commands: `python -m lx50pi [-c config.ini] probe | info | users | logs | setuser | deluser | enroll | once | run |
simulate` (`python -m lx50pi -h` shows the arguments).

## User management from a web page
```
React page --HTTPS--> cloud server (command queue) <--HTTPS, Pi polls every 15 s-- Pi --USB--> LX50
```
The Pi never needs to be reachable from outside. API proposal in the `lx50pi/commands.py` docstring:
`set_user` (add, or edit when the id exists), `delete_user`, `enroll_finger` (the person then puts the finger on the
device 3 times; a fingerprint cannot come from the web page). Each command runs at most once, its result is kept
in SQLite until the server has it, invalid fields fail before anything reaches the device. The user list is sent
to `users_url` whenever it changed, including users added on the device keypad.
Device limits: 500 users, user id 1-9 digits, name up to 24 bytes, password up to 8 digits, privilege 0 or 14 (admin).
**Tested on the real LX50 (2026-09-29, test user 99):** add, edit and delete work. Starting an enrolment remotely
does NOT work on the LX50 (the device answers "unknown command"), so fingerprints are enrolled in the device menu;
`enroll_finger` commands fail with that message.

Test on Windows without the device: `python -m unittest discover -s tests -v` (from this folder).
Try the CLI against the fake device: `python -m lx50pi simulate` in one window, then in another
`python -m lx50pi -c test.ini info` with `[device] transport = udp`.

The USB side is confirmed (see above); on Windows the same code runs against the LX50 through the libusb-win32
driver (`pip install pyusb`). The cloud API (`uploader.py` docstring) is a proposal until the server exists.

## Steps
1. Install USBPcap + Wireshark (`tools\install_tools.bat` as administrator). **Restart the PC** so the USBPcap
   filter driver attaches to the USB hubs. (done)
2. Connect the LX50 (mini-USB + DC power). Close the attendance software. (done)
3. Run `capture.ps1` as administrator. (done: `captures\20260929_095608`)
4. `python analyze\usbpcap_dump.py captures\<folder>` and put the suggested values in the config. (done: in
   `deploy\config.example.ini`)
5. Copy this folder to the Pi and connect the LX50 through a **USB 2.0 hub** (Pi -> hub -> LX50, LX50 on its own
   DC power). Plugged directly into a Raspberry Pi 4 the LX50 keeps dropping off the bus (see NOTES.md). On the Pi: `sudo sh deploy/install.sh`, then `python -m lx50pi probe` and `info`.
6. Set the cloud URL / token, `sudo systemctl enable --now lx50pi`.

Status is kept in `NOTES.md`.
