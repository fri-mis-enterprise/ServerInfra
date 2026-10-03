import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path


class Store:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / 'monitor.sqlite3'
        with self.connect() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS schedules (
                    id INTEGER PRIMARY KEY, app TEXT NOT NULL, year INTEGER NOT NULL,
                    month INTEGER NOT NULL, recid INTEGER NOT NULL, record_date TEXT NOT NULL,
                    source TEXT NOT NULL, created_at TEXT NOT NULL, closes_at TEXT NOT NULL,
                    state TEXT NOT NULL, error TEXT, updated_at TEXT NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS one_active_month
                ON schedules(app, year, month) WHERE state IN ('pending','active','error');
                CREATE TABLE IF NOT EXISTS observations (
                    app TEXT PRIMARY KEY, checked_at TEXT NOT NULL,
                    successful_at TEXT, rows_json TEXT NOT NULL DEFAULT '[]', error TEXT
                );
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY, schedule_id INTEGER, at TEXT NOT NULL,
                    action TEXT NOT NULL, detail TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, result TEXT NOT NULL);
            ''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            db.execute('PRAGMA busy_timeout=15000')
            with db:
                yield db
        finally:
            db.close()

    @contextmanager
    def operation(self):
        # Cross-process lock covers DBF operations and schedule replacement together.
        import fcntl
        with (self.directory / 'operations.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield

    def active(self):
        with self.connect() as db:
            return [dict(r) for r in db.execute("SELECT * FROM schedules WHERE state IN ('pending','active','error') ORDER BY closes_at,app,year,month")]

    def retire_excluded(self, apps, now):
        """Keep history, but stop processing schedules for removed applications."""
        with self.connect() as db:
            rows = db.execute("SELECT id FROM schedules WHERE state IN ('pending','active','error') AND app NOT IN ({})".format(
                ','.join('?' for _ in apps) or "''"), tuple(apps)).fetchall()
            for row in rows:
                db.execute("UPDATE schedules SET state='excluded',error=NULL,updated_at=? WHERE id=?", (now, row['id']))
                self.event(db, row['id'], now, 'excluded', 'Application removed from monitoring')

    def observations(self):
        with self.connect() as db:
            result = {r['app']: dict(r) for r in db.execute('SELECT * FROM observations')}
        for row in result.values():
            row['rows'] = json.loads(row.pop('rows_json'))
        return result

    def observe(self, app, now, rows=None, error=None):
        with self.connect() as db:
            if error:
                db.execute('''INSERT INTO observations(app,checked_at,error) VALUES(?,?,?)
                    ON CONFLICT(app) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error''', (app, now, error))
            else:
                db.execute('''INSERT INTO observations(app,checked_at,successful_at,rows_json,error) VALUES(?,?,?,?,NULL)
                    ON CONFLICT(app) DO UPDATE SET checked_at=excluded.checked_at,successful_at=excluded.successful_at,
                    rows_json=excluded.rows_json,error=NULL''', (app, now, now, json.dumps(rows)))

    def event(self, db, schedule_id, now, action, detail=''):
        db.execute('INSERT INTO events(schedule_id,at,action,detail) VALUES(?,?,?,?)', (schedule_id, now, action, detail))

    def state(self, schedule_id, now, state, error=None):
        with self.connect() as db:
            previous = db.execute('SELECT state,error FROM schedules WHERE id=?', (schedule_id,)).fetchone()
            db.execute('UPDATE schedules SET state=?,error=?,updated_at=? WHERE id=?', (state, error, now, schedule_id))
            if previous is None or (previous['state'], previous['error']) != (state, error):
                self.event(db, schedule_id, now, state, error or '')

    def close_deadline(self, schedule_id, now):
        with self.connect() as db:
            db.execute("UPDATE schedules SET closes_at=?,updated_at=? WHERE id=? AND state IN ('pending','active','error')",
                       (now, now, schedule_id))
            self.event(db, schedule_id, now, 'close_requested', 'Manual close requested')
