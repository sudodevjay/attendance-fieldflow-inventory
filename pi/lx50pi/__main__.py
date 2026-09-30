"""Command line:  python -m lx50pi [-c config.ini] [-v] <command>

  probe      show the USB descriptors of the LX50 (no protocol traffic)
  info       connect and print serial, firmware, device time and counts
  users      print the users on the device
  logs       print the punches on the device
  setuser    add a user, or edit it when the id exists:  setuser 12 "Ravi Kumar" [--password 1234] [--card 99]
             [--admin]
  deluser    delete a user and its fingerprints:  deluser 12
  enroll     start fingerprint enrolment on the device:  enroll 12 [--finger 0]; the person then places the
             finger on the LX50 three times
  once       one service cycle: read device -> SQLite -> cloud
  run        the service loop (what systemd starts)
  wifi       the Wi-Fi agent for the /wifisetup page (root, systemd lx50pi-wifi.service; see wifi.py)
  simulate   run a fake device on UDP/TCP for testing (see --sim-* options)
"""
import argparse
import logging
import sys
import time

from . import protocol as P
from . import simulator, transport
from .service import Service, load_config, make_device


def main(argv=None):
    ap = argparse.ArgumentParser(prog='lx50pi', description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('-c', '--config', help='config file (INI); defaults are used when omitted')
    ap.add_argument('-v', '--verbose', action='store_true', help='log every packet')
    ap.add_argument('command', choices=['probe', 'info', 'users', 'logs', 'setuser', 'deluser', 'enroll', 'once',
                                        'run', 'wifi', 'simulate'])
    ap.add_argument('user_id', nargs='?', help='setuser / deluser / enroll: the user id (digits)')
    ap.add_argument('name', nargs='?', help='setuser: the name')
    ap.add_argument('--password', default='')
    ap.add_argument('--card', type=int, default=0)
    ap.add_argument('--admin', action='store_true')
    ap.add_argument('--finger', type=int, default=0, help='enroll: finger 0..9')
    ap.add_argument('--sim-kind', choices=['udp', 'tcp'], default='udp')
    ap.add_argument('--sim-port', type=int, default=4370)
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO,
                        format='%(asctime)s %(levelname)s %(name)s: %(message)s')
    cfg = load_config(a.config)

    if a.command == 'probe':
        d = cfg['device']
        print(transport.describe_usb(int(d['usb_vid'], 16), int(d['usb_pid'], 16)))
    elif a.command == 'info':
        with make_device(cfg) as dev:
            s = dev.sizes()
            print('serial   ', dev.serial_number())
            print('firmware ', dev.firmware())
            print('time     ', dev.time())
            print(f'users    {s.users}/{s.users_cap}  fingers {s.fingers}/{s.fingers_cap}  punches {s.records}/{s.records_cap}')
    elif a.command in ('users', 'logs'):
        with make_device(cfg) as dev:
            _, users, punches = dev.read_all()
        if a.command == 'users':
            for u in users:
                print(f'{u.user_id:>8}  {u.name:<24} priv={u.privilege} card={u.card}')
        else:
            for p in punches:
                print(f'{p.user_id:>8}  {p.timestamp:%Y-%m-%d %H:%M:%S}  verify={p.status} state={p.punch}')
    elif a.command in ('setuser', 'deluser', 'enroll'):
        if not a.user_id or (a.command == 'setuser' and not a.name):
            ap.error(f'{a.command} needs a user id' + (' and a name' if a.command == 'setuser' else ''))
        with make_device(cfg) as dev:
            if a.command == 'setuser':
                u = dev.set_user(a.user_id, a.name, a.password, P.USER_ADMIN if a.admin else P.USER_DEFAULT, a.card)
                print(f'saved user {u.user_id} {u.name!r} (slot {u.uid})')
            elif a.command == 'deluser':
                print('deleted' if dev.delete_user(a.user_id) else f'no user {a.user_id} on the device')
            else:
                dev.start_enroll(a.user_id, a.finger)
                print(f'enrolment started for user {a.user_id}, finger {a.finger}: place the finger on the device')
    elif a.command == 'once':
        Service(cfg).run_once()
    elif a.command == 'run':
        Service(cfg).run_forever()
    elif a.command == 'wifi':
        from .wifi import Agent
        Agent(cfg).run_forever()
    elif a.command == 'simulate':
        dev = simulator.FakeDevice()
        from datetime import datetime, timedelta
        now = datetime.now().replace(microsecond=0)
        for i in range(3):
            dev.add_punch('1', now - timedelta(hours=3 - i))
        _, port = simulator.serve(dev, a.sim_kind, '0.0.0.0', a.sim_port)
        print(f'fake device on {a.sim_kind} port {port}; Ctrl+C to stop')
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
