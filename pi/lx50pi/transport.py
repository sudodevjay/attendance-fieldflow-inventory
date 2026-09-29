"""Ways to move protocol packets to the device: USB (the LX50), plus UDP/TCP (used by the simulator and tests).

Each transport sends one packet and receives one packet; framing is hidden inside.
"""
import socket
import time

from . import protocol


class TransportError(Exception):
    pass


class Transport:
    def open(self): ...
    def close(self): ...
    def send(self, packet: bytes): raise NotImplementedError
    def recv(self, timeout: float) -> bytes: raise NotImplementedError

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, *exc):
        self.close()


class UdpTransport(Transport):
    def __init__(self, host, port=4370):
        self.addr = (host, port)
        self.sock = None

    def open(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def close(self):
        if self.sock:
            self.sock.close()
            self.sock = None

    def send(self, packet):
        self.sock.sendto(packet, self.addr)

    def recv(self, timeout):
        self.sock.settimeout(timeout)
        try:
            return self.sock.recv(65535)
        except socket.timeout:
            raise TransportError('timeout waiting for device')


class TcpTransport(Transport):
    def __init__(self, host, port=4370):
        self.addr = (host, port)
        self.sock = None
        self.buf = b''

    def open(self):
        self.sock = socket.create_connection(self.addr, timeout=5)

    def close(self):
        if self.sock:
            self.sock.close()
            self.sock = None

    def send(self, packet):
        self.sock.sendall(protocol.tcp_wrap(packet))

    def recv(self, timeout):
        deadline = time.monotonic() + timeout
        while True:
            pkt, self.buf = protocol.tcp_unwrap(self.buf)
            if pkt is not None:
                return pkt
            left = deadline - time.monotonic()
            if left <= 0:
                raise TransportError('timeout waiting for device')
            self.sock.settimeout(left)
            try:
                chunk = self.sock.recv(65535)
            except socket.timeout:
                raise TransportError('timeout waiting for device')
            if not chunk:
                raise TransportError('device closed the connection')
            self.buf += chunk


ZKUSB_REQ_TYPE = 0x40  # vendor, host to device, recipient device
ZKUSB_SEND = 0xF3      # wValue = length of the packet that follows on bulk OUT
ZKUSB_RECV = 0xF4      # wValue = number of bytes the host reads next on bulk IN


class UsbTransport(Transport):
    """LX50 over USB (VID 1B55, PID 0A01, vendor class FF) through libusb / pyusb.

    Framing, confirmed from the USB capture of 2026-09-29 (captures/20260929_095608):
      * 'zkusb' (the LX50): the packets are the same as over UDP, but every bulk transfer is announced with a
        vendor control request on endpoint 0 (bmRequestType 0x40, wIndex 0, no data stage):
            send:    ctrl 0xF3, wValue = packet length  ->  bulk OUT 0x03: packet
            receive: ctrl 0xF4, wValue = 4              ->  bulk IN 0x82: u32 reply length n
                     ctrl 0xF4, wValue = n              ->  bulk IN 0x82: reply packet
        The SDK waits about 200 ms after a send before asking for the reply (`reply_delay`). Asking earlier
        makes the LX50 stop answering on USB until it is powered off and on (tested 2026-09-29), so the delay
        is never allowed below MIN_REPLY_DELAY.
      * 'raw' = one packet per bulk transfer, 'tcp' = the TCP frame (50 50 82 7D + length) around each packet;
        kept for other models, not used by the LX50.
      * endpoints: first bulk OUT and first bulk IN of interface 0 (overridable)
      * init:      optional control transfers sent after claiming the interface (none needed for the LX50)
                   (list of (bmRequestType, bRequest, wValue, wIndex, data_or_length) tuples)
    """

    MIN_REPLY_DELAY = 0.2

    def __init__(self, vid=0x1B55, pid=0x0A01, framing='zkusb', ep_out=None, ep_in=None,
                 interface=0, configuration=1, init_controls=(), read_size=64 * 1024, reply_delay=0.2):
        self.vid, self.pid = vid, pid
        self.framing = framing
        self.reply_delay = max(reply_delay, self.MIN_REPLY_DELAY)
        self.sent_at = 0.0
        self.ep_out_addr, self.ep_in_addr = ep_out, ep_in
        self.interface, self.configuration = interface, configuration
        self.init_controls = list(init_controls)
        self.read_size = read_size
        self.dev = self.ep_out = self.ep_in = None
        self.buf = b''

    def open(self):
        try:
            import usb.core
            import usb.util
        except ImportError:
            raise TransportError('pyusb is not installed (pip install pyusb)')
        dev = usb.core.find(idVendor=self.vid, idProduct=self.pid)
        if dev is None:
            raise TransportError(f'USB device {self.vid:04x}:{self.pid:04x} not found (cable / power?)')
        try:
            if dev.is_kernel_driver_active(self.interface):
                dev.detach_kernel_driver(self.interface)
        except (NotImplementedError, usb.core.USBError):
            pass  # not supported on this platform, or no kernel driver bound
        try:
            dev.set_configuration(self.configuration)
        except usb.core.USBError as e:
            if getattr(e, 'errno', None) != 16:  # busy = already configured
                raise TransportError(f'set_configuration failed: {e}')
        usb.util.claim_interface(dev, self.interface)
        intf = dev.get_active_configuration()[(self.interface, 0)]

        def pick(addr, direction):
            for ep in intf:
                if addr is not None and ep.bEndpointAddress != addr:
                    continue
                if (usb.util.endpoint_type(ep.bmAttributes) == usb.util.ENDPOINT_TYPE_BULK
                        and usb.util.endpoint_direction(ep.bEndpointAddress) == direction):
                    return ep
            raise TransportError(f'no bulk endpoint {direction:#x} on interface {self.interface}')

        self.ep_out = pick(self.ep_out_addr, usb.util.ENDPOINT_OUT)
        self.ep_in = pick(self.ep_in_addr, usb.util.ENDPOINT_IN)
        self.dev = dev
        for req_type, req, value, index, data in self.init_controls:
            dev.ctrl_transfer(req_type, req, value, index, data, timeout=2000)
        if self.framing != 'zkusb':  # zkusb: the device only sends after a 0xF4 request, nothing to drain
            self._drain()

    def _drain(self):
        """Throw away anything the device still had queued from an earlier session."""
        import usb.core
        for _ in range(8):
            try:
                self.ep_in.read(self.read_size, timeout=50)
            except usb.core.USBError:
                return

    def close(self):
        if self.dev is not None:
            import usb.util
            try:
                usb.util.release_interface(self.dev, self.interface)
            finally:
                usb.util.dispose_resources(self.dev)
                self.dev = None

    def send(self, packet):
        if self.framing == 'zkusb':
            self._zk_control(ZKUSB_SEND, len(packet))
            self.ep_out.write(packet, timeout=5000)
            self.sent_at = time.perf_counter()
            return
        frame = protocol.tcp_wrap(packet) if self.framing == 'tcp' else packet
        self.ep_out.write(frame, timeout=5000)

    def recv(self, timeout):
        if self.framing == 'zkusb':
            return self._zk_recv(timeout)
        import usb.core
        deadline = time.monotonic() + timeout
        while True:
            if self.framing == 'tcp':
                pkt, self.buf = protocol.tcp_unwrap(self.buf)
                if pkt is not None:
                    return pkt
            elif self.buf:
                pkt, self.buf = self.buf, b''
                return pkt
            left_ms = int((deadline - time.monotonic()) * 1000)
            if left_ms <= 0:
                raise TransportError('timeout waiting for device')
            try:
                self.buf += bytes(self.ep_in.read(self.read_size, timeout=left_ms))
            except usb.core.USBTimeoutError:
                raise TransportError('timeout waiting for device')
            except usb.core.USBError as e:
                raise TransportError(f'USB read failed: {e}')

    # ---- zkusb framing ---------------------------------------------------------------------------------------
    def _zk_control(self, request, value):
        import usb.core
        try:
            self.dev.ctrl_transfer(ZKUSB_REQ_TYPE, request, value, 0, None, timeout=2000)
        except usb.core.USBError as e:
            raise TransportError(f'USB control request {request:#x} failed: {e}')

    def _zk_read(self, n, deadline) -> bytes:
        import usb.core
        out = b''
        while len(out) < n:
            left_ms = int((deadline - time.monotonic()) * 1000)
            if left_ms <= 0:
                raise TransportError('timeout waiting for device')
            try:
                out += bytes(self.ep_in.read(n - len(out), timeout=left_ms))
            except usb.core.USBTimeoutError:
                raise TransportError('timeout waiting for device')
            except usb.core.USBError as e:
                raise TransportError(f'USB read failed: {e}')
        return out

    def _zk_recv(self, timeout):
        deadline = time.monotonic() + timeout
        wait = self.sent_at + self.reply_delay - time.perf_counter()
        if wait > 0:
            time.sleep(wait)
        while True:
            self._zk_control(ZKUSB_RECV, 4)
            n = int.from_bytes(self._zk_read(4, deadline), 'little')
            if n:
                break
            if time.monotonic() >= deadline:  # device has nothing yet: ask again shortly
                raise TransportError('timeout waiting for device')
            time.sleep(0.05)
        if n > 0xFFFF:
            raise TransportError(f'implausible reply length {n}')
        self._zk_control(ZKUSB_RECV, n)
        return self._zk_read(n, deadline)


def describe_usb(vid=0x1B55, pid=0x0A01) -> str:
    """Human-readable descriptor dump of the device (for `lx50pi probe`)."""
    try:
        import usb.core
    except ImportError:
        return 'pyusb is not installed (pip install pyusb)'
    dev = usb.core.find(idVendor=vid, idProduct=pid)
    if dev is None:
        return f'USB device {vid:04x}:{pid:04x} not found'
    return str(dev)


def from_config(cfg) -> Transport:
    """Build the transport from the [device] section of the config."""
    kind = cfg.get('transport', 'usb')
    if kind == 'usb':
        return UsbTransport(vid=int(cfg.get('usb_vid', '1b55'), 16), pid=int(cfg.get('usb_pid', '0a01'), 16),
                            framing=cfg.get('usb_framing', 'zkusb'),
                            reply_delay=float(cfg.get('usb_reply_delay', '0.2')),
                            ep_out=_int_or_none(cfg.get('usb_ep_out')), ep_in=_int_or_none(cfg.get('usb_ep_in')),
                            init_controls=_parse_controls(cfg.get('usb_init_controls', '')))
    host, port = cfg.get('host', '127.0.0.1'), int(cfg.get('port', '4370'))
    if kind == 'udp':
        return UdpTransport(host, port)
    if kind == 'tcp':
        return TcpTransport(host, port)
    raise ValueError(f'unknown transport {kind!r}')


def _int_or_none(v):
    return int(v, 0) if v else None


def _parse_controls(text):
    """'40,01,0000,0000,;c0,02,0000,0000,8' -> [(0x40,1,0,0,b''), (0xc0,2,0,0,8)]
    Last field: hex bytes to send (OUT), or a decimal length to read (IN, bmRequestType bit 7 set)."""
    out = []
    for item in filter(None, (s.strip() for s in text.split(';'))):
        rt, rq, val, idx, data = (p.strip() for p in item.split(','))
        rt = int(rt, 16)
        payload = int(data or '0') if rt & 0x80 else bytes.fromhex(data)
        out.append((rt, int(rq, 16), int(val, 16), int(idx, 16), payload))
    return out


