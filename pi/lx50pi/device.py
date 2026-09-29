"""Device client: connect, read info, users and punches; add / edit / delete users and start a fingerprint enrolment.
Punches are never written or cleared. Writes use the standard ZKTeco packets (same as pyzk); on the LX50 over USB
they are not confirmed by a capture yet (see NOTES.md)."""
import logging
import struct

from . import protocol as P
from .transport import Transport, TransportError

log = logging.getLogger(__name__)


class DeviceError(Exception):
    pass


def check_user(user_id, name, password='', privilege=P.USER_DEFAULT, card=0):
    """Raise ValueError when a field does not fit the device (checked before anything is sent)."""
    if not user_id or not user_id.isdigit() or len(user_id) > P.MAX_USER_ID:
        raise ValueError(f'user_id must be 1..{P.MAX_USER_ID} digits')
    if not name or len(name.encode()) > P.MAX_NAME:
        raise ValueError(f'name must be 1..{P.MAX_NAME} bytes')
    if len(password) > P.MAX_PASSWORD or not password.isdigit() and password:
        raise ValueError(f'password must be up to {P.MAX_PASSWORD} digits')
    if privilege not in (P.USER_DEFAULT, P.USER_ADMIN):
        raise ValueError(f'privilege must be {P.USER_DEFAULT} (user) or {P.USER_ADMIN} (admin)')
    if not 0 <= card <= 0xFFFFFFFF:
        raise ValueError('card must fit in 32 bits')


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

    # ---- writes ----------------------------------------------------------------------------------------------
    def set_user(self, user_id: str, name: str, password: str = '', privilege: int = P.USER_DEFAULT,
                 card: int = 0) -> P.User:
        """Add the user, or change it if the user id exists (its fingerprints stay). Returns the user as written."""
        check_user(user_id, name, password, privilege, card)
        sizes = self.sizes()
        self.disable()
        try:
            users = self.users(sizes)
            old = next((u for u in users if u.user_id == user_id), None)
            if old:
                uid = old.uid
            else:
                if sizes.users_cap and len(users) >= sizes.users_cap:
                    raise DeviceError(f'device is full ({sizes.users_cap} users)')
                used = {u.uid for u in users}
                uid = next(i for i in range(1, P.USHRT_MAX) if i not in used)
            user = P.User(uid, user_id, name, privilege, password, card)
            self._ok(P.CMD_USER_WRQ, P.pack_user(user))
            self._ok(P.CMD_REFRESHDATA)
        finally:
            self.enable()
        return user

    def delete_user(self, user_id: str) -> bool:
        """Delete the user with its fingerprints. False when the device has no such user."""
        self.disable()
        try:
            old = next((u for u in self.users() if u.user_id == user_id), None)
            if old is None:
                return False
            self._ok(P.CMD_DELETE_USER, struct.pack('<H', old.uid))
            self._ok(P.CMD_REFRESHDATA)
        finally:
            self.enable()
        return True

    def start_enroll(self, user_id: str, finger: int = 0):
        """Put the device in enrolment mode for this user; the person then places the finger on the device
        (3 times). The device stores the template itself. The user must exist."""
        if not 0 <= finger <= 9:
            raise ValueError('finger must be 0..9')
        if not any(u.user_id == user_id for u in self.users()):
            raise DeviceError(f'no user {user_id} on the device')
        self.command(P.CMD_CANCELCAPTURE)
        r = self.command(P.CMD_STARTENROLL, struct.pack('<24sbb', user_id.encode(), finger, 1))
        if r.command == P.CMD_ACK_UNKNOWN:
            # the LX50 (Ver 6.60) answers ACK_UNKNOWN to 61 and 62 in every payload format tried (2026-09-29)
            raise DeviceError('this device cannot start an enrolment remotely: enrol the finger in the device menu')
        if r.command != P.CMD_ACK_OK:
            raise DeviceError(f'enrolment not started: {r.name}')

    def cancel_enroll(self):
        self._ok(P.CMD_CANCELCAPTURE)

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
