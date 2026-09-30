"""Wi-Fi agent: the /wifisetup page of the web server changes the Pi's Wi-Fi from anywhere.

Runs as root (systemd lx50pi-wifi.service), separate from the LX50 service, and needs NetworkManager (nmcli).
Every few seconds:
    GET <wifi_url>?pi=<hostname>&ssid=<current>&ip=<ip>&signal=<0..100>&fallback=<fallback ssid>
        Authorization: Bearer <token>        -> {"commands": [{"id": "7", "type": "wifi_scan"},
                                                             {"id": "8", "type": "wifi_connect", "ssid": "..", "password": ".."}]}
    POST <wifi_url>/<id>/result  {"status": "done" | "failed", "error": "..", "networks": [...] | "ssid", "ip"}

Only two Wi-Fi profiles stay saved: the network chosen on the page (priority 999, used first) and the fallback
(e.g. the phone hotspot, priority 900, never removed). A new network is tried under a temporary name first; only when
it connects are the older profiles removed. When it does not connect (wrong password, out of range) it is removed and
the Pi goes back to the network it had, else to the fallback. Results are reported once the Pi is online again.
"""
import json
import logging
import os
import re
import socket
import subprocess
import time
import urllib.parse

from .commands import CommandClient, CommandError

log = logging.getLogger(__name__)

MAIN_PRIORITY = 999
FALLBACK_PRIORITY = 900
WIFI_TYPE = '802-11-wireless'


def split_terse(line: str) -> list:
    """nmcli -t line -> fields (':' separates, '\\:' and '\\\\' are escaped)."""
    out, cur, i = [], '', 0
    while i < len(line):
        c = line[i]
        if c == '\\' and i + 1 < len(line):
            cur += line[i + 1]
            i += 2
            continue
        if c == ':':
            out.append(cur)
            cur = ''
        else:
            cur += c
        i += 1
    out.append(cur)
    return out


class NmError(Exception):
    pass


