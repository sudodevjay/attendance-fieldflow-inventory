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
  open-source projects such as `pyzk`. The USB protocol may reuse the same packets; the capture will tell.

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
device.py     connect, serial, firmware, time, counts, users, punches  (read-only)
store.py      SQLite buffer: punches stay until the cloud accepts them
uploader.py   HTTPS POST of punch batches (JSON, Bearer token)
service.py    loop: every 30 s read the device if the punch count changed, store, upload
simulator.py  fake device for testing
```
Commands: `python -m lx50pi [-c config.ini] probe | info | users | logs | once | run | simulate`

Test on Windows without the device: `python -m unittest discover -s tests -v` (from this folder).
Try the CLI against the fake device: `python -m lx50pi simulate` in one window, then in another
`python -m lx50pi -c test.ini info` with `[device] transport = udp`.

**Not confirmed until the capture:** whether USB carries the same packets as UDP (`usb_framing = raw`), TCP-framed
ones (`tcp`), or something else; which endpoints; whether the SDK sends vendor control requests first. The
analyser prints exactly these values. The cloud API (`uploader.py` docstring) is a proposal until the server exists.

## Steps
1. Install USBPcap + Wireshark (`tools\install_tools.bat` as administrator). **Restart the PC** so the USBPcap
   filter driver attaches to the USB hubs. (done)
2. Connect the LX50 (mini-USB + DC power). Close the attendance software.
3. Run `capture.ps1` as administrator.
4. `python analyze\usbpcap_dump.py captures\<folder>` and put the suggested values in the config.
5. On the Pi: `sudo sh deploy/install.sh`, then `python -m lx50pi probe` and `info`.
6. Set the cloud URL / token, `sudo systemctl enable --now lx50pi`.

Status is kept in `NOTES.md`.
