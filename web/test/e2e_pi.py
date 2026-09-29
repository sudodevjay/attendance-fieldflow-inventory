"""End-to-end test: web server <-> Raspberry Pi code (pi/lx50pi) <-> fake LX50, on a COPY of the database.

    python web/test/e2e_pi.py            (from the repository root; SQL Server with database ZkAttendanceTest)

Creates nothing in the real ZkAttendance database. Steps:
  1. web server on port 4001 against ZkAttendanceTest
  2. lx50pi's fake device (simulator, UDP) + one lx50pi service cycle -> punches and the user list reach the server
  3. web "Upload" of an employee -> Pi command -> fake device has the user -> result reported
  4. web "Del(Device)" -> Pi command -> user gone; web "Download user info" merges the Pi's user list
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'pi'))
from lx50pi import simulator  # noqa: E402
from lx50pi.service import Service, load_config  # noqa: E402

PORT = 4001
BASE = f'http://localhost:{PORT}/api'
CS = ('Driver={ODBC Driver 18 for SQL Server};Server=.\\SQLEXPRESS;Database=ZkAttendanceTest;'
      'Trusted_Connection=yes;TrustServerCertificate=yes;')


def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def check(cond, what):
    print(('PASS ' if cond else 'FAIL ') + what)
    if not cond:
        raise SystemExit(1)


def main():
    env = dict(os.environ, PORT=str(PORT), ZK_CONNECTION_STRING=CS)
    server = subprocess.Popen('npx tsx src/server.ts', cwd=os.path.join(ROOT, 'web', 'server'), env=env, shell=True,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        for _ in range(60):
            try:
                call('GET', '/auth/status')
                break
            except Exception:
                time.sleep(0.5)
        token = call('GET', '/settings/pi')['token']

        fake = simulator.FakeDevice(serial='E2E0000001', lx50=True)
        fake.users = [simulator.P.User(1, '1', 'Sid', 0, '', 0), simulator.P.User(2, '901', 'Device Only', 0, '', 0)]
        from datetime import datetime, timedelta
        base = datetime.now().replace(microsecond=0) - timedelta(hours=2)
        fake.add_punch('1', base)
        fake.add_punch('1', base + timedelta(hours=1), punch=1)
        srv, udp_port = simulator.serve(fake, 'udp')

        tmp = tempfile.mkdtemp()
        cfg = load_config()
        cfg.read_dict({
            'device': {'transport': 'udp', 'host': '127.0.0.1', 'port': str(udp_port)},
            'cloud': {'url': f'http://localhost:{PORT}/api/lx50/punches', 'users_url': f'http://localhost:{PORT}/api/lx50/users',
                      'commands_url': f'http://localhost:{PORT}/api/lx50/commands', 'token': token, 'device_name': 'E2E LX50',
                      'verify_tls': 'no'},
            'store': {'path': os.path.join(tmp, 'lx50.db')},
        })
        pi = Service(cfg)
        pi.run_once()   # learns the serial, reads the device, uploads punches + users
        pi.run_once()   # now also polls commands

        devices = call('GET', '/devices')['devices']
        dev = next((d for d in devices if d['SerialNumber'] == 'E2E0000001'), None)
        check(dev is not None, 'the Pi created / linked its row in the Machine List')
        check(dev['viaPi'] and dev['online'], f"device shows Online via the Pi ({dev['Status']}, {dev['Comm']})")
        check(dev['UserCount'] == 2, 'user count from the Pi user list')
        day = base.strftime('%Y-%m-%d')
        logs = call('GET', f'/logs?from={day}&to={day}&emp=')['rows']
        mine = [r for r in logs if r['EnrollNo'] == '1' and r['Time'] in (base.strftime('%H:%M:%S'), (base + timedelta(hours=1)).strftime('%H:%M:%S'))]
        check(len(mine) == 2, 'both punches are in the AC Log')
        check({r['InOut'] for r in mine} >= {'OUT'} and all(r['Source'] == 'Device' for r in mine), 'source Device, IN/OUT computed')

        # Upload an employee from the web -> Pi command -> fake device
        emp = call('POST', '/employees', {'EnrollNo': '902', 'Name': 'Web Upload', 'DevicePassword': '1234', 'CardNo': '55', 'IsActive': True})
        r = call('POST', '/employees/device/upload', {'ids': [emp['id']], 'deviceId': dev['Id']})
        check('1 user(s) sent' in r['message'], 'upload queued: ' + r['message'].splitlines()[0])
        pi.run_once()
        u = {x.user_id: x for x in fake.users}
        check('902' in u and u['902'].name == 'Web Upload' and u['902'].password == '1234' and u['902'].card == 55,
              'fake device now has user 902 with name, password and card')
        cmds = call('GET', f"/devices/{dev['Id']}/commands")
        check(cmds[0]['Status'] == 'done', f"command result reported: {cmds[0]['What']} = {cmds[0]['Status']}")

        # Delete from device, and download the device-only user into Employees
        call('POST', '/employees/device/delete', {'ids': [emp['id']], 'deviceId': dev['Id']})
        pi.run_once()
        check('902' not in {x.user_id for x in fake.users}, 'Del(Device) removed user 902 from the device')
        pi.run_once()   # user list changed -> uploaded again
        r = call('POST', '/employees/device/download', {'deviceId': dev['Id'], 'overwrite': False})
        check('New: 1' in r['message'], 'Download user info added the device-only user 901')
        names = {e['EnrollNo']: e['Name'] for e in call('GET', '/employees/options')}
        check(names.get('901') == 'Device Only', 'employee 901 "Device Only" exists in the software')

        # "Download attendance logs" -> sync command -> done
        r = call('POST', f"/devices/{dev['Id']}/action", {'action': 'download-logs'})
        pi.run_once()
        check(call('GET', f"/devices/{dev['Id']}/commands")[0]['Status'] == 'done', 'sync command done')

        # Wrong token is refused
        req = urllib.request.Request(BASE + '/lx50/commands?device=E2E0000001', headers={'Authorization': 'Bearer wrong'})
        try:
            urllib.request.urlopen(req, timeout=10)
            check(False, 'wrong Pi token refused')
        except urllib.error.HTTPError as e:
            check(e.code == 401, 'wrong Pi token refused (401)')
        srv.shutdown()
        print('ALL PASSED')
    finally:
        subprocess.run(f'taskkill /PID {server.pid} /T /F', shell=True, capture_output=True)


if __name__ == '__main__':
    main()
