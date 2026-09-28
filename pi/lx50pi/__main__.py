"""Command line:  python -m lx50pi [-c config.ini] [-v] <command>

  probe      show the USB descriptors of the LX50 (no protocol traffic)
  info       connect and print serial, firmware, device time and counts
  users      print the users on the device
  logs       print the punches on the device
  once       one service cycle: read device -> SQLite -> cloud
  run        the service loop (what systemd starts)
  simulate   run a fake device on UDP/TCP for testing (see --sim-* options)
"""
import argparse
import logging
import sys
import time

from . import simulator, transport
from .service import Service, load_config, make_device


def main(argv=None):
    ap = argparse.ArgumentParser(prog='lx50pi', description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('-c', '--config', help='config file (INI); defaults are used when omitted')
    ap.add_argument('-v', '--verbose', action='store_true', help='log every packet')
    ap.add_argument('command', choices=['probe', 'info', 'users', 'logs', 'once', 'run', 'simulate'])
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
    elif a.command == 'once':
        Service(cfg).run_once()
    elif a.command == 'run':
        Service(cfg).run_forever()
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
