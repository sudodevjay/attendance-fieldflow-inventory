"""The Pi service: every few seconds read new punches from the LX50 into SQLite, then push unsent ones to the cloud."""
import configparser
import logging
import time

from .device import Device, DeviceError
from .store import Store
from .transport import TransportError, from_config
from .uploader import Uploader, UploadError

log = logging.getLogger(__name__)

DEFAULTS = {
    'device': {'transport': 'usb', 'usb_vid': '1b55', 'usb_pid': '0a01', 'usb_framing': 'zkusb',
               'password': '0', 'timeout': '5', 'chunk_size': '16384'},
    'poll': {'interval_seconds': '30', 'full_read_minutes': '60'},
    'cloud': {'url': '', 'token': '', 'device_name': '', 'batch_size': '200', 'verify_tls': 'yes'},
    'store': {'path': 'lx50.db'},
}


def load_config(path=None) -> configparser.ConfigParser:
    cfg = configparser.ConfigParser()
    cfg.read_dict(DEFAULTS)
    if path and not cfg.read(path, encoding='utf-8'):
        raise FileNotFoundError(path)
    return cfg


def make_device(cfg) -> Device:
    d = cfg['device']
    return Device(from_config(d), password=int(d['password']), timeout=float(d['timeout']),
                  chunk_size=int(d['chunk_size']))


class Service:
    def __init__(self, cfg):
        self.cfg = cfg
        self.store = Store(cfg['store']['path'])
        c = cfg['cloud']
        self.uploader = Uploader(c['url'], c['token'], c['device_name'], c.getboolean('verify_tls')) if c['url'] else None
        self.batch = int(c['batch_size'])
        self.interval = float(cfg['poll']['interval_seconds'])
        self.full_every = float(cfg['poll']['full_read_minutes']) * 60
        self.last_full = 0.0
        self.serial = self.store.get('serial', '')

    def poll_device(self) -> int:
        """Read the device once. Returns the number of new punches stored."""
        with make_device(self.cfg) as dev:
            if not self.serial:
                self.serial = dev.serial_number()
                self.store.put('serial', self.serial)
            sizes = dev.sizes()
            last = int(self.store.get('records', -1))
            due = time.monotonic() - self.last_full >= self.full_every
            if sizes.records == last and not due:
                return 0
            sizes, users, punches = dev.read_all()
        self.store.set_users(self.serial, users)
        new = self.store.add_punches(self.serial, punches)
        self.store.put('records', sizes.records)
        self.last_full = time.monotonic()
        log.info('device %s: %d users, %d punches on device, %d new', self.serial, len(users), len(punches), new)
        return new

    def upload(self) -> int:
        if not self.uploader:
            return 0
        sent = 0
        while rows := self.store.unsent(self.batch):
            self.uploader.send(self.serial, rows)
            self.store.mark_sent([r['id'] for r in rows])
            sent += len(rows)
        if sent:
            log.info('uploaded %d punches', sent)
        return sent

    def run_once(self):
        try:
            self.poll_device()
        except (TransportError, DeviceError, OSError, ValueError) as e:
            log.warning('device: %s', e)
        try:
            self.upload()
        except UploadError as e:
            log.warning('upload: %s (%d waiting)', e, self.store.count_unsent())

    def run_forever(self):
        log.info('service started, polling every %ss', self.interval)
        while True:
            started = time.monotonic()
            self.run_once()
            time.sleep(max(1.0, self.interval - (time.monotonic() - started)))
