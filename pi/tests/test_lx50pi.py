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
import time
import unittest
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from lx50pi import protocol as P  # noqa: E402
from lx50pi import commands as C  # noqa: E402
from lx50pi import simulator  # noqa: E402
from lx50pi.device import Device, DeviceError  # noqa: E402
from lx50pi.service import Service, load_config  # noqa: E402
from lx50pi import transport  # noqa: E402
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

    def test_parse_22_byte_logs_from_the_lx50(self):
        # two records from the capture of 2026-09-29 (user 1 with leftover bytes after the id, user 5)
        recs = bytes.fromhex('0100310000000900000030000163353a330000000000'
                             '0500350000000000000000000196953b330000000000')
        punches = P.parse_attendance(struct.pack('<I', len(recs)) + recs, 2)
        self.assertEqual([(p.user_id, p.timestamp, p.status, p.punch) for p in punches],
                         [('1', datetime(2026, 9, 28, 8, 52, 51), 1, 0), ('5', datetime(2026, 9, 29, 9, 55, 34), 1, 0)])

    def test_users_skip_freed_slot(self):
        # after a delete the LX50 reported 7 users but sent 8 records of 72 bytes, the last one all zeros
        rec = struct.pack('<HB8s24sIx7sx24s', 1, 0, b'123', b'Satyendra', 0, b'1', b'1')
        body = rec + b'\x00' * 72
        users = P.parse_users(struct.pack('<I', len(body)) + body, 1)
        self.assertEqual([(u.uid, u.user_id, u.name) for u in users], [(1, '1', 'Satyendra')])

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

    def test_lx50_mode(self):
        self.check('udp', lx50=True)

    def test_add_edit_delete_user_and_enroll(self):
        fake, t = self.make('udp', lx50=True)
        with Device(t) as dev:
            u = dev.set_user('99', 'LX50 Test', '4321', P.USER_DEFAULT, 1234567)
            self.assertEqual(u.uid, 2)                               # first free slot
            dev.set_user('99', 'LX50 Test2')                          # edit keeps the slot
            users = {x.user_id: x for x in dev.users()}
            self.assertEqual((users['99'].uid, users['99'].name, users['99'].password), (2, 'LX50 Test2', ''))
            self.assertEqual(users['1'].name, 'Sid', 'other users untouched')
            dev.start_enroll('99', 6)
            self.assertEqual(fake.enrolling, ('99', 6))
            self.assertTrue(dev.delete_user('99'))
            self.assertEqual(fake.freed_slots, 1, 'buffer now has a zero record, as on the real LX50')
            self.assertFalse(dev.delete_user('99'))
            self.assertEqual([x.user_id for x in dev.users()], ['1'])
            with self.assertRaises(DeviceError):
                dev.start_enroll('99')                                # no such user
        self.assertTrue(fake.enabled)

    def test_bad_user_fields_never_reach_the_device(self):
        fake, t = self.make('udp')
        with Device(t) as dev:
            for args in (('', 'x'), ('12a', 'x'), ('1234567890', 'x'), ('5', ''), ('5', 'x' * 25),
                         ('5', 'x', '123456789'), ('5', 'x', 'abcd'), ('5', 'x', '', 3)):
                with self.assertRaises(ValueError, msg=args):
                    dev.set_user(*args)
        self.assertEqual([u.user_id for u in fake.users], ['1'])

    def test_direct_data_reply(self):
        fake, t = self.make('udp', direct_data=True)
        with Device(t) as dev:
            self.assertEqual(dev.users()[0].name, 'Sid')


class _FakeUsb:
    """pyusb device + endpoints speaking zkusb framing in front of a FakeDevice; checks the request order."""
    def __init__(self, fake, min_delay):
        self.fake, self.min_delay = fake, min_delay
        self.replies, self.announced, self.want, self.sent_at, self.errors = [], None, None, 0.0, []

    def ctrl_transfer(self, rt, req, value, index, data, timeout):
        if (rt, index, data) != (0x40, 0, None):
            self.errors.append(f'bad control {rt:#x} {req:#x} {index} {data}')
        if req == transport.ZKUSB_SEND:
            self.announced = value
        elif req == transport.ZKUSB_RECV:
            if value == 4 and time.perf_counter() - self.sent_at < self.min_delay:
                self.errors.append('reply requested too early')
            self.want = value
        else:
            self.errors.append(f'unknown request {req:#x}')

    def write(self, packet, timeout):  # bulk OUT
        if self.announced != len(packet):
            self.errors.append(f'announced {self.announced}, sent {len(packet)}')
        self.announced = None
        self.replies += self.fake.handle(bytes(packet))
        self.sent_at = time.perf_counter()

    def read(self, n, timeout):  # bulk IN
        if self.want != n:
            self.errors.append(f'read {n} without 0xF4 {n}')
        self.want = None
        if n == 4:
            return struct.pack('<I', len(self.replies[0]))
        return self.replies.pop(0)


