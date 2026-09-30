"""Tests of the Wi-Fi agent (lx50pi/wifi.py) against a fake nmcli.
    python -m unittest discover -s tests -v        (from the pi folder)
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from lx50pi import commands as C  # noqa: E402
from lx50pi import wifi as W  # noqa: E402
from lx50pi.service import load_config  # noqa: E402


def esc(s):
    return s.replace('\\', '\\\\').replace(':', '\\:')


class FakeNmcli:
    """Just enough NetworkManager: profiles (name -> ssid, psk, prio), the active one, networks in range."""

    def __init__(self, profiles, active, networks):
        self.p = {n: dict(v) for n, v in profiles.items()}
        self.active = active
        self.networks = networks  # ssid -> (signal, security, psk or None for an open network)

    def __call__(self, args, timeout=60):
        a = list(args)
        cur = self.p.get(self.active, {}).get('ssid')
        if a[:3] == ['-t', '-f', 'ACTIVE,SSID,SIGNAL']:
            return 0, ''.join(f"{'yes' if s == cur else 'no'}:{esc(s)}:{v[0]}\n" for s, v in self.networks.items()), ''
        if a[:2] == ['-g', 'IP4.ADDRESS']:
            return 0, ('192.168.1.50/24\n' if self.active else ''), ''
        if a[:3] == ['-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY']:
            rows = ''.join(f"{'*' if s == cur else ' '}:{esc(s)}:{v[0]}:{v[1]}\n" for s, v in self.networks.items())
            return 0, rows + ' ::40:WPA2\n', ''  # a hidden network (no name)
        if a[:3] == ['-t', '-f', 'NAME,TYPE,ACTIVE']:
            rows = [f"{esc(n)}:802-11-wireless:{'yes' if n == self.active else 'no'}" for n in self.p]
            return 0, '\n'.join(rows + ['Wired connection 1:802-3-ethernet:no']) + '\n', ''
        if a[:2] == ['-g', '802-11-wireless.ssid']:
            return 0, self.p[a[-1]]['ssid'] + '\n', ''
        if a[:2] == ['con', 'mod']:
            name, opts = a[2], dict(zip(a[3::2], a[4::2]))
            if 'connection.autoconnect-priority' in opts:
                self.p[name]['prio'] = int(opts['connection.autoconnect-priority'])
            if 'connection.id' in opts:
                self.p[opts['connection.id']] = self.p.pop(name)
                if self.active == name:
                    self.active = opts['connection.id']
            return 0, '', ''
        if a[:4] == ['con', 'add', 'type', 'wifi']:
            opts = dict(zip(a[4::2], a[5::2]))
            self.p[opts['con-name']] = {'ssid': opts['ssid'], 'psk': opts.get('wifi-sec.psk'),
                                        'prio': int(opts['connection.autoconnect-priority'])}
            return 0, '', ''
        if a[0] == '--wait' and a[2:4] == ['con', 'up']:
            prof = self.p[a[4]]
            net = self.networks.get(prof['ssid'])
            if not net:
                return 10, '', 'Error: Connection activation failed: No network with SSID found.'
            if net[2] is not None and net[2] != prof.get('psk'):
                return 4, '', 'Error: Connection activation failed: Secrets were required, but not provided.'
            self.active = a[4]
            return 0, '', ''
        if a[:2] == ['con', 'delete']:
            self.p.pop(a[2], None)
            if self.active == a[2]:
                self.active = None
            return 0, '', ''
        raise AssertionError(f'unexpected nmcli {a}')


def office():
    return FakeNmcli(
        {'TP-Link_474C': {'ssid': 'TP-Link_474C', 'psk': '55185295', 'prio': 999},
         'Old office': {'ssid': 'Old office', 'psk': 'oldpass12', 'prio': 50},
         'satyendra': {'ssid': 'satyendra', 'psk': 'hotspot12', 'prio': 100}},
        'TP-Link_474C',
        {'TP-Link_474C': (84, 'WPA1 WPA2', '55185295'), 'Office:5G': (70, 'WPA2', 'secret123'),
         'satyendra': (69, 'WPA2', 'hotspot12'), 'Cafe': (30, '--', None)})


class WifiTests(unittest.TestCase):
    def test_terse_split(self):
        self.assertEqual(W.split_terse(r'*:My\:Net:80:WPA2'), ['*', 'My:Net', '80', 'WPA2'])

    def test_scan_and_current(self):
        nm = W.Nm(run=office())
        nets = nm.scan()
        self.assertEqual(nets[0], {'ssid': 'TP-Link_474C', 'signal': 84, 'security': 'WPA1 WPA2', 'inUse': True})
        self.assertIn('Office:5G', [n['ssid'] for n in nets])
        self.assertNotIn('', [n['ssid'] for n in nets])
        self.assertEqual(nm.current(), {'ssid': 'TP-Link_474C', 'signal': 84, 'ip': '192.168.1.50'})

    def test_connect_keeps_only_the_new_one_and_the_fallback(self):
        f = office()
        self.assertEqual(W.connect(W.Nm(run=f), 'Office:5G', 'secret123', 'satyendra'), {'ssid': 'Office:5G', 'ip': '192.168.1.50'})
        self.assertEqual(sorted(f.p), ['Office:5G', 'satyendra'])
        self.assertEqual(f.active, 'Office:5G')
        self.assertEqual((f.p['Office:5G']['prio'], f.p['satyendra']['prio']), (999, 900))

    def test_wrong_password_rolls_back(self):
        f = office()
        with self.assertRaises(W.NmError) as e:
            W.connect(W.Nm(run=f), 'Office:5G', 'wrongpass', 'satyendra')
        self.assertEqual(str(e.exception), 'wrong Wi-Fi password')
        self.assertEqual(sorted(f.p), ['Old office', 'TP-Link_474C', 'satyendra'])
        self.assertEqual(f.active, 'TP-Link_474C')

    def test_out_of_range_goes_to_the_fallback_when_nothing_else(self):
        f = FakeNmcli({'satyendra': {'ssid': 'satyendra', 'psk': 'hotspot12', 'prio': 100}}, None,
                      {'satyendra': (69, 'WPA2', 'hotspot12')})
        with self.assertRaises(W.NmError) as e:
            W.connect(W.Nm(run=f), 'Far away', 'whatever1', 'satyendra')
        self.assertIn('not found', str(e.exception))
        self.assertEqual(f.active, 'satyendra')
        self.assertEqual(sorted(f.p), ['satyendra'])

    def test_same_network_with_a_new_password(self):
        f = office()
        f.networks['TP-Link_474C'] = (84, 'WPA2', 'newpass99')
        W.connect(W.Nm(run=f), 'TP-Link_474C', 'newpass99', 'satyendra')
        self.assertEqual(sorted(f.p), ['TP-Link_474C', 'satyendra'])
        self.assertEqual(f.p['TP-Link_474C']['psk'], 'newpass99')

    def test_fallback_and_bad_input_refused(self):
        f = office()
        for ssid, pw in (('satyendra', 'hotspot12'), ('', 'x' * 8), ('Office:5G', 'short')):
            with self.assertRaises(W.NmError):
                W.connect(W.Nm(run=f), ssid, pw, 'satyendra')
        self.assertEqual(len(f.p), 3)

    def test_open_network(self):
        f = office()
        W.connect(W.Nm(run=f), 'Cafe', '', 'satyendra')
        self.assertEqual(sorted(f.p), ['Cafe', 'satyendra'])

    def test_keep_two_sets_priorities(self):
        f = office()
        W.keep_two(W.Nm(run=f), 'satyendra')
        self.assertEqual({n: p['prio'] for n, p in f.p.items()}, {'TP-Link_474C': 999, 'Old office': 999, 'satyendra': 900})

    def test_agent_runs_each_command_once_and_reports_after_an_outage(self):
        f = office()
        sent = []

        class Client:
            offline = False

            def _request(self, url, body=None):
                if self.offline:
                    raise C.CommandError('cannot reach server')
                if body is None:
                    self.last_query = url
                    return {'commands': [{'id': '8', 'type': 'wifi_connect', 'ssid': 'Office:5G', 'password': 'secret123'},
                                         {'id': '9', 'type': 'wifi_scan'}]}
                sent.append((url.rsplit('/', 2)[-2], body))
                return {}

        cfg = load_config()
        cfg['cloud']['commands_url'] = 'https://x.example/api/lx50/commands'
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, 's.json')
            client = Client()
            a = W.Agent(cfg, nm=W.Nm(run=f), client=client, hostname='housys', state_file=state)
            self.assertEqual(a.url, 'https://x.example/api/lx50/wifi')
            a.once()
            self.assertIn('pi=housys', client.last_query)
            self.assertIn('fallback=satyendra', client.last_query)
            self.assertEqual([i for i, _ in sent], ['8', '9'])
            self.assertEqual(sent[0][1]['status'], 'done')
            self.assertEqual(sent[1][1]['networks'][0]['ssid'], 'Office:5G')
            a.once()  # listed again by the server: not run twice
            self.assertEqual(len(sent), 2)

            # a result that cannot be sent stays in the state file and goes out when the server is reachable again
            b = W.Agent(cfg, nm=W.Nm(run=f), client=client, hostname='housys', state_file=state)
            b.state['unreported']['9'] = {'status': 'done', 'error': '', 'networks': []}
            b._save()
            client.offline = True
            with self.assertRaises(C.CommandError):
                b.once()
            client.offline = False
            W.Agent(cfg, nm=W.Nm(run=f), client=client, hostname='housys', state_file=state).once()
            self.assertEqual(sent[-1][0], '9')
            self.assertEqual(len(sent), 3)


if __name__ == '__main__':
    unittest.main()