class Nm:
    """The few nmcli calls the agent needs. `run` can be replaced in tests."""

    def __init__(self, interface='wlan0', run=None):
        self.iface = interface
        self.run = run or self._run

    @staticmethod
    def _run(args, timeout=60):
        p = subprocess.run(['nmcli', *args], capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr

    def _ok(self, args, timeout=60):
        code, out, err = self.run(args, timeout)
        if code != 0:
            raise NmError((err or out).strip() or f'nmcli {args[0]} failed ({code})')
        return out

    def current(self) -> dict:
        """{'ssid', 'signal', 'ip'} of the interface ('' / None when not connected)."""
        ssid, signal = '', None
        code, out, _ = self.run(['-t', '-f', 'ACTIVE,SSID,SIGNAL', 'dev', 'wifi', 'list', 'ifname', self.iface, '--rescan', 'no'], 20)
        for line in out.splitlines() if code == 0 else []:
            f = split_terse(line)
            if len(f) >= 3 and f[0] == 'yes':
                ssid, signal = f[1], int(f[2]) if f[2].isdigit() else None
                break
        code, out, _ = self.run(['-g', 'IP4.ADDRESS', 'dev', 'show', self.iface], 20)
        ip = out.strip().split('|')[0].split('/')[0] if code == 0 else ''
        return {'ssid': ssid, 'signal': signal, 'ip': ip}

    def scan(self) -> list:
        """Networks around the Pi, strongest per name: [{'ssid', 'signal', 'security', 'inUse'}]."""
        out = self._ok(['-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY', 'dev', 'wifi', 'list', 'ifname', self.iface, '--rescan', 'yes'], 60)
        best = {}
        for line in out.splitlines():
            f = split_terse(line)
            if len(f) < 4 or not f[1]:
                continue
            n = {'ssid': f[1], 'signal': int(f[2]) if f[2].isdigit() else 0, 'security': f[3], 'inUse': f[0].strip() == '*'}
            old = best.get(n['ssid'])
            if not old or n['inUse'] or (n['signal'] > old['signal'] and not old['inUse']):
                if old and old['inUse']:
                    n['inUse'] = True
                best[n['ssid']] = n
        return sorted(best.values(), key=lambda n: (-n['inUse'], -n['signal']))

    def profiles(self) -> list:
        """Saved Wi-Fi profiles: [{'name', 'ssid', 'active'}]."""
        out = self._ok(['-t', '-f', 'NAME,TYPE,ACTIVE', 'con', 'show'], 20)
        res = []
        for line in out.splitlines():
            f = split_terse(line)
            if len(f) >= 3 and f[1] == WIFI_TYPE:
                ssid = self._ok(['-g', '802-11-wireless.ssid', 'con', 'show', f[0]], 20).strip()
                res.append({'name': f[0], 'ssid': ssid, 'active': f[2] == 'yes'})
        return res

    def set_priority(self, name, prio):
        self._ok(['con', 'mod', name, 'connection.autoconnect', 'yes', 'connection.autoconnect-priority', str(prio)])

    def add(self, name, ssid, password):
        args = ['con', 'add', 'type', 'wifi', 'ifname', self.iface, 'con-name', name, 'ssid', ssid,
                'connection.autoconnect', 'yes', 'connection.autoconnect-priority', str(MAIN_PRIORITY)]
        if password:
            args += ['wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', password]
        self._ok(args)

    def up(self, name, wait=45):
        self._ok(['--wait', str(wait), 'con', 'up', name], wait + 15)

    def delete(self, name):
        self.run(['con', 'delete', name], 30)

    def rename(self, name, new):
        self._ok(['con', 'mod', name, 'connection.id', new])


def friendly(err: str) -> str:
    e = err.lower()
    if 'secrets were required' in e or 'no secrets' in e or 'password' in e or '802-1x' in e:
        return 'wrong Wi-Fi password'
    if 'no network with ssid' in e or 'not found' in e:
        return 'network not found (out of range?)'
    return err[:300]


def keep_two(nm: Nm, fallback: str):
    """Fallback profile(s) at priority 900, every other Wi-Fi profile at 999 (nothing is deleted here)."""
    for p in nm.profiles():
        try:
            nm.set_priority(p['name'], FALLBACK_PRIORITY if p['ssid'] == fallback else MAIN_PRIORITY)
        except NmError as e:
            log.warning('wifi: cannot set priority of %s: %s', p['name'], e)


def connect(nm: Nm, ssid: str, password: str, fallback: str) -> dict:
    """Switch to `ssid`; on success only it and the fallback stay saved. Raises NmError (already rolled back)."""
    if not ssid or len(ssid) > 32:
        raise NmError('invalid network name')
    if ssid == fallback:
        raise NmError(f'{ssid} is the fallback network; it is always kept')
    if password and not 8 <= len(password) <= 63:
        raise NmError('a Wi-Fi password has 8 to 63 characters')
    before = nm.profiles()
    previous = next((p['name'] for p in before if p['active']), None)
    tmp = f'wifisetup-{int(time.time())}'
    nm.add(tmp, ssid, password)
    try:
        nm.up(tmp)
    except NmError as e:
        nm.delete(tmp)
        for name in [previous] + [p['name'] for p in before if p['ssid'] == fallback]:
            if not name:
                continue
            try:
                nm.up(name)
                break
            except NmError:
                continue
        raise NmError(friendly(str(e)))
    for p in before:  # the new one works: forget every other network except the fallback
        if p['ssid'] != fallback:
            nm.delete(p['name'])
    nm.rename(tmp, ssid)
    keep_two(nm, fallback)
    return {'ssid': ssid, 'ip': nm.current()['ip']}


def default_url(cfg) -> str:
    c = cfg['cloud']
    if cfg.has_option('wifi', 'url') and cfg['wifi']['url']:
        return cfg['wifi']['url']
    base = c.get('commands_url', '') or c.get('url', '')
    return re.sub(r'/(commands|punches)/?$', '/wifi', base) if base else ''


class Agent:
    def __init__(self, cfg, nm: Nm = None, client: CommandClient = None, hostname=None, state_file=None):
        w = cfg['wifi'] if cfg.has_section('wifi') else {}
        self.fallback = w.get('fallback_ssid', 'satyendra')
        self.interval = float(w.get('interval_seconds', '5'))
        self.nm = nm or Nm(w.get('interface', 'wlan0'))
        self.url = default_url(cfg).rstrip('/')
        c = cfg['cloud']
        self.client = client or CommandClient(self.url, c.get('token', ''), c.getboolean('verify_tls', True))
        self.name = re.sub(r'[^\w.-]', '', hostname or socket.gethostname())[:40]
        self.state_file = state_file or os.path.join(os.path.dirname(cfg['store']['path']) or '.', 'wifi-agent.json')
        self.state = self._load()
        self.iface = w.get('interface', 'wlan0')
        # The Wi-Fi status is read once a minute (not every poll): asking the Pi 4's Wi-Fi chip too often is avoided.
        self.status_every = float(w.get('status_seconds', '60'))
        self._status, self._status_at = None, -1e9
        # Watchdog: no answer from the server for a while = restart the Wi-Fi, later reload the Wi-Fi driver
        # (the Pi 4's brcmfmac chip can hang: "brcmf_proto_bcdc_query_dcmd ... -110", seen 2026-09-30).
        self.restart_after = float(w.get('restart_wifi_after_seconds', '180'))
        self.reload_after = float(w.get('reload_driver_after_seconds', '600'))
        self.system = self._system
        self.last_ok = time.monotonic()
        self.last_restart = self.last_reload = -1e9

    @staticmethod
    def _system(args, timeout=60):
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr

    def status(self, fresh=False):
        now = time.monotonic()
        if fresh or self._status is None or now - self._status_at >= self.status_every:
            self._status, self._status_at = self.nm.current(), now
        return self._status

    def power_save_off(self):
        """Wi-Fi power saving off (now and for every connection): it makes the Pi's Wi-Fi drop out."""
        conf = '/etc/NetworkManager/conf.d/lx50pi-wifi-powersave.conf'
        try:
            if os.path.isdir(os.path.dirname(conf)) and not os.path.exists(conf):
                with open(conf, 'w', encoding='utf-8') as f:
                    f.write('# lx50pi: Wi-Fi power saving off (2 = disable)\n[connection]\nwifi.powersave = 2\n')
            self.system(['iw', 'dev', self.iface, 'set', 'power_save', 'off'], 20)
        except (OSError, subprocess.SubprocessError) as e:
            log.warning('wifi: power save not turned off: %s', e)

    def watchdog(self, now=None):
        """Called when the server could not be reached. Returns what it did ('' / 'restart' / 'reload')."""
        now = time.monotonic() if now is None else now
        down = now - self.last_ok
        try:
            if down >= self.reload_after and now - self.last_reload >= 900:
                log.warning('wifi: no server for %d s: reloading the Wi-Fi driver', down)
                self.last_reload = self.last_restart = now
                self.system(['modprobe', '-r', 'brcmfmac'], 60)
                self.system(['modprobe', 'brcmfmac'], 60)
                return 'reload'
            if down >= self.restart_after and now - self.last_restart >= 300:
                log.warning('wifi: no server for %d s: restarting the Wi-Fi', down)
                self.last_restart = now
                self.nm.run(['radio', 'wifi', 'off'], 30)
                self.nm.run(['radio', 'wifi', 'on'], 30)
                return 'restart'
        except (OSError, subprocess.SubprocessError) as e:
            log.warning('wifi: watchdog: %s', e)
        return ''

    def _load(self):
        try:
            with open(self.state_file, encoding='utf-8') as f:
                s = json.load(f)
            return {'done': s.get('done', [])[-200:], 'unreported': s.get('unreported', {})}
        except (OSError, ValueError):
            return {'done': [], 'unreported': {}}

    def _save(self):
        try:
            tmp = self.state_file + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(self.state, f)
            os.replace(tmp, self.state_file)
        except OSError as e:
            log.warning('wifi: cannot save %s: %s', self.state_file, e)

    def report(self):
        for cid, res in list(self.state['unreported'].items()):
            self.client._request(f'{self.url}/{cid}/result', res)
            del self.state['unreported'][cid]
            self._save()

    def run_command(self, cmd) -> dict:
        kind = cmd.get('type')
        try:
            if kind == 'wifi_scan':
                return {'status': 'done', 'error': '', 'networks': self.nm.scan(), 'current': self.nm.current()['ssid']}
            if kind == 'wifi_connect':
                r = connect(self.nm, str(cmd.get('ssid') or ''), str(cmd.get('password') or ''), self.fallback)
                return {'status': 'done', 'error': '', **r}
            return {'status': 'failed', 'error': f'unknown command {kind!r}'}
        except (NmError, subprocess.SubprocessError, OSError) as e:
            return {'status': 'failed', 'error': str(e)}

    def once(self):
        self.report()
        cur = self.status()
        q = {'pi': self.name, 'ssid': cur['ssid'], 'ip': cur['ip'], 'signal': '' if cur['signal'] is None else cur['signal'],
             'fallback': self.fallback}
        reply = self.client._request(f'{self.url}?{urllib.parse.urlencode(q)}')
        for cmd in reply.get('commands', []) if isinstance(reply, dict) else []:
            cid = str(cmd.get('id', ''))
            if not cid:
                continue
            if cid in self.state['done']:  # already run (e.g. result lost): report again, never run twice
                continue
            self.state['done'].append(cid)
            self._save()
            log.info('wifi: command %s %s %s', cid, cmd.get('type'), cmd.get('ssid', ''))
            res = self.run_command(cmd)
            log.info('wifi: command %s: %s %s', cid, res['status'], res.get('error', ''))
            self.state['unreported'][cid] = res
            self._save()
            if cmd.get('type') == 'wifi_connect':
                self.status(fresh=True)
        self.report()
        self.last_ok = time.monotonic()

    def run_forever(self):
        if not self.url:
            log.error('wifi: no [cloud] commands_url / url in the config: nothing to do')
            return
        log.info('wifi agent started: %s, fallback %s, every %ss', self.url, self.fallback, self.interval)
        try:
            keep_two(self.nm, self.fallback)
        except NmError as e:
            log.warning('wifi: %s', e)
        self.power_save_off()
        while True:
            try:
                self.once()
            except CommandError as e:
                log.debug('wifi: %s', e)
                self.watchdog()
            except (NmError, subprocess.SubprocessError, OSError) as e:
                log.warning('wifi: %s', e)
                self.watchdog()
            time.sleep(self.interval)
