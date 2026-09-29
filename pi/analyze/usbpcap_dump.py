"""Reads the USBPcap recordings made by capture.ps1 and shows what the SDK sent to the LX50.

    python analyze\\usbpcap_dump.py captures\\20260928_192131            (whole capture folder)
    python analyze\\usbpcap_dump.py captures\\...\\hub1.pcap --all        (every device, not just the LX50)

Prints the LX50's transfers in time order with the SDK step markers in between, tries to decode every bulk
payload as a ZKTeco packet (raw and TCP-framed, both checksum styles), and ends with a summary plus the config
lines for lx50pi (endpoints, framing, vendor control requests). Standard library only.

When the LX50 was already plugged in before the capture started its descriptors are missing; it is then found by
its 0xF3 / 0xF4 vendor requests (zkusb framing, see lx50pi/transport.py). USBPcap lists its bulk transfers under
address 255, so those are taken from the same bus.
"""
import argparse
import os
import re
import struct
import sys
from collections import Counter, defaultdict
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from lx50pi import protocol as P  # noqa: E402

LINKTYPE_USBPCAP = 249
TRANSFER = {0: 'ISO', 1: 'INT', 2: 'CTRL', 3: 'BULK'}
STAGE = {0: 'setup', 1: 'data', 2: 'status', 3: 'complete'}
LX50 = (0x1B55, 0x0A01)
ZKUSB_REQUESTS = (0xF3, 0xF4)


class Xfer:
    __slots__ = ('ts', 'irp', 'status', 'response', 'bus', 'addr', 'ep', 'kind', 'stage', 'data', 'file')

    @property
    def dir_in(self):
        return bool(self.ep & 0x80)


def read_pcap(path):
    with open(path, 'rb') as f:
        head = f.read(24)
        if len(head) < 24:
            return
        magic = head[:4]
        if magic == b'\xd4\xc3\xb2\xa1':
            end, div = '<', 1e6
        elif magic == b'\x4d\x3c\xb2\xa1':
            end, div = '<', 1e9
        elif magic == b'\xa1\xb2\xc3\xd4':
            end, div = '>', 1e6
        else:
            raise ValueError(f'{path}: not a pcap file (pcapng is not supported; USBPcapCMD writes pcap)')
        linktype = struct.unpack(end + 'I', head[20:24])[0]
        if linktype != LINKTYPE_USBPCAP:
            raise ValueError(f'{path}: link type {linktype}, expected USBPcap (249)')
        while rec := f.read(16):
            if len(rec) < 16:
                break
            sec, frac, incl, _orig = struct.unpack(end + 'IIII', rec)
            yield sec + frac / div, f.read(incl)


def parse_usbpcap(ts, pkt, fname):
    hlen, irp, status, _func, info, bus, addr, ep, kind, dlen = struct.unpack('<HQIHBHHBBI', pkt[:27])
    x = Xfer()
    x.ts, x.irp, x.status, x.response = ts, irp, status, bool(info & 1)
    x.bus, x.addr, x.ep, x.kind = bus, addr, ep, kind
    x.stage = pkt[27] if kind == 2 and hlen >= 28 else None
    x.data = pkt[hlen:hlen + dlen]
    x.file = fname
    return x


def load(paths):
    xs = []
    for p in paths:
        for ts, pkt in read_pcap(p):
            if len(pkt) >= 27:
                xs.append(parse_usbpcap(ts, pkt, os.path.basename(p)))
    xs.sort(key=lambda x: x.ts)
    return xs


def find_devices(xs):
    """(file, bus, addr) -> (vid, pid) from device descriptors seen in the capture."""
    found = {}
    for x in xs:
        d = x.data
        if x.kind == 2 and x.response and len(d) >= 18 and d[0] == 18 and d[1] == 1:
            found[(x.file, x.bus, x.addr)] = struct.unpack('<HH', d[8:12])
    return found


def find_by_zkusb_requests(xs):
    """(file, bus, addr) of devices that got the LX50's vendor requests 0x40 / 0xF3 or 0xF4."""
    return {(x.file, x.bus, x.addr) for x in xs
            if x.kind == 2 and x.stage == 0 and not x.response and len(x.data) >= 8
            and x.data[0] == 0x40 and x.data[1] in ZKUSB_REQUESTS}


