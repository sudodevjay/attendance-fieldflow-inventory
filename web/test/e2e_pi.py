"""End-to-end test: web server <-> Raspberry Pi code (pi/lx50pi) <-> fake LX50, on a COPY of the database.

    python web/test/e2e_pi.py            (from the repository root; test PostgreSQL from make_test_db.ps1)

Creates nothing in the real ZkAttendance database. Steps:
  1. web server on port 4001 against the test PostgreSQL database
  2. lx50pi's fake device (simulator, UDP) + one lx50pi service cycle -> punches and the user list reach the server
  3. web "Upload" of an employee -> Pi command -> fake device has the user -> result reported
  4. web "Del(Device)" -> Pi command -> user gone; web "Download user info" merges the Pi's user list
  5. /wifisetup: own password, the Pi's Wi-Fi agent (lx50pi/wifi.py with a fake nmcli) scans and switches networks
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
from lx50pi import wifi as W  # noqa: E402
sys.path.insert(0, os.path.join(ROOT, 'pi', 'tests'))
from test_wifi import office  # noqa: E402

PORT = 4001
BASE = f'http://localhost:{PORT}/api'
CS = os.environ.get('ZK_TEST_DATABASE_URL', 'postgresql://postgres:zkpass@localhost:5433/zkattendance_test')


def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def wcall(method, path, body=None, token=''):
    req = urllib.request.Request(BASE + '/wifisetup' + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {'error': json.loads(e.read()).get('error'), 'status': e.code}


def check(cond, what):
    print(('PASS ' if cond else 'FAIL ') + what)
    if not cond:
        raise SystemExit(1)


def main():
    env = dict(os.environ, PORT=str(PORT), DATABASE_URL=CS, TZ='Asia/Kolkata', WIFI_SETUP_PASSWORD='E2E-wifi-1')
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

        # /wifisetup: page password, then the Pi's Wi-Fi agent scans and switches networks
        check(wcall('POST', '/login', {'password': 'wrong'}).get('status') == 401, 'wifisetup: wrong password refused')
        check(wcall('GET', '/state').get('status') == 401, 'wifisetup: no session = 401')
        wt = wcall('POST', '/login', {'password': 'E2E-wifi-1'})['token']
        nm = office()
        wcfg = load_config()
        wcfg.read_dict({'cloud': {'commands_url': f'http://localhost:{PORT}/api/lx50/commands', 'token': token, 'verify_tls': 'no'},
                        'store': {'path': os.path.join(tmp, 'lx50.db')}})
        agent = W.Agent(wcfg, nm=W.Nm(run=nm), hostname='e2e-pi')
        agent.once()
        st = next((p for p in wcall('GET', '/state', token=wt)['pis'] if p['name'] == 'e2e-pi'), None)
        check(st and st['online'] and st['ssid'] == 'TP-Link_474C' and st['fallback'] == 'satyendra', f'wifisetup: Pi online on its Wi-Fi ({st})')
        sid = wcall('POST', '/scan', {'pi': 'e2e-pi'}, wt)['id']
        agent.once()
        check(wcall('GET', f'/commands/{sid}', token=wt)['status'] == 'done', 'wifisetup: scan done')
        st = next(p for p in wcall('GET', '/state', token=wt)['pis'] if p['name'] == 'e2e-pi')
        check('Office:5G' in [n['ssid'] for n in st['scan']['networks']], 'wifisetup: scanned networks listed')
        check(wcall('POST', '/connect', {'pi': 'e2e-pi', 'ssid': 'satyendra', 'password': 'hotspot12'}, wt).get('status') == 400,
              'wifisetup: the fallback cannot be chosen')
        bad = wcall('POST', '/connect', {'pi': 'e2e-pi', 'ssid': 'Office:5G', 'password': 'wrongpass'}, wt)['id']
        agent.once()
        r = wcall('GET', f'/commands/{bad}', token=wt)
        check(r['status'] == 'failed' and 'wrong Wi-Fi password' in r['error'] and nm.active == 'TP-Link_474C',
              f"wifisetup: wrong Wi-Fi password fails and the Pi stays on its Wi-Fi ({r['error']})")
        cid = wcall('POST', '/connect', {'pi': 'e2e-pi', 'ssid': 'Office:5G', 'password': 'secret123'}, wt)['id']
        agent.once()
        r = wcall('GET', f'/commands/{cid}', token=wt)
        check(r['status'] == 'done' and sorted(nm.p) == ['Office:5G', 'satyendra'] and nm.active == 'Office:5G',
              f'wifisetup: switched; only the new Wi-Fi and the fallback are saved ({sorted(nm.p)})')
        check((nm.p['Office:5G']['prio'], nm.p['satyendra']['prio']) == (999, 900), 'wifisetup: priorities 999 / 900')
        check('secret123' not in json.dumps(r), 'wifisetup: the Wi-Fi password is not kept on the server')
        srv.shutdown()
        print('ALL PASSED')
    finally:
        subprocess.run(f'taskkill /PID {server.pid} /T /F', shell=True, capture_output=True)


if __name__ == '__main__':
    main()
