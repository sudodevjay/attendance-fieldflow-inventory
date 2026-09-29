"""User management from the cloud: the React page puts commands in a queue on the server, the Pi fetches them,
runs them on the LX50 and reports the result. The Pi only makes outgoing HTTPS requests, so it works behind the
office router. The server API is a proposal (like uploader.py); change it here once the server exists.

    GET  <commands_url>?device=<serial>          Authorization: Bearer <token>
         -> {"commands": [{"id": "c1", "type": "set_user", "user_id": "12", "name": "Ravi",
                           "password": "", "privilege": 0, "card": 0},
                          {"id": "c2", "type": "delete_user", "user_id": "12"},
                          {"id": "c3", "type": "enroll_finger", "user_id": "12", "finger": 0}]}
    POST <commands_url>/<id>/result
         {"device": "<serial>", "status": "done" | "failed", "error": "...", "finished": "2026-09-29T10:17:50",
          "user": {"user_id": "12", "name": "Ravi", "privilege": 0, "card": 0}}    (user: set_user only)

Command types: set_user (add, or edit when the user id exists; fingerprints stay), delete_user (with its
fingerprints), enroll_finger (device shows the enrol screen; the person places the finger 3 times).
Every command runs at most once: its id is stored in SQLite before it runs, and its result is kept there until the
server accepted it, so an internet outage never loses or repeats a command. Invalid commands fail without touching
the device. The server should list a command until it received its result.
"""
import json
import logging
import ssl
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

from .device import Device, check_user

log = logging.getLogger(__name__)

TYPES = ('set_user', 'delete_user', 'enroll_finger')


class CommandError(Exception):
    pass


class CommandClient:
    def __init__(self, url, token='', verify_tls=True, timeout=20):
        self.url, self.token, self.timeout = url.rstrip('/'), token, timeout
        self.ctx = None if verify_tls else ssl._create_unverified_context()

    def _request(self, url, body=None):
        req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(),
                                     method='GET' if body is None else 'POST',
                                     headers={'Content-Type': 'application/json'})
        if self.token:
            req.add_header('Authorization', 'Bearer ' + self.token)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=self.ctx) as resp:
                data = resp.read()
        except urllib.error.HTTPError as e:
            raise CommandError(f'server replied {e.code}: {e.read()[:200]!r}')
        except (urllib.error.URLError, OSError) as e:
            raise CommandError(f'cannot reach server: {e}')
        try:
            return json.loads(data) if data.strip() else {}
        except ValueError:
            raise CommandError(f'server sent no JSON: {data[:200]!r}')

    def fetch(self, device_sn) -> list:
        reply = self._request(f'{self.url}?{urllib.parse.urlencode({"device": device_sn})}')
        cmds = reply.get('commands', []) if isinstance(reply, dict) else None
        if not isinstance(cmds, list):
            raise CommandError('reply has no "commands" list')
        return [c for c in cmds if isinstance(c, dict) and c.get('id') not in (None, '')]

    def report(self, command_id, result: dict):
        self._request(f'{self.url}/{urllib.parse.quote(str(command_id), safe="")}/result', result)


def validate(cmd: dict):
    """Raise ValueError for a command that must not reach the device."""
    kind = cmd.get('type')
    if kind not in TYPES:
        raise ValueError(f'unknown command type {kind!r}')
    user_id = cmd.get('user_id')
    if not isinstance(user_id, str):
        raise ValueError('user_id must be a string')
    if kind == 'set_user':
        check_user(user_id, cmd.get('name'), cmd.get('password') or '', _int(cmd, 'privilege'), _int(cmd, 'card'))
    else:
        check_user(user_id, 'x')
    if kind == 'enroll_finger' and not 0 <= _int(cmd, 'finger') <= 9:
        raise ValueError('finger must be 0..9')


def _int(cmd, key):
    v = cmd.get(key) or 0
    if not isinstance(v, int) or isinstance(v, bool):
        raise ValueError(f'{key} must be a number')
    return v


def execute(dev: Device, cmd: dict) -> dict:
    """Run one validated command on a connected device. Returns the extra result fields."""
    kind, user_id = cmd['type'], cmd['user_id']
    if kind == 'set_user':
        u = dev.set_user(user_id, cmd['name'], cmd.get('password') or '', _int(cmd, 'privilege'), _int(cmd, 'card'))
        return {'user': {'user_id': u.user_id, 'name': u.name, 'privilege': u.privilege, 'card': u.card}}
    if kind == 'delete_user':
        existed = dev.delete_user(user_id)
        return {} if existed else {'note': 'user was not on the device'}
    dev.start_enroll(user_id, _int(cmd, 'finger'))
    return {}


def result(device_sn, status, error='', **extra) -> dict:
    out = {'device': device_sn, 'status': status, 'error': error,
           'finished': datetime.now().isoformat(timespec='seconds')}
    out.update(extra)
    return out