def read_markers(folder, day):
    path = os.path.join(folder, 'markers.txt')
    out = []
    if not os.path.exists(path):
        return out
    with open(path, encoding='utf-8', errors='replace') as f:
        lines = f.readlines()
    for line in lines:
        m = re.match(r'(\d\d):(\d\d):(\d\d)\.(\d{3})\s+\+\s*[\d.]+s\s+(.*)', line)
        if m:
            h, mi, s, ms, text = m.groups()
            t = day.replace(hour=int(h), minute=int(mi), second=int(s), microsecond=int(ms) * 1000)
            out.append((t.timestamp(), text.strip()))
        elif line.startswith('    '):
            out.append((None, line.strip()))  # PUNCH / USER detail lines, printed after their step
    return out


def decode_zk(data):
    """Try to read the bytes as a ZKTeco packet. Returns (description, framing, checksum_style) or None."""
    framing = 'raw'
    if data[:4] == P.TCP_MAGIC and len(data) >= 16:
        framing, n = 'tcp', struct.unpack('<I', data[4:8])[0]
        data = data[8:8 + n]
    if len(data) < 8:
        return None
    p = P.parse_packet(data)
    if p.command not in P.COMMAND_NAMES:
        return None
    body = lambda rid: struct.pack('<4H', p.command, 0, p.session_id, rid) + p.data
    if P.checksum(body((p.reply_id - 1) % P.USHRT_MAX)) == p.checksum:
        style = 'pyzk'      # checksum over reply_id - 1 (what lx50pi sends)
    elif P.checksum(body(p.reply_id)) == p.checksum:
        style = 'plain'     # checksum over the header as sent
    else:
        style = 'none'
    desc = f'{p.name} sess={p.session_id:#06x} reply={p.reply_id} chk={style} data={len(p.data)}B'
    return desc, framing, style


def hexs(b, limit):
    h = b[:limit].hex(' ')
    return h + (f' ... (+{len(b) - limit})' if len(b) > limit else '')


