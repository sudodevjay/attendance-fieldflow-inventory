"""Local SQLite buffer: punches are kept until the cloud accepts them, so nothing is lost when the internet is down.
Cloud commands (commands.py) are recorded before they run, with their result, until the server has the result."""
import json
import sqlite3
from datetime import datetime

SCHEMA = """
CREATE TABLE IF NOT EXISTS punches (
    id INTEGER PRIMARY KEY,
    device_sn TEXT NOT NULL,
    user_id TEXT NOT NULL,
    ts TEXT NOT NULL,             -- device local time, ISO 8601
    status INTEGER NOT NULL,
    punch INTEGER NOT NULL,
    read_at TEXT NOT NULL,
    sent_at TEXT,
    UNIQUE (device_sn, user_id, ts)
);
CREATE INDEX IF NOT EXISTS punches_unsent ON punches (sent_at) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS users (
    device_sn TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    privilege INTEGER NOT NULL,
    PRIMARY KEY (device_sn, user_id)
);
CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS commands (
    id TEXT PRIMARY KEY,           -- the server's command id
    body TEXT NOT NULL,            -- the command as received (JSON)
    received_at TEXT NOT NULL,
    result TEXT,                   -- JSON sent to the server; NULL while running
    reported_at TEXT
);
"""


class Store:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)

    def close(self):
        self.db.close()

    def add_punches(self, device_sn, punches) -> int:
        """Insert new punches, ignore ones already stored. Returns how many were new."""
        now = datetime.now().isoformat(timespec='seconds')
        before = self.db.total_changes
        with self.db:
            self.db.executemany(
                'INSERT OR IGNORE INTO punches (device_sn, user_id, ts, status, punch, read_at) VALUES (?,?,?,?,?,?)',
                [(device_sn, p.user_id, p.timestamp.isoformat(), p.status, p.punch, now) for p in punches])
        return self.db.total_changes - before

    def set_users(self, device_sn, users):
        with self.db:
            self.db.execute('DELETE FROM users WHERE device_sn = ?', (device_sn,))
            self.db.executemany('INSERT INTO users (device_sn, user_id, name, privilege) VALUES (?,?,?,?)',
                                [(device_sn, u.user_id, u.name, u.privilege) for u in users])

    def unsent(self, limit=500):
        return self.db.execute(
            'SELECT p.*, u.name FROM punches p LEFT JOIN users u ON u.device_sn = p.device_sn AND u.user_id = p.user_id '
            'WHERE p.sent_at IS NULL ORDER BY p.ts, p.id LIMIT ?', (limit,)).fetchall()

    def mark_sent(self, ids):
        now = datetime.now().isoformat(timespec='seconds')
        with self.db:
            self.db.executemany('UPDATE punches SET sent_at = ? WHERE id = ?', [(now, i) for i in ids])

    def count_unsent(self) -> int:
        return self.db.execute('SELECT COUNT(*) FROM punches WHERE sent_at IS NULL').fetchone()[0]

    # ---- cloud commands ----------------------------------------------------------------------------------------
    def claim_command(self, cmd: dict) -> bool:
        """Record a command before it runs. False when it was seen before (never run a command twice)."""
        now = datetime.now().isoformat(timespec='seconds')
        with self.db:
            cur = self.db.execute('INSERT OR IGNORE INTO commands (id, body, received_at) VALUES (?,?,?)',
                                  (str(cmd['id']), json.dumps(cmd), now))
        return cur.rowcount == 1

    def finish_command(self, command_id, result: dict):
        with self.db:
            self.db.execute('UPDATE commands SET result = ? WHERE id = ?', (json.dumps(result), str(command_id)))

    def interrupted_commands(self):
        """Commands claimed but without a result: the Pi stopped (or lost the device) while running them."""
        return [r['id'] for r in self.db.execute('SELECT id FROM commands WHERE result IS NULL')]

    def unreported_results(self):
        return [(r['id'], json.loads(r['result'])) for r in self.db.execute(
            'SELECT id, result FROM commands WHERE result IS NOT NULL AND reported_at IS NULL ORDER BY received_at')]

    def report_again(self, command_id):
        """The server listed a finished command again (it lost the result): send the stored result again."""
        with self.db:
            self.db.execute('UPDATE commands SET reported_at = NULL WHERE id = ? AND result IS NOT NULL',
                            (str(command_id),))

    def mark_reported(self, command_id):
        now = datetime.now().isoformat(timespec='seconds')
        with self.db:
            self.db.execute('UPDATE commands SET reported_at = ? WHERE id = ?', (now, str(command_id)))

    def get(self, key, default=None):
        row = self.db.execute('SELECT value FROM state WHERE key = ?', (key,)).fetchone()
        return row[0] if row else default

    def put(self, key, value):
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)', (key, str(value)))
