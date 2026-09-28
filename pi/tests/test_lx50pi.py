"""Tests without the device: protocol, fake device over UDP/TCP, service + cloud upload, capture analyser.
    python -m unittest discover -s tests -v        (from the pi folder)
"""
import contextlib
import io
import json
import os
import struct
import sys
import tempfile
import threading
import unittest
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from lx50pi import protocol as P  # noqa: E402
from lx50pi import simulator  # noqa: E402
from lx50pi.device import Device, DeviceError  # noqa: E402
from lx50pi.service import Service, load_config  # noqa: E402
from lx50pi.transport import TcpTransport, UdpTransport, _parse_controls  # noqa: E402

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'analyze'))
import usbpcap_dump  # noqa: E402


class ProtocolTests(unittest.TestCase):
    def test_time_round_trip(self):
        t = datetime(2026, 9, 28, 19, 21, 36)
        self.assertEqual(P.decode_time(P.encode_time(t)), t)

    def test_checksum_matches_pyzk(self):
        # CMD_CONNECT with session 0, reply_id 65534 -> known pyzk bytes e8 03 17 fc 00 00 00 00
        self.assertEqual(P.build_packet(P.CMD_CONNECT, 0, P.USHRT_MAX - 1), bytes.fromhex('e80317fc00000000'))

    def test_tcp_frame(self):
        pkt = P.build_packet(P.CMD_EXIT, 5, 1)
        framed = P.tcp_wrap(pkt) + b'\x50'
        self.assertEqual(P.tcp_unwrap(framed), (pkt, b'\x50'))
        self.assertEqual(P.tcp_unwrap(framed[:10]), (None, framed[:10]))

    def test_parse_28_byte_users_and_8_byte_logs(self):
        rec = struct.pack('<HB5s8sIxBhI', 3, 14, b'1', b'Ravi', 0, 1, 0, 42)
        users = P.parse_users(struct.pack('<I', len(rec)) + rec, 1)
        self.assertEqual((users[0].uid, users[0].user_id, users[0].name, users[0].privilege), (3, '42', 'Ravi', 14))
        t = datetime(2026, 1, 2, 3, 4, 5)
        log = struct.pack('<HBIB', 3, 1, P.encode_time(t), 1)
        punches = P.parse_attendance(struct.pack('<I', len(log)) + log, 1, {3: '42'})
        self.assertEqual((punches[0].user_id, punches[0].timestamp, punches[0].punch), ('42', t, 1))

    def test_control_list(self):
        self.assertEqual(_parse_controls('40,01,0000,0000,0a0b; c0,02,0001,0000,8'),
                         [(0x40, 1, 0, 0, b'\x0a\x0b'), (0xC0, 2, 1, 0, 8)])


class FakeDeviceTests(unittest.TestCase):
    def make(self, kind, **kw):
        fake = simulator.FakeDevice(**kw)
        base = datetime(2026, 9, 28, 9, 0, 0)
        for i in range(700):  # 700 x 40 B > 16 KB: forces several chunks
            fake.add_punch('1', base + timedelta(minutes=i), punch=i % 2)
        srv, port = simulator.serve(fake, kind)
        self.addCleanup(srv.server_close)   # cleanups run last-first: shutdown, then close
        self.addCleanup(srv.shutdown)
        t = UdpTransport('127.0.0.1', port) if kind == 'udp' else TcpTransport('127.0.0.1', port)
        return fake, t

    def check(self, kind, **kw):
        fake, t = self.make(kind, **kw)
        with Device(t, password=kw.get('password', 0), chunk_size=16 * 1024) as dev:
            self.assertEqual(dev.serial_number(), 'SIM0000001')
            self.assertTrue(dev.firmware().startswith('Ver 6.60'))
            self.assertEqual(dev.sizes().records, 700)
            sizes, users, punches = dev.read_all()
        self.assertEqual([(u.user_id, u.name) for u in users], [('1', 'Sid')])
        self.assertEqual(len(punches), 700)
        self.assertEqual(punches[-1].timestamp, datetime(2026, 9, 28, 9, 0) + timedelta(minutes=699))
        self.assertTrue(fake.enabled, 'device must be enabled again after reading')
        self.assertEqual(fake.bad_checksums, 0)

    def test_udp(self):
        self.check('udp')

    def test_tcp(self):
        self.check('tcp')

    def test_password(self):
        self.check('udp', password=123456)

    def test_wrong_password(self):
        _, t = self.make('udp', password=123456)
        with self.assertRaises(DeviceError):
            Device(t, password=1).connect()

    def test_direct_data_reply(self):
        fake, t = self.make('udp', direct_data=True)
        with Device(t) as dev:
            self.assertEqual(dev.users()[0].name, 'Sid')