def setup_str(d):
    rt, rq, val, idx, ln = struct.unpack('<BBHHH', d[:8])
    kind = {0: 'std', 1: 'class', 2: 'vendor', 3: 'res'}[(rt >> 5) & 3]
    return f'{kind} bmRequestType={rt:#04x} bRequest={rq:#04x} wValue={val:#06x} wIndex={idx:#06x} wLength={ln}'


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('path', help='capture folder or a .pcap file')
    ap.add_argument('--all', action='store_true', help='show every device, not just the LX50')
    ap.add_argument('--hex', type=int, default=64, help='bytes of hex to show per transfer (default 64)')
    a = ap.parse_args(argv)

    folder = a.path if os.path.isdir(a.path) else os.path.dirname(a.path)
    pcaps = sorted(os.path.join(folder, f) for f in os.listdir(folder) if f.endswith('.pcap')) \
        if os.path.isdir(a.path) else [a.path]
    if not pcaps:
        sys.exit(f'no .pcap files in {folder}')
    xs = load(pcaps)
    devices = find_devices(xs)
    print('Devices in the capture:')
    for (f, bus, addr), (vid, pid) in sorted(devices.items()):
        print(f'  {f} bus {bus} addr {addr}: {vid:04x}:{pid:04x}' + ('   <-- LX50' if (vid, pid) == LX50 else ''))
    targets = {k for k, v in devices.items() if a.all or v == LX50}
    if not targets and not a.all:
        targets = find_by_zkusb_requests(xs)
        for f, bus, addr in sorted(targets):
            print(f'  {f} bus {bus} addr {addr}: no descriptor, but 0xF3/0xF4 vendor requests   <-- LX50')
    if a.all:
        targets |= {(x.file, x.bus, x.addr) for x in xs}
    if not targets:
        sys.exit('LX50 (1b55:0a01) not found in the capture. Was it plugged in and powered? Try --all.')

    day = datetime.fromtimestamp(xs[0].ts) if xs else datetime.now()
    events = [(ts, 'M', text) for ts, text in read_markers(folder, day) if ts]
    buses = {(f, bus) for f, bus, _ in targets}
    mine = [x for x in xs if (x.file, x.bus, x.addr) in targets or (x.addr == 255 and (x.file, x.bus) in buses)]
    for x in mine:
        events.append((x.ts, 'X', x))
    events.sort(key=lambda e: (e[0], e[1] != 'M'))

    t0 = events[0][0]
    eps, setups, framings, styles = Counter(), Counter(), Counter(), Counter()
    ep_bytes = defaultdict(int)
    print()
    for ts, kind, e in events:
        stamp = f'{datetime.fromtimestamp(ts):%H:%M:%S.%f}'[:-3] + f' +{ts - t0:8.3f}'
        if kind == 'M':
            print(f'\n{stamp}  ======== {e}')
            continue
        x = e
        tag = f'{TRANSFER.get(x.kind, x.kind):4} ep {x.ep:#04x} {"IN " if x.dir_in else "OUT"}'
        if x.kind == 2:
            if x.stage == 0 and len(x.data) >= 8 and not x.response:
                setups[x.data[:8]] += 1
                print(f'{stamp}  {tag} SETUP {setup_str(x.data)}')
                continue
            if not x.data:
                continue
            print(f'{stamp}  {tag} {STAGE.get(x.stage, x.stage)} {len(x.data)}B  {hexs(x.data, a.hex)}')
            continue
        if not x.data:
            if x.status:
                print(f'{stamp}  {tag} status {x.status:#010x} (no data)')
            continue
        eps[(x.ep, x.kind)] += 1
        ep_bytes[(x.ep, x.kind)] += len(x.data)
        z = decode_zk(x.data)
        extra = ''
        if z:
            extra = f'  [{z[0]} framing={z[1]}]'
            framings[z[1]] += 1
            styles[z[2]] += 1
        st = f' status {x.status:#010x}' if x.status else ''
        print(f'{stamp}  {tag} {len(x.data):5}B{st}  {hexs(x.data, a.hex)}{extra}')

    print('\n======== Summary')
    print('Data endpoints:')
    for (ep, k), n in sorted(eps.items()):
        print(f'  {TRANSFER.get(k, k):4} {ep:#04x} {"IN " if ep & 0x80 else "OUT"}  {n} transfers, {ep_bytes[(ep, k)]} bytes')
    print('Control requests (setup packets):')
    for s, n in setups.most_common():
        print(f'  {n:3}x  {setup_str(s)}')
    print('ZKTeco packets recognised:', dict(framings) or 'none', ' checksum styles:', dict(styles) or '-')

    outs = [ep for (ep, k) in eps if k == 3 and not ep & 0x80]
    ins = [ep for (ep, k) in eps if k == 3 and ep & 0x80]
    vendor = [s for s in setups if (s[0] >> 5) & 3 == 2]
    if any(s[0] == 0x40 and s[1] in ZKUSB_REQUESTS for s in vendor):
        # per-transfer length announcements, not init requests
        vendor = [s for s in vendor if not (s[0] == 0x40 and s[1] in ZKUSB_REQUESTS)]
        framings = Counter({'zkusb': sum(framings.values()) or 1})
    print('\nSuggested lx50pi config ([device] section):')
    print('  transport = usb')
    if outs:
        print(f'  usb_ep_out = {outs[0]:#04x}')
    if ins:
        print(f'  usb_ep_in = {ins[0]:#04x}')
    if framings:
        print(f'  usb_framing = {framings.most_common(1)[0][0]}')
    else:
        print('  # usb_framing: bulk data is NOT a known ZKTeco packet -> the USB protocol differs; look at the hex above')
    if vendor:
        items = []
        for s in vendor:
            rt, rq, val, idx, ln = struct.unpack('<BBHHH', s[:8])
            items.append(f'{rt:02x},{rq:02x},{val:04x},{idx:04x},{ln if rt & 0x80 else ""}')
        print('  # vendor control requests seen; OUT ones need their data bytes from the hex above')
        print('  usb_init_controls = ' + ';'.join(items))
    if styles.get('plain') and not styles.get('pyzk'):
        print('  # NOTE: the SDK uses the plain checksum -> change protocol.build_packet accordingly')


if __name__ == '__main__':
    main()