class ZkUsbTests(unittest.TestCase):
    def test_framing_against_fake_device(self):
        fake = simulator.FakeDevice(lx50=True)
        fake.add_punch('1', datetime(2026, 9, 29, 9, 55, 29))
        usb = _FakeUsb(fake, 0.02)

        class T(transport.UsbTransport):
            MIN_REPLY_DELAY = 0.02

            def open(self):
                self.dev = self.ep_out = self.ep_in = usb

            def close(self):
                pass

        t = T(reply_delay=0)
        self.assertEqual(t.reply_delay, 0.02, 'delay is never below the minimum')
        with Device(t) as dev:
            self.assertEqual(dev.serial_number(), 'SIM0000001')
            sizes, users, punches = dev.read_all()
        self.assertEqual((sizes.users, sizes.records, sizes.users_cap), (1, 1, 1000))
        self.assertEqual([(p.user_id, p.timestamp) for p in punches], [('1', datetime(2026, 9, 29, 9, 55, 29))])
        self.assertEqual(usb.errors, [])

    def test_default_delay_is_the_sdk_one(self):
        self.assertEqual(transport.UsbTransport(reply_delay=0).reply_delay, 0.2)
        self.assertEqual(transport.from_config({}).framing, 'zkusb')


class _Cloud(BaseHTTPRequestHandler):
    # server.queue: commands listed until their result arrives; server.results: {id: result}
    def do_GET(self):
        if self.server.fail or not self.path.startswith('/commands?'):
            self.send_response(503)
            self.end_headers()
            return
        self.server.gets.append(self.path)
        body = json.dumps({'commands': [c for c in self.server.queue if c['id'] not in self.server.results]}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        code = 503 if self.server.fail else 200
        if code == 200 and self.path.startswith('/commands/') and self.path.endswith('/result'):
            self.server.results[self.path.split('/')[2]] = body
        elif code == 200:
            self.server.requests.append((self.headers.get('Authorization'), body))
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
        cloud = _cloud_server(self)
        cloud.fail = True

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

    def test_another_device_on_the_cable(self):
        # The Pi learnt one LX50; then another one (other serial, same punch count) is plugged in: it is read in full at once.
        tmp = tempfile.mkdtemp()
        cloud = _cloud_server(self)
        first = simulator.FakeDevice(serial='OLD0000001')
        first.add_punch('1', datetime(2026, 9, 28, 9, 0, 0))
        srv, port = simulator.serve(first, 'udp')
        cfg = load_config()
        cfg.read_dict({'device': {'transport': 'udp', 'host': '127.0.0.1', 'port': str(port)},
                       'cloud': {'url': f'http://127.0.0.1:{cloud.server_port}/punches', 'token': 'abc'},
                       'store': {'path': os.path.join(tmp, 'lx50.db')}})
        svc = Service(cfg)
        self.addCleanup(svc.store.close)
        svc.run_once()
        srv.shutdown()
        srv.server_close()
        second = simulator.FakeDevice(serial='NEW0000002')
        second.add_punch('7', datetime(2026, 9, 30, 9, 30, 0))
        srv2, port2 = simulator.serve(second, 'udp')
        self.addCleanup(srv2.server_close)
        self.addCleanup(srv2.shutdown)
        cfg['device']['port'] = str(port2)
        with self.assertLogs('lx50pi.service', 'INFO') as logs:
            svc.run_once()
        self.assertTrue(any('OLD0000001 -> NEW0000002' in m for m in logs.output))
        self.assertEqual(svc.store.get('serial'), 'NEW0000002')
        body = cloud.requests[-1][1]
        self.assertEqual(body['device']['serial'], 'NEW0000002')
        self.assertEqual([p['user_id'] for p in body['punches']], ['7'])


def _cloud_server(test):
    cloud = HTTPServer(('127.0.0.1', 0), _Cloud)
    cloud.requests, cloud.gets, cloud.queue, cloud.results, cloud.fail = [], [], [], {}, False
    threading.Thread(target=cloud.serve_forever, daemon=True).start()
    test.addCleanup(cloud.server_close)
    test.addCleanup(cloud.shutdown)
    return cloud


class CommandTests(unittest.TestCase):
    def setUp(self):
        self.fake = simulator.FakeDevice(lx50=True)
        srv, port = simulator.serve(self.fake, 'udp')
        self.addCleanup(srv.server_close)
        self.addCleanup(srv.shutdown)
        self.cloud = _cloud_server(self)
        base = f'http://127.0.0.1:{self.cloud.server_port}'
        cfg = load_config()
        cfg.read_dict({'device': {'transport': 'udp', 'host': '127.0.0.1', 'port': str(port)},
                       'cloud': {'url': base + '/punches', 'users_url': base + '/users',
                                 'commands_url': base + '/commands', 'token': 'abc'},
                       'store': {'path': os.path.join(tempfile.mkdtemp(), 'lx50.db')}})
        self.svc = Service(cfg)
        self.addCleanup(self.svc.store.close)

    def users_sent(self):
        return [[u['user_id'] for u in b['users']] for _, b in self.cloud.requests if 'users' in b]

    def test_commands_run_once_and_report(self):
        self.svc.run_once()                                   # first cycle learns the serial, sends the users
        self.assertEqual(self.users_sent(), [['1']])
        self.cloud.queue += [
            {'id': 'c1', 'type': 'set_user', 'user_id': '12', 'name': 'Ravi', 'password': '12', 'card': 5},
            {'id': 'c2', 'type': 'enroll_finger', 'user_id': '12', 'finger': 3},
            {'id': 'c3', 'type': 'set_user', 'user_id': 'abc', 'name': 'Bad'},
            {'id': 'c4', 'type': 'format_device', 'user_id': '1'},
            {'id': 'c5', 'type': 'enroll_finger', 'user_id': '77'},
            {'id': 'c7', 'type': 'sync'},
        ]
        self.svc.run_once()
        self.assertIn('device=SIM0000001', self.cloud.gets[-1])
        r = self.cloud.results
        self.assertEqual({k: v['status'] for k, v in r.items()},
                         {'c1': 'done', 'c2': 'done', 'c3': 'failed', 'c4': 'failed', 'c5': 'failed', 'c7': 'done'})
        self.assertEqual(r['c1']['user'], {'user_id': '12', 'name': 'Ravi', 'privilege': 0, 'card': 5})
        self.assertIn('invalid', r['c3']['error'])
        self.assertIn('no user 77', r['c5']['error'])
        self.assertEqual(self.fake.enrolling, ('12', 3))
        self.assertEqual(self.users_sent()[-1], ['1', '12'], 'new user list sent in the same cycle')

        self.cloud.queue.append({'id': 'c6', 'type': 'delete_user', 'user_id': '12'})
        self.cloud.fail = True                                # internet down: result waits in SQLite
        with self.assertLogs('lx50pi.service', 'WARNING'):
            self.svc.run_once()
        self.cloud.fail = False
        self.svc.run_once()
        self.assertEqual(r['c6']['status'], 'done')
        self.assertEqual([u.user_id for u in self.fake.users], ['1'])

    def test_command_seen_again_is_not_run_again(self):
        self.svc.run_once()
        self.cloud.queue.append({'id': 'x1', 'type': 'set_user', 'user_id': '5', 'name': 'Once'})
        self.svc.run_once()
        self.fake.users = [u for u in self.fake.users if u.user_id != '5']  # someone deletes it on the keypad
        del self.cloud.results['x1']                          # server lost the result and lists x1 again
        self.svc.run_once()
        self.assertNotIn('5', [u.user_id for u in self.fake.users])
        self.assertEqual(self.cloud.results['x1']['status'], 'done', 'stored result is sent again')

    def test_validation(self):
        C.validate({'id': 1, 'type': 'set_user', 'user_id': '1', 'name': 'A', 'privilege': P.USER_ADMIN})
        for bad in ({'type': 'set_user', 'user_id': 1, 'name': 'A'},
                    {'type': 'set_user', 'user_id': '1', 'name': 'A', 'card': '5'},
                    {'type': 'set_user', 'user_id': '1', 'name': 'A', 'privilege': True},
                    {'type': 'enroll_finger', 'user_id': '1', 'finger': 10}):
            with self.assertRaises(ValueError, msg=bad):
                C.validate(bad)


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

    def test_finds_lx50_by_zkusb_requests_without_descriptors(self):
        folder = tempfile.mkdtemp()
        t = datetime(2026, 9, 29, 9, 56, 14).timestamp()
        connect = P.build_packet(P.CMD_CONNECT, 0, P.USHRT_MAX - 1)
        ack = simulator.reply(P.CMD_ACK_OK, 0x1234, 0)
        setup = lambda req, n: bytes([0x40, req]) + struct.pack('<HHH', n, 0, 0)
        with open(os.path.join(folder, 'USBPcap1.pcap'), 'wb') as f:
            f.write(struct.pack('<IHHiIII', 0xA1B2C3D4, 2, 4, 0, 0, 65535, 249))
            f.write(_usbpcap_record(t, 0, 2, 0x00, 2, setup(0xF3, len(connect)), 0))
            f.write(_usbpcap_record(t + .001, 0, 255, 0x03, 3, connect))
            f.write(_usbpcap_record(t + .2, 0, 2, 0x00, 2, setup(0xF4, 4), 0))
            f.write(_usbpcap_record(t + .201, 1, 255, 0x82, 3, struct.pack('<I', len(ack))))
            f.write(_usbpcap_record(t + .202, 0, 2, 0x00, 2, setup(0xF4, len(ack)), 0))
            f.write(_usbpcap_record(t + .203, 1, 255, 0x82, 3, ack))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            usbpcap_dump.main([folder])
        text = out.getvalue()
        self.assertIn('0xF3/0xF4 vendor requests   <-- LX50', text)
        self.assertIn('CMD_CONNECT sess=0x0000 reply=0 chk=pyzk', text)
        self.assertIn('usb_ep_out = 0x03', text)
        self.assertIn('usb_ep_in = 0x82', text)
        self.assertIn('usb_framing = zkusb', text)
        self.assertNotIn('usb_init_controls', text)


if __name__ == '__main__':
    unittest.main()
