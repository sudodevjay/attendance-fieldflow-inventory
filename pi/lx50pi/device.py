"""Device client: connect, read info, users and punches. READ-ONLY: it never writes or clears anything on the device
(except disabling the keypad while reading, and enabling it again afterwards)."""
import logging
import struct

from . import protocol as P
from .transport import Transport, TransportError

log = logging.getLogger(__name__)


class DeviceError(Exception):
    pass


class Device:
    def __init__(self, transport: Transport, password: int = 0, timeout: float = 5.0, chunk_size: int = 16 * 1024):
        self.t = transport
        self.password = password
        self.timeout = timeout
        self.chunk_size = chunk_size  # pyzk: 16 KB for UDP, 0xFFC0 for TCP; USB value from capture
        self.session_id = 0
        self.reply_id = P.USHRT_MAX - 1  # first packet goes out with reply_id 0
        self.connected = False

    # ---- low level -------------------------------------------------------------------------------------------
    def command(self, cmd: int, data: bytes = b'') -> P.Packet:
        pkt = P.build_packet(cmd, self.session_id, self.reply_id, data)
        self.reply_id = struct.unpack('<H', pkt[6:8])[0]
        log.debug('>> %s %s', P.COMMAND_NAMES.get(cmd, cmd), data.hex())
        self.t.send(pkt)
        return self._recv()

    def _recv(self) -> P.Packet:
        reply = P.parse_packet(self.t.recv(self.timeout))
        self.reply_id = reply.reply_id
        log.debug('<< %s %d bytes', reply.name, len(reply.data))
        return reply

    def _ok(self, cmd, data=b'') -> P.Packet:
        r = self.command(cmd, data)
        if r.command not in (P.CMD_ACK_OK, P.CMD_ACK_DATA, P.CMD_DATA, P.CMD_PREPARE_DATA):
            raise DeviceError(f'{P.COMMAND_NAMES.get(cmd, cmd)} failed: {r.name}')
        return r

    # ---- session ---------------------------------------------------------------------------------------------
    def connect(self):
        self.t.open()
        self.session_id, self.reply_id = 0, P.USHRT_MAX - 1
        r = self.command(P.CMD_CONNECT)
        self.session_id = r.session_id
        if r.command == P.CMD_ACK_UNAUTH:
            r = self.command(P.CMD_AUTH, P.make_commkey(self.password, self.session_id))
        if r.command != P.CMD_ACK_OK:
            self.t.close()
            raise DeviceError(f'connect refused: {r.name}')
        self.connected = True
        log.info('connected, session %d', self.session_id)

    def disconnect(self):
        try:
            if self.connected:
                self.command(P.CMD_EXIT)
        except (TransportError, DeviceError, ValueError):
            pass
        finally:
            self.connected = False
            self.t.close()

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *exc):
        self.disconnect()

    # ---- info ------------------------------------------------------------------------------------------------
    def option(self, name: str) -> str:
        r = self._ok(P.CMD_OPTIONS_RRQ, name.encode() + b'\x00')
        text = r.data.split(b'\x00')[0].decode(errors='replace')
        return text.split('=', 1)[1] if '=' in text else text

    def serial_number(self) -> str:
        return self.option('~SerialNumber')

    def firmware(self) -> str:
        return self._ok(P.CMD_GET_VERSION).data.split(b'\x00')[0].decode(errors='replace')

    def time(self):
        return P.decode_time(struct.unpack('<I', self._ok(P.CMD_GET_TIME).data[:4])[0])

    def sizes(self) -> P.Sizes:
        r = self._ok(P.CMD_GET_FREE_SIZES)
        if len(r.data) >= 80:
            return P.parse_sizes(r.data)
        # The LX50 answers 4 bytes: it wants the field index (same numbering as the 80-byte table) per request,
        # as the SDK does (4 users, 6 fingerprints, 8 punches)
        f = [0] * 20
        for i in P.SIZE_FIELDS:
            f[i] = struct.unpack('<i', self._ok(P.CMD_GET_FREE_SIZES, struct.pack('<I', i)).data[:4])[0]
        return P.parse_sizes(struct.pack('<20i', *f))

    def disable(self):
        self._ok(P.CMD_DISABLEDEVICE)

    def enable(self):
        self._ok(P.CMD_ENABLEDEVICE)

    # ---- bulk data -------------------------------------------------------------------------------------------
    def read_buffer(self, command: int, fct: int = 0, ext: int = 0) -> bytes:
        """Two-step bulk read used for users / logs: prepare a buffer, then read it in chunks, then free it."""
        r = self._ok(P.CMD_PREPARE_BUFFER, struct.pack('<bhii', 1, command, fct, ext))
        if r.command == P.CMD_DATA:  # small result comes back directly
            return r.data
        size = struct.unpack('<I', r.data[1:5])[0]
        out = bytearray()
        start = 0
        while start < size:
            n = min(self.chunk_size, size - start)
            out += self._read_chunk(start, n)
            start += n
        self.command(P.CMD_FREE_DATA)
        return bytes(out)

    def _read_chunk(self, start, size) -> bytes:
        r = self.command(P.CMD_READ_BUFFER, struct.pack('<ii', start, size))
        if r.command == P.CMD_DATA:
            return r.data
        if r.command != P.CMD_PREPARE_DATA:
            raise DeviceError(f'read chunk failed: {r.name}')
        want = struct.unpack('<I', r.data[:4])[0]
        out = bytearray()
        while len(out) < want:
            p = self._recv()
            if p.command != P.CMD_DATA:
                raise DeviceError(f'unexpected {p.name} during chunk')
            out += p.data
        end = self._recv()
        if end.command != P.CMD_ACK_OK:
            raise DeviceError(f'chunk not closed with ACK_OK: {end.name}')
        return bytes(out)

    def users(self, sizes: P.Sizes = None):
        sizes = sizes or self.sizes()
        if sizes.users == 0:
            return []
        return P.parse_users(self.read_buffer(P.CMD_USERTEMP_RRQ, P.FCT_USER), sizes.users)

    def attendance(self, sizes: P.Sizes = None, users=None):
        sizes = sizes or self.sizes()
        if sizes.records == 0:
            return []
        by_uid = {u.uid: u.user_id for u in (users or [])}
        return P.parse_attendance(self.read_buffer(P.CMD_ATTLOG_RRQ), sizes.records, by_uid)

    def read_all(self):
        """Users + punches with the keypad disabled in between (like the SDK does)."""
        sizes = self.sizes()
        self.disable()
        try:
            users = self.users(sizes)
            punches = self.attendance(sizes, users)
        finally:
            self.enable()
        return sizes, users, punches
