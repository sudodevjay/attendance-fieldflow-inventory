"""ZKTeco device protocol: packets, checksum, time format and record layouts.

This is the protocol the ZKTeco SDK speaks over UDP/TCP (documented by open-source projects such as pyzk and
node-zklib). Whether the LX50 uses the very same packets over USB is not confirmed yet; the USB capture will tell.
Everything here is transport independent.

Packet = 8-byte header + data, all little-endian:
    u16 command, u16 checksum, u16 session_id, u16 reply_id, data...
"""
import struct
from dataclasses import dataclass
from datetime import datetime

USHRT_MAX = 0xFFFF

# Commands
CMD_CONNECT = 1000
CMD_EXIT = 1001
CMD_ENABLEDEVICE = 1002
CMD_DISABLEDEVICE = 1003
CMD_AUTH = 1102
CMD_GET_VERSION = 1100
CMD_OPTIONS_RRQ = 11
CMD_USERTEMP_RRQ = 9
CMD_ATTLOG_RRQ = 13
CMD_GET_FREE_SIZES = 50
CMD_GET_TIME = 201
CMD_PREPARE_DATA = 1500
CMD_DATA = 1501
CMD_FREE_DATA = 1502
CMD_PREPARE_BUFFER = 1503
CMD_READ_BUFFER = 1504

# Replies
CMD_ACK_OK = 2000
CMD_ACK_ERROR = 2001
CMD_ACK_DATA = 2002
CMD_ACK_RETRY = 2003
CMD_ACK_REPEAT = 2004
CMD_ACK_UNAUTH = 2005
CMD_ACK_UNKNOWN = 0xFFFF

FCT_ATTLOG = 1
FCT_USER = 5

COMMAND_NAMES = {v: k for k, v in globals().items() if k.startswith('CMD_') and isinstance(v, int)}

# TCP framing (also a candidate for USB): magic 0x5050 0x7D82 + u32 length, then the packet
TCP_MAGIC = b'\x50\x50\x82\x7d'


def checksum(buf: bytes) -> int:
    """16-bit word sum folded modulo 0xFFFF, then 0xFFFE - sum (same result as pyzk / node-zklib)."""
    s = 0
    for i in range(0, len(buf) - 1, 2):
        s = (s + buf[i] + (buf[i + 1] << 8)) % USHRT_MAX
    if len(buf) % 2:
        s = (s + buf[-1]) % USHRT_MAX
    return USHRT_MAX - s - 1


def build_packet(command: int, session_id: int, reply_id: int, data: bytes = b'') -> bytes:
    """Build a packet. As in pyzk / node-zklib, the checksum covers `reply_id` and the header then carries
    `reply_id + 1`; real devices accept this. Returns the packet; the caller keeps reply_id + 1."""
    chk = checksum(struct.pack('<4H', command, 0, session_id, reply_id) + data)
    return struct.pack('<4H', command, chk, session_id, (reply_id + 1) % USHRT_MAX) + data


@dataclass
class Packet:
    command: int
    checksum: int
    session_id: int
    reply_id: int
    data: bytes

    @property
    def name(self) -> str:
        return COMMAND_NAMES.get(self.command, str(self.command))


def parse_packet(buf: bytes) -> Packet:
    if len(buf) < 8:
        raise ValueError(f'packet too short ({len(buf)} bytes)')
    cmd, chk, sid, rid = struct.unpack('<4H', buf[:8])
    return Packet(cmd, chk, sid, rid, bytes(buf[8:]))


def tcp_wrap(packet: bytes) -> bytes:
    return TCP_MAGIC + struct.pack('<I', len(packet)) + packet


def tcp_unwrap(buf: bytes):
    """Returns (packet, rest) or (None, buf) when the frame is incomplete."""
    if len(buf) < 8:
        return None, buf
    if buf[:4] != TCP_MAGIC:
        raise ValueError('bad TCP frame magic: ' + buf[:4].hex())
    n = struct.unpack('<I', buf[4:8])[0]
    if len(buf) < 8 + n:
        return None, buf
    return bytes(buf[8:8 + n]), bytes(buf[8 + n:])


