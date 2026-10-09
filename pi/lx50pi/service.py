"""The Pi service. Every cycle: run user commands from the cloud on the LX50 (commands.py), read new punches into
SQLite, push unsent punches (and the user list when it changed) to the cloud. One program, one device connection
at a time, so commands and reading never collide on the USB."""
import configparser
import hashlib
import logging
import time
from datetime import datetime

from . import commands as C
from . import protocol as P
from .device import Device, DeviceError
from .store import Store
from .transport import TransportError, from_config
from .uploader import Uploader, UploadError

log = logging.getLogger(__name__)

DEFAULTS = {
    'device': {'transport': 'usb', 'usb_vid': '1b55', 'usb_pid': '0a01', 'usb_framing': 'zkusb',
               'password': '0', 'timeout': '5', 'chunk_size': '1024'},
    'poll': {'interval_seconds': '15', 'full_read_minutes': '60', 'quiet_seconds': '20', 'max_wait_seconds': '120',
             'disable_while_reading': 'no', 'device_interval_seconds': '60', 'rush_hours': '',
             'enable_on_exit': 'yes', 'all_punches_hours': '24'},
    'cloud': {'url': '', 'users_url': '', 'commands_url': '', 'token': '', 'device_name': '', 'batch_size': '200',
              'verify_tls': 'yes'},
    'store': {'path': 'lx50.db'},
    # Wi-Fi agent (wifi.py): url empty = [cloud] commands_url with /commands -> /wifi
    'wifi': {'url': '', 'interface': 'wlan0', 'fallback_ssid': 'satyendra', 'interval_seconds': '5'},
}


def load_config(path=None) -> configparser.ConfigParser:
    cfg = configparser.ConfigParser()
    cfg.read_dict(DEFAULTS)
    if path and not cfg.read(path, encoding='utf-8'):
        raise FileNotFoundError(path)
    return cfg


def parse_hours(text: str):
    """'09:00-10:30, 17:30-19:30' -> [(540, 630), (1050, 1170)] (minutes after midnight)."""
    spans = []
    for part in filter(None, (p.strip() for p in text.replace(';', ',').split(','))):
        try:
            a, b = (int(h) * 60 + int(m) for h, m in (t.strip().split(':') for t in part.split('-')))
        except ValueError:
            raise ValueError(f'rush_hours: bad span {part!r} (use HH:MM-HH:MM)') from None
        spans.append((a, b))
    return spans