class _Cloud(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.server.requests.append((self.headers.get('Authorization'), body))
        code = 503 if self.server.fail else 200
        self.send_response(code)
        self.end_headers()

    def log_message(self, *a):
        pass


class ServiceTests(unittest.TestCase):
    def test_read_store_upload_and_retry(self):
        fake = simulator.FakeDevice()
        fake.add_punch('1', datetime(2026, 9, 28, 9, 0, 0))
        srv, port = simulator.serve(fake, 'udp')
        self.addCleanup(srv.server_close)
        self.addCleanup(srv.shutdown)
        cloud = HTTPServer(('127.0.0.1', 0), _Cloud)
        cloud.requests, cloud.fail = [], True
        threading.Thread(target=cloud.serve_forever, daemon=True).start()
        self.addCleanup(cloud.server_close)
        self.addCleanup(cloud.shutdown)

        tmp = tempfile.mkdtemp()
        cfg = load_config()
        cfg.read_dict({'device': {'transport': 'udp', 'host': '127.0.0.1', 'port': str(port)},
                       'cloud': {'url': f'http://127.0.0.1:{cloud.server_port}/punches', 'token': 'abc'},
                       'store': {'path': os.path.join(tmp, 'lx50.db')}})
        svc = Service(cfg)
        self.addCleanup(svc.store.close)

        with self.assertLogs('lx50pi.service', 'WARNING'):
            svc.run_once()                                   # cloud down: punch stays in SQLite
        self.assertEqual(svc.store.count_unsent(), 1)

        cloud.fail = False
        fake.add_punch('1', datetime(2026, 9, 28, 18, 0, 0), punch=1)
        svc.run_once()                                       # both punches go up, no duplicates
        self.assertEqual(svc.store.count_unsent(), 0)
        auth, body = cloud.requests[-1]
        self.assertEqual(auth, 'Bearer abc')
        self.assertEqual(body['device']['serial'], 'SIM0000001')
        self.assertEqual([(p['user_id'], p['name'], p['time'], p['state']) for p in body['punches']],
                         [('1', 'Sid', '2026-09-28T09:00:00', 0), ('1', 'Sid', '2026-09-28T18:00:00', 1)])

        n = len(cloud.requests)
        svc.run_once()                                       # nothing new: no read, no upload
        self.assertEqual(len(cloud.requests), n)


def _usbpcap_record(ts, info, addr, ep, kind, data, stage=None):
    hlen = 28 if kind == 2 else 27
    hdr = struct.pack('<HQIHBHHBBI', hlen, 1, 0, 0, info, 1, addr, ep, kind, len(data))
    if kind == 2:
        hdr += bytes([stage])
    pkt = hdr + data
    return struct.pack('<IIII', int(ts), int(ts % 1 * 1e6), len(pkt), len(pkt)) + pkt


class AnalyserTests(unittest.TestCase):
    def test_finds_lx50_and_decodes_packets(self):
        folder = tempfile.mkdtemp()
        t = datetime(2026, 9, 28, 19, 21, 36).timestamp()
        desc = bytes([18, 1, 0, 2, 0xFF, 0, 0, 64]) + struct.pack('<HHH', 0x1B55, 0x0A01, 0x100) + bytes([1, 2, 3, 1])
        connect = P.build_packet(P.CMD_CONNECT, 0, P.USHRT_MAX - 1)
        ack = simulator.reply(P.CMD_ACK_OK, 0x1234, 0)
        with open(os.path.join(folder, 'hub1.pcap'), 'wb') as f:
            f.write(struct.pack('<IHHiIII', 0xA1B2C3D4, 2, 4, 0, 0, 65535, 249))
            f.write(_usbpcap_record(t, 0, 5, 0x80, 2, bytes.fromhex('8006000100001200'), 0))
            f.write(_usbpcap_record(t + .001, 1, 5, 0x80, 2, desc, 3))
            f.write(_usbpcap_record(t + .5, 0, 5, 0x01, 3, connect))
            f.write(_usbpcap_record(t + .6, 1, 5, 0x81, 3, ack))
        with open(os.path.join(folder, 'markers.txt'), 'w') as f:
            f.write('19:21:36.400  +  1.701s  STEP 1 Connect_USB begin\n')
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            usbpcap_dump.main([folder])
        text = out.getvalue()
        self.assertIn('1b55:0a01   <-- LX50', text)
        self.assertIn('STEP 1 Connect_USB begin', text)
        self.assertIn('CMD_CONNECT sess=0x0000 reply=0 chk=pyzk', text)
        self.assertIn('usb_ep_out = 0x01', text)
        self.assertIn('usb_framing = raw', text)


if __name__ == '__main__':
    unittest.main()