def make_commkey(password: int, session_id: int, ticks: int = 50) -> bytes:
    """Key for CMD_AUTH when the device has a communication password (pyzk make_commkey)."""
    k = 0
    for i in range(32):
        k = (k << 1 | 1) if password & (1 << i) else k << 1
    k = (k + session_id) & 0xFFFFFFFF
    b = struct.pack('<I', k)
    b = bytes((b[0] ^ ord('Z'), b[1] ^ ord('K'), b[2] ^ ord('S'), b[3] ^ ord('O')))
    b = b[2:4] + b[0:2]  # swap the two 16-bit halves
    t = ticks & 0xFF
    return bytes((b[0] ^ t, b[1] ^ t, t, b[3] ^ t))


# Time: seconds counted in a calendar where every month has 31 days, starting 2000-01-01
def encode_time(t: datetime) -> int:
    return ((((t.year % 100) * 12 * 31 + (t.month - 1) * 31 + t.day - 1) * 86400)
            + (t.hour * 60 + t.minute) * 60 + t.second)


def decode_time(v: int) -> datetime:
    second = v % 60; v //= 60
    minute = v % 60; v //= 60
    hour = v % 24; v //= 24
    day = v % 31 + 1; v //= 31
    month = v % 12 + 1; v //= 12
    return datetime(v + 2000, month, day, hour, minute, second)


@dataclass
class Sizes:
    users: int
    fingers: int
    records: int
    cards: int
    users_cap: int
    fingers_cap: int
    records_cap: int


def parse_sizes(data: bytes) -> Sizes:
    f = struct.unpack('<20i', data[:80])
    return Sizes(users=f[4], fingers=f[6], records=f[8], cards=f[12],
                 fingers_cap=f[14], users_cap=f[15], records_cap=f[16])


@dataclass
class User:
    uid: int          # internal slot number
    user_id: str      # the enrolment number shown on the device ("1" for Sid)
    name: str
    privilege: int
    password: str
    card: int


@dataclass
class Punch:
    user_id: str
    timestamp: datetime
    status: int       # verify mode (fingerprint / password / card)
    punch: int        # in/out state
    uid: int = 0


def _cstr(b: bytes) -> str:
    return b.split(b'\x00')[0].decode('utf-8', errors='replace')


def parse_users(buf: bytes, count: int):
    """`buf` is the full CMD_USERTEMP_RRQ buffer: u32 total size + records (28 or 72 bytes each)."""
    if len(buf) < 4 or count <= 0:
        return []
    total = struct.unpack('<I', buf[:4])[0]
    body = buf[4:4 + total]
    size = total // count
    users = []
    for off in range(0, len(body) - size + 1, size):
        r = body[off:off + size]
        if size == 28:
            uid, priv, pwd, name, card, _grp, _tz, user_id = struct.unpack('<HB5s8sIxBhI', r)
            user_id = str(user_id)
        elif size == 72:
            uid, priv, pwd, name, card, _grp, user_id = struct.unpack('<HB8s24sIx7sx24s', r)
            user_id = _cstr(user_id)
        else:
            raise ValueError(f'unknown user record size {size}')
        users.append(User(uid, user_id, _cstr(name) or f'NN-{user_id}', priv, _cstr(pwd), card))
    return users


def parse_attendance(buf: bytes, count: int, users_by_uid=None):
    """`buf` is the full CMD_ATTLOG_RRQ buffer: u32 total size + records (8, 16 or 40 bytes each)."""
    if len(buf) < 4 or count <= 0:
        return []
    total = struct.unpack('<I', buf[:4])[0]
    body = buf[4:4 + total]
    size = total // count
    users_by_uid = users_by_uid or {}
    out = []
    for off in range(0, len(body) - size + 1, size):
        r = body[off:off + size]
        if size == 8:
            uid, status, ts, punch = struct.unpack('<HBIB', r)
            user_id = users_by_uid.get(uid, str(uid))
        elif size == 16:
            user_id, ts, status, punch, _res, _wc = struct.unpack('<IIBB2sI', r)
            uid, user_id = 0, str(user_id)
        elif size == 40:
            uid, user_id, status, ts, punch, _sp = struct.unpack('<H24sBIB8s', r)
            user_id = _cstr(user_id)
        else:
            raise ValueError(f'unknown attendance record size {size}')
        out.append(Punch(user_id, decode_time(ts), status, punch, uid))
    return out