def make_device(cfg) -> Device:
    d = cfg['device']
    return Device(from_config(d), password=int(d['password']), timeout=float(d['timeout']),
                  chunk_size=int(d['chunk_size']), enable_on_exit=cfg['poll'].getboolean('enable_on_exit'))


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
        # Reading ~2,500 punches over USB takes many seconds (0.2 s per packet). A disabled device shows "Working"
        # and drops a finger put on it, so punches are read with the device enabled (disable_while_reading = no),
        # and new punches are read once nobody punched for quiet_seconds (at the latest max_wait_seconds after the
        # first one): at the morning rush the device is not read after every single punch.
        self.quiet = float(cfg['poll']['quiet_seconds'])
        self.max_wait = float(cfg['poll']['max_wait_seconds'])
        self.disable_reads = cfg['poll'].getboolean('disable_while_reading')
        # Every poll is a USB session with the LX50 (connect, serial, counts, exit). On 2026-10-08 the LX50 hung
        # ("Working", no punches) with the Pi polling it every 15 s and worked through the morning rush once the
        # cable was out. So: the device is polled once a minute, and not touched at all in rush_hours (punches
        # stay on the device and are read right after; cloud commands wait in the cloud queue).
        self.device_interval = float(cfg['poll']['device_interval_seconds'])
        self.rush = parse_hours(cfg['poll']['rush_hours'])
        self.in_rush = False
        self.last_poll = None  # time.monotonic() of the last device poll
        self.pending = None  # {'count', 'changed', 'first'}: new punches seen on the device, not read yet
        self.user_count = None  # sizes.users when the users were last read
        self.last_full = 0.0
        self.all_punches_every = float(cfg['poll']['all_punches_hours']) * 3600
        self.last_all_punches = -self.all_punches_every
        self.serial = self.store.get('serial', '')

    def _settled(self, count, now) -> bool:
        """True when the new punch count has stayed the same for `quiet` seconds or was first seen `max_wait` ago."""
        p = self.pending
        if p is None:
            p = self.pending = {'count': count, 'changed': now, 'first': now}
        elif p['count'] != count:
            p['count'], p['changed'] = count, now
        return now - p['changed'] >= self.quiet or now - p['first'] >= self.max_wait

    def poll_device(self) -> int:
        """Read the device once. Returns the number of new punches stored."""
        with make_device(self.cfg) as dev:
            # Read every time: another LX50 on the cable gets its own serial (and a full read) at once.
            sn = dev.serial_number()
            if sn and sn != self.serial:
                if self.serial:
                    log.info('another device on the cable: %s -> %s', self.serial, sn)
                self.serial = sn
                self.store.put('serial', sn)
                self.store.put('records', -1)
                self.store.put('users_sent', '')
                self.force_full = True
            sizes = dev.sizes(P.COUNT_FIELDS)
            now = time.monotonic()
            last = int(self.store.get('records', -1))
            full = (self.force_full or self.users is None or sizes.users != self.user_count
                    or now - self.last_full >= self.full_every)
            if sizes.records == last and not full:
                self.pending = None
                return 0
            if not full and not self._settled(sizes.records, now):
                return 0
            started = time.monotonic()
            if self.disable_reads:
                dev.disable()
            try:
                users = dev.users(sizes) if full else self.users
                # all punches only on the first read / another device / once a day; otherwise just the new ones
                if (self.force_full or last <= 0 or sizes.records < last
                        or now - self.last_all_punches >= self.all_punches_every):
                    punches, what = dev.attendance(sizes, users), 'all'
                    self.last_all_punches = now
                else:
                    punches, what = dev.new_attendance(sizes, last, users), 'new'
            finally:
                if self.disable_reads:
                    dev.enable()
            took = time.monotonic() - started
        if full:
            self.store.set_users(self.serial, users)
            self.users, self.user_count = users, sizes.users
            self.last_full = time.monotonic()
        self.force_full = False
        self.pending = None
        new = self.store.add_punches(self.serial, punches)
        self.store.put('records', sizes.records)
        log.info('device %s: %d users, %d punches on device, %d read, %d new (%s%s punches read in %.1f s)',
                 self.serial, len(users), sizes.records, len(punches), new, 'users + ' if full else '', what, took)
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
                        log.info('command %s %s %s: %s %s', cmd['id'], cmd['type'], cmd.get('user_id', ''),
                                 res['status'], res['error'])
            finally:
                for cid in self.store.interrupted_commands():  # device unreachable / unplugged mid-way
                    self.store.finish_command(cid, C.result(self.serial, 'failed', 'device not reachable'))
            self.force_full = True  # read the users again in this cycle
        self.report_results()
        return len(todo)

    def rush_now(self, now: datetime = None) -> bool:
        now = now or datetime.now()
        m = now.hour * 60 + now.minute
        return any(a <= m < b if a <= b else (m >= a or m < b) for a, b in self.rush)

    def run_once(self, now: datetime = None):
        rush = self.rush_now(now)
        if rush != self.in_rush:
            self.in_rush = rush
            log.info('rush hours: the LX50 is left alone' if rush else 'rush hours over: reading the LX50 again')
        if not rush:
            self.device_cycle()
        try:
            self.upload()
            self.upload_users()
        except UploadError as e:
            log.warning('upload: %s (%d waiting)', e, self.store.count_unsent())

    def device_cycle(self):
        try:
            self.run_commands()
        except C.CommandError as e:
            log.warning('commands: %s', e)
        except (TransportError, DeviceError, OSError, ValueError) as e:
            log.warning('device (commands): %s', e)
        mono = time.monotonic()
        if not (self.force_full or self.last_poll is None or mono - self.last_poll >= self.device_interval):
            return
        self.last_poll = mono
        try:
            self.poll_device()
        except (TransportError, DeviceError, OSError, ValueError) as e:
            log.warning('device: %s', e)

    def run_forever(self):
        log.info('service started, polling every %ss (device every %ss, rush hours: %s)', self.interval,
                 self.device_interval, self.cfg['poll']['rush_hours'] or 'none')
        while True:
            started = time.monotonic()
            self.run_once()
            time.sleep(max(1.0, self.interval - (time.monotonic() - started)))
