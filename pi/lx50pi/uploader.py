"""Sends buffered punches to the cloud server over HTTPS (standard library only).

Request (the server API is not fixed yet; change here once it is):
    POST <url>
    Authorization: Bearer <token>
    Content-Type: application/json
    {"device": {"serial": "...", "name": "..."},
     "punches": [{"id": 17, "user_id": "1", "name": "Sid", "time": "2026-09-28T09:01:02",
                  "verify": 1, "state": 0}, ...]}
The user list goes to a second URL whenever it changed (users added on the device keypad show up too):
    POST <users_url>   {"device": {...}, "users": [{"user_id": "1", "name": "Sid", "privilege": 0, "card": 0}, ...]}
Any 2xx reply means every punch in the batch was stored. A batch can be sent again after a network error, so the
server should treat (serial, user_id, time) as unique and ignore repeats.
"""
import json
import logging
import ssl
import urllib.error
import urllib.request

log = logging.getLogger(__name__)


class UploadError(Exception):
    pass


class Uploader:
    def __init__(self, url, token='', device_name='', verify_tls=True, timeout=20):
        self.url, self.token, self.device_name = url, token, device_name
        self.timeout = timeout
        self.ctx = None if verify_tls else ssl._create_unverified_context()

    def payload(self, device_sn, rows) -> dict:
        return {
            'device': {'serial': device_sn, 'name': self.device_name},
            'punches': [{'id': r['id'], 'user_id': r['user_id'], 'name': r['name'] or '', 'time': r['ts'],
                         'verify': r['status'], 'state': r['punch']} for r in rows],
        }

    def send(self, device_sn, rows):
        self._post(self.url, self.payload(device_sn, rows))

    def send_users(self, url, device_sn, users):
        self._post(url, {'device': {'serial': device_sn, 'name': self.device_name},
                         'users': [{'user_id': u.user_id, 'name': u.name, 'privilege': u.privilege, 'card': u.card}
                                   for u in users]})

    def _post(self, url, payload):
        body = json.dumps(payload).encode()
        req = urllib.request.Request(url, data=body, method='POST',
                                     headers={'Content-Type': 'application/json'})
        if self.token:
            req.add_header('Authorization', 'Bearer ' + self.token)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=self.ctx) as resp:
                if not 200 <= resp.status < 300:
                    raise UploadError(f'server replied {resp.status}')
        except urllib.error.HTTPError as e:
            raise UploadError(f'server replied {e.code}: {e.read()[:200]!r}')
        except (urllib.error.URLError, OSError) as e:
            raise UploadError(f'cannot reach server: {e}')
