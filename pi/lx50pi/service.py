"""The Pi service. Every cycle: run user commands from the cloud on the LX50 (commands.py), read new punches into
SQLite, push unsent punches (and the user list when it changed) to the cloud. One program, one device connection
at a time, so commands and reading never collide on the USB."""
import configparser
import hashlib
import logging
import time

from . import commands as C
from .device import Device, DeviceError
from .store import Store
from .transport import TransportError, from_config
from .uploader import Uploader, UploadError

log = logging.getLogger(__name__)

DEFAULTS = {
    'device': {'transport': 'usb', 'usb_vid': '1b55', 'usb_pid': '0a01', 'usb_framing': 'zkusb',
               'password': '0', 'timeout': '5', 'chunk_size': '16384'},
    'poll': {'interval_seconds': '15', 'full_read_minutes': '60'},
    'cloud': {'url': '', 'users_url': '', 'commands_url': '', 'token': '', 'device_name': '', 'batch_size': '200',
              'verify_tls': 'yes'},
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
        self.users_url = c['users_url'] if self.uploader else ''
        self.commands = C.CommandClient(c['commands_url'], c['token'], c.getboolean('verify_tls')) \
            if c['commands_url'] else None
        self.users = None  # last user list read from the device
        self.force_full = True  # full read in the next cycle (first cycle, after commands)
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
            due = self.force_full or time.monotonic() - self.last_full >= self.full_every
            if sizes.records == last and not due:
                return 0
            sizes, users, punches = dev.read_all()
        self.store.set_users(self.serial, users)
        self.users = users
        self.force_full = False
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

    def upload_users(self):
        if not (self.users_url and self.users is not None):
            return
        key = repr([(u.user_id, u.name, u.privilege, u.card) for u in self.users])
        digest = hashlib.sha256(key.encode()).hexdigest()
        if digest != self.store.get('users_sent'):
            self.uploader.send_users(self.users_url, self.serial, self.users)
            self.store.put('users_sent', digest)
            log.info('uploaded user list (%d users)', len(self.users))

    # ---- cloud commands --------------------------------------------------------------------------------------
    def report_results(self):
        for cid, res in self.store.unreported_results():
            self.commands.report(cid, res)
            self.store.mark_reported(cid)

    def run_commands(self) -> int:
        '''Fetch, run and report the cloud's commands. Returns how many were run on the device.'''
        if not self.commands:
            return 0
        for cid in self.store.interrupted_commands():  # never run again: it may have reached the device
            self.store.finish_command(cid, C.result(self.serial, 'failed', 'interrupted: the Pi stopped while running it'))
        self.report_results()
        if not self.serial:
            return 0  # first cycle: the device read learns the serial first
        todo = []
        for cmd in self.commands.fetch(self.serial):
            if not self.store.claim_command(cmd):
                self.store.report_again(cmd['id'])
                continue
            try:
                C.validate(cmd)
                todo.append(cmd)
            except ValueError as e:
                self.store.finish_command(cmd['id'], C.result(self.serial, 'failed', f'invalid: {e}'))
        if todo:
            try:
                with make_device(self.cfg) as dev:
                    for cmd in todo:
                        try:
                            res = C.result(self.serial, 'done', **C.execute(dev, cmd))
                        except (DeviceError, ValueError) as e:
                            res = C.result(self.serial, 'failed', str(e))
                        self.store.finish_command(cmd['id'], res)
                        log.info('command %s %s %s: %s %s', cmd['id'], cmd['type'], cmd['user_id'],
                                 res['status'], res['error'])
            finally:
                for cid in self.store.interrupted_commands():  # device unreachable / unplugged mid-way
                    self.store.finish_command(cid, C.result(self.serial, 'failed', 'device not reachable'))
            self.force_full = True  # read the users again in this cycle
        self.report_results()
        return len(todo)

    def run_once(self):
        try:
            self.run_commands()
        except C.CommandError as e:
            log.warning('commands: %s', e)
        except (TransportError, DeviceError, OSError, ValueError) as e:
            log.warning('device (commands): %s', e)
        try:
            self.poll_device()
        except (TransportError, DeviceError, OSError, ValueError) as e:
            log.warning('device: %s', e)
        try:
            self.upload()
            self.upload_users()
        except UploadError as e:
            log.warning('upload: %s (%d waiting)', e, self.store.count_unsent())

    def run_forever(self):
        log.info('service started, polling every %ss', self.interval)
        while True:
            started = time.monotonic()
            self.run_once()
            time.sleep(max(1.0, self.interval - (time.monotonic() - started)))
