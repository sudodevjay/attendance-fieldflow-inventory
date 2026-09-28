#!/bin/sh
# Installs lx50pi on Raspberry Pi OS. Run from the pi folder:  sudo sh deploy/install.sh
set -e
cd "$(dirname "$0")/.."
apt-get install -y python3-venv libusb-1.0-0
id lx50pi >/dev/null 2>&1 || useradd --system --no-create-home --groups plugdev lx50pi
mkdir -p /opt/lx50pi /etc/lx50pi /var/lib/lx50pi
cp -r lx50pi requirements.txt /opt/lx50pi/
python3 -m venv /opt/lx50pi/venv
/opt/lx50pi/venv/bin/pip install -r /opt/lx50pi/requirements.txt
[ -f /etc/lx50pi/config.ini ] || cp deploy/config.example.ini /etc/lx50pi/config.ini
chown -R lx50pi /var/lib/lx50pi
chown root:lx50pi /etc/lx50pi/config.ini && chmod 640 /etc/lx50pi/config.ini
cp deploy/99-lx50.rules /etc/udev/rules.d/ && udevadm control --reload-rules && udevadm trigger
cp deploy/lx50pi.service /etc/systemd/system/ && systemctl daemon-reload
echo "Installed. Edit /etc/lx50pi/config.ini, test with:"
echo "  sudo -u lx50pi /opt/lx50pi/venv/bin/python -m lx50pi -c /etc/lx50pi/config.ini info"
echo "then: sudo systemctl enable --now lx50pi"
