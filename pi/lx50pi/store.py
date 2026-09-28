"""Local SQLite buffer: punches are kept until the cloud accepts them, so nothing is lost when the internet is down."""
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

    def get(self, key, default=None):
        row = self.db.execute('SELECT value FROM state WHERE key = ?', (key,)).fetchone()
        return row[0] if row else default

    def put(self, key, value):
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)', (key, str(value)))
