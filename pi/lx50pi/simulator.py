"""A fake ZKTeco device on UDP/TCP, so the client, service and cloud upload can be tested without the LX50.
It answers the same commands the client sends, with 72-byte user records and 40-byte punch records (SSR firmware)."""
import socketserver
import struct
import threading
from datetime import datetime

from . import protocol as P


def reply(cmd, session_id, reply_id, data=b''):
    chk = P.checksum(struct.pack('<4H', cmd, 0, session_id, reply_id) + data)
    return struct.pack('<4H', cmd, chk, session_id, reply_id) + data


class FakeDevice:
    def __init__(self, serial='SIM0000001', firmware='Ver 6.60 May 19 2023', password=0, direct_data=False):
        self.serial, self.firmware, self.password = serial, firmware, password
        self.direct_data = direct_data  # True: small buffers come back as one CMD_DATA reply
        self.users = [P.User(1, '1', 'Sid', 0, '123', 0)]
        self.punches = []
        self.session_id = 0
        self.authed = False
        self.enabled = True
        self.buffer = b''
        self.bad_checksums = 0
        self.lock = threading.Lock()

    def add_punch(self, user_id, when: datetime, status=1, punch=0):
        with self.lock:
            self.punches.append(P.Punch(user_id, when, status, punch))

    # ---- record encoding (inverse of protocol.parse_*) --------------------------------------------------------
    def users_buffer(self):
        body = b''.join(struct.pack('<HB8s24sIx7sx24s', u.uid, u.privilege, u.password.encode(), u.name.encode(),
                                    u.card, b'1', u.user_id.encode()) for u in self.users)
        return struct.pack('<I', len(body)) + body

    def punches_buffer(self):
        uid = {u.user_id: u.uid for u in self.users}
        body = b''.join(struct.pack('<H24sBIB8s', uid.get(p.user_id, 0), p.user_id.encode(), p.status,
                                    P.encode_time(p.timestamp), p.punch, b'') for p in self.punches)
        return struct.pack('<I', len(body)) + body

    def sizes(self):
        f = [0] * 20
        f[4], f[6], f[8], f[14], f[15], f[16] = len(self.users), 1, len(self.punches), 3000, 1000, 100000
        return struct.pack('<20i', *f)

    # ---- request handling -------------------------------------------------------------------------------------
    def handle(self, raw: bytes):
        with self.lock:
            return self._handle(P.parse_packet(raw), raw)

    def _handle(self, p, raw):
        # The client computes the checksum over reply_id - 1 (pyzk quirk); count mismatches for the tests.
        if P.checksum(struct.pack('<4H', p.command, 0, p.session_id, (p.reply_id - 1) % P.USHRT_MAX) + p.data) != p.checksum:
            self.bad_checksums += 1
        sid, rid = self.session_id, p.reply_id
        ok = lambda data=b'': [reply(P.CMD_ACK_OK, sid, rid, data)]

        if p.command == P.CMD_CONNECT:
            self.session_id = sid = 0x1234
            self.authed = not self.password
            return [reply(P.CMD_ACK_OK if self.authed else P.CMD_ACK_UNAUTH, sid, rid)]
        if p.command == P.CMD_AUTH:
            self.authed = p.data == P.make_commkey(self.password, self.session_id)
            return [reply(P.CMD_ACK_OK if self.authed else P.CMD_ACK_UNAUTH, sid, rid)]
        if not self.authed:
            return [reply(P.CMD_ACK_UNAUTH, sid, rid)]
        if p.command == P.CMD_EXIT:
            self.authed = False
            return ok()
        if p.command in (P.CMD_ENABLEDEVICE, P.CMD_DISABLEDEVICE):
            self.enabled = p.command == P.CMD_ENABLEDEVICE
            return ok()
        if p.command == P.CMD_OPTIONS_RRQ:
            name = p.data.split(b'\x00')[0].decode()
            value = {'~SerialNumber': self.serial}.get(name, '')
            return ok(f'{name}={value}\x00'.encode())
        if p.command == P.CMD_GET_VERSION:
            return ok(self.firmware.encode() + b'\x00')
        if p.command == P.CMD_GET_TIME:
            return ok(struct.pack('<I', P.encode_time(datetime.now().replace(microsecond=0))))
        if p.command == P.CMD_GET_FREE_SIZES:
            return ok(self.sizes())
        if p.command == P.CMD_PREPARE_BUFFER:
            _, command, _fct, _ext = struct.unpack('<bhii', p.data[:11])
            self.buffer = self.users_buffer() if command == P.CMD_USERTEMP_RRQ else self.punches_buffer()
            if self.direct_data and len(self.buffer) < 1024:
                return [reply(P.CMD_DATA, sid, rid, self.buffer)]
            return ok(b'\x00' + struct.pack('<I', len(self.buffer)) + b'\x00' * 4)
        if p.command == P.CMD_READ_BUFFER:
            start, size = struct.unpack('<ii', p.data[:8])
            chunk = self.buffer[start:start + size]
            out = [reply(P.CMD_PREPARE_DATA, sid, rid, struct.pack('<I', len(chunk)))]
            out += [reply(P.CMD_DATA, sid, rid, chunk[i:i + 1024]) for i in range(0, len(chunk), 1024)]
            return out + ok()
        if p.command == P.CMD_FREE_DATA:
            self.buffer = b''
            return ok()
        return [reply(P.CMD_ACK_UNKNOWN, sid, rid)]


class _Udp(socketserver.BaseRequestHandler):
    def handle(self):
        data, sock = self.request
        for r in self.server.device.handle(data):
            sock.sendto(r, self.client_address)


class _Tcp(socketserver.BaseRequestHandler):
    def handle(self):
        buf = b''
        while chunk := self.request.recv(65535):
            buf += chunk
            while True:
                pkt, buf = P.tcp_unwrap(buf)
                if pkt is None:
                    break
                for r in self.server.device.handle(pkt):
                    self.request.sendall(P.tcp_wrap(r))


def serve(device: FakeDevice, kind='udp', host='127.0.0.1', port=0):
    """Start the fake device in a background thread. Returns (server, port); call server.shutdown() to stop."""
    cls = socketserver.ThreadingUDPServer if kind == 'udp' else socketserver.ThreadingTCPServer
    cls.allow_reuse_address = True
    srv = cls((host, port), _Udp if kind == 'udp' else _Tcp)
    srv.device = device
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]
