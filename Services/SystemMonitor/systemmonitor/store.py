import json
import sqlite3
from collections import Counter
from contextlib import contextmanager
from pathlib import Path

_UNSET = object()


class Store:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / 'monitor.sqlite3'
        with self.operation(), self.connect() as db:
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
                CREATE TABLE IF NOT EXISTS fast_observations (
                    station TEXT PRIMARY KEY, checked_at TEXT NOT NULL,
                    successful_at TEXT, summary_json TEXT, error TEXT
                );
                CREATE TABLE IF NOT EXISTS fast_scan (
                    id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL,
                    started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    finished_at TEXT, total INTEGER NOT NULL, processed INTEGER NOT NULL,
                    error TEXT
                );
                CREATE TABLE IF NOT EXISTS fast_actions (
                    id TEXT PRIMARY KEY, station TEXT NOT NULL, period TEXT NOT NULL,
                    action TEXT NOT NULL, actor TEXT NOT NULL, state TEXT NOT NULL,
                    requested_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT,
                    records INTEGER, changed INTEGER
                );
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY, schedule_id INTEGER, at TEXT NOT NULL,
                    action TEXT NOT NULL, detail TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, result TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
                );
                CREATE TABLE IF NOT EXISTS invitations (
                    id INTEGER PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
                    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL, used_by INTEGER, used_at TEXT,
                    revoked_at TEXT
                );
                CREATE TABLE IF NOT EXISTS access_states (
                    app TEXT NOT NULL, recid INTEGER NOT NULL, record_date TEXT NOT NULL,
                    allow_value INTEGER, seen_at TEXT NOT NULL, pending_schedule_id INTEGER,
                    PRIMARY KEY(app,recid,record_date)
                );
            ''')
            fast_columns = {r['name'] for r in db.execute('PRAGMA table_info(fast_scan)')}
            for name in ('station', 'requested_by', 'requested_at'):
                if name not in fast_columns:
                    db.execute(f'ALTER TABLE fast_scan ADD COLUMN {name} TEXT')
            if 'failed' not in fast_columns:
                db.execute('ALTER TABLE fast_scan ADD COLUMN failed INTEGER NOT NULL DEFAULT 0')
            columns = {r['name'] for r in db.execute('PRAGMA table_info(events)')}
            for name, kind in (('actor', 'TEXT'), ('client_ip', 'TEXT'), ('app', 'TEXT'),
                               ('year', 'INTEGER'), ('month', 'INTEGER'), ('recid', 'INTEGER'),
                               ('record_date', 'TEXT'), ('source', 'TEXT')):
                if name not in columns:
                    db.execute(f'ALTER TABLE events ADD COLUMN {name} {kind}')
            db.execute('CREATE INDEX IF NOT EXISTS audit_app ON events(app,id)')
            # Seed baselines from existing observations without inventing historical events.
            for observation in db.execute('SELECT app,successful_at,rows_json FROM observations').fetchall():
                if observation['successful_at']:
                    for row in json.loads(observation['rows_json']):
                        if row['date']:
                            db.execute('''INSERT OR IGNORE INTO access_states(app,recid,record_date,allow_value,seen_at)
                                VALUES(?,?,?,?,?)''', (observation['app'], row['recid'], row['date'],
                                                      row['allow'], observation['successful_at']))

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
        import fcntl
        with (self.directory / 'operations.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield

    def bootstrap_user(self, username, display_name, password_hash, now):
        with self.operation(), self.connect() as db:
            if not db.execute('SELECT 1 FROM users LIMIT 1').fetchone():
                db.execute('INSERT INTO users(username,display_name,password_hash,created_at) VALUES(?,?,?,?)',
                           (username, display_name, password_hash, now))

    def create_invitation(self, token_hash, creator, now, expires):
        with self.connect() as db:
            db.execute('INSERT INTO invitations(token_hash,created_by,created_at,expires_at) VALUES(?,?,?,?)',
                       (token_hash, creator, now, expires))

    def valid_invitation(self, token_hash, now):
        with self.connect() as db:
            return db.execute('''SELECT 1 FROM invitations WHERE token_hash=? AND expires_at>?
                AND used_by IS NULL AND revoked_at IS NULL''', (token_hash, now)).fetchone() is not None

    def invitations(self):
        with self.connect() as db:
            return [dict(r) for r in db.execute('''SELECT i.id,i.created_at,i.expires_at,i.used_at,i.revoked_at,
                u.username AS used_by FROM invitations i LEFT JOIN users u ON u.id=i.used_by ORDER BY i.id DESC LIMIT 100''')]

    def revoke_invitation(self, invitation_id, now):
        with self.connect() as db:
            db.execute('UPDATE invitations SET revoked_at=? WHERE id=? AND used_by IS NULL AND revoked_at IS NULL',
                       (now, invitation_id))

    def create_user(self, username, display_name, password_hash, now, invitation_hash=None):
        with self.connect() as db:
            if invitation_hash is not None:
                # Acquire the write lock before checking; consume and create in one transaction.
                db.execute('BEGIN IMMEDIATE')
                invitation = db.execute('''SELECT id FROM invitations WHERE token_hash=? AND expires_at>?
                    AND used_by IS NULL AND revoked_at IS NULL''', (invitation_hash, now)).fetchone()
                if invitation is None:
                    raise ValueError('This invitation is invalid, expired, or already used.')
            result = db.execute('INSERT INTO users(username,display_name,password_hash,created_at) VALUES(?,?,?,?)',
                                (username, display_name, password_hash, now))
            if invitation_hash is not None:
                db.execute('UPDATE invitations SET used_by=?,used_at=? WHERE id=?',
                           (result.lastrowid, now, invitation['id']))
            return result.lastrowid

    def user(self, user_id):
        if type(user_id) is not int:
            return None
        with self.connect() as db:
            row = db.execute('SELECT id,username,display_name FROM users WHERE id=? AND active=1', (user_id,)).fetchone()
            return dict(row) if row else None

    def login_user(self, username):
        with self.connect() as db:
            row = db.execute('SELECT * FROM users WHERE username=? AND active=1', (username,)).fetchone()
            return dict(row) if row else None

    def active(self):
        with self.connect() as db:
            return [dict(r) for r in db.execute("SELECT * FROM schedules WHERE state IN ('pending','active','error') ORDER BY closes_at,app,year,month")]

    def retire_excluded(self, apps, now):
        with self.connect() as db:
            rows = db.execute("SELECT id FROM schedules WHERE state IN ('pending','active','error') AND app NOT IN ({})".format(
                ','.join('?' for _ in apps) or "''"), tuple(apps)).fetchall()
            for row in rows:
                db.execute("UPDATE schedules SET state='excluded',error=NULL,updated_at=? WHERE id=?", (now, row['id']))
                self.event(db, row['id'], now, 'excluded', 'Application removed from monitoring', actor={'username': 'System'})

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

    def fast_observations(self):
        with self.connect() as db:
            rows = [dict(r) for r in db.execute('SELECT * FROM fast_observations ORDER BY station')]
        for row in rows:
            row['summary'] = json.loads(row.pop('summary_json') or 'null')
        return rows

    def fast_prepare(self, stations, now):
        with self.connect() as db:
            db.executemany('INSERT OR IGNORE INTO fast_observations(station,checked_at) VALUES(?,?)',
                           [(station, now) for station in stations])

    def fast_observe(self, station, now, summary=None, error=None):
        with self.connect() as db:
            if error:
                db.execute('''INSERT INTO fast_observations(station,checked_at,error) VALUES(?,?,?)
                    ON CONFLICT(station) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error''',
                           (station, now, error))
            else:
                db.execute('''INSERT INTO fast_observations(station,checked_at,successful_at,summary_json)
                    VALUES(?,?,?,?) ON CONFLICT(station) DO UPDATE SET checked_at=excluded.checked_at,
                    successful_at=excluded.successful_at,summary_json=excluded.summary_json,error=NULL''',
                           (station, now, now, json.dumps(summary)))

    def fast_scan(self):
        with self.connect() as db:
            row = db.execute('SELECT * FROM fast_scan WHERE id=1').fetchone()
            return dict(row) if row else None

    def fast_start(self, total, now):
        with self.connect() as db:
            db.execute('''INSERT INTO fast_scan(id,state,started_at,updated_at,finished_at,total,processed,error)
                VALUES(1,'scanning',?,?,NULL,?,0,NULL)
                ON CONFLICT(id) DO UPDATE SET state='scanning',started_at=excluded.started_at,
                updated_at=excluded.updated_at,finished_at=NULL,total=excluded.total,processed=0,failed=0,error=NULL''',
                       (now, now, total))

    def request_fast_scan(self, station, now, username):
        """One durable request at a time; repeated requests for the same scope coalesce."""
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute("SELECT 1 FROM fast_actions WHERE state IN ('queued','running','needs_recovery')").fetchone():
                raise ValueError('Finish or resume the current FAST operation before scanning.')
            current = db.execute('SELECT * FROM fast_scan WHERE id=1').fetchone()
            if current and current['state'] in ('queued', 'scanning'):
                if current['station'] != station:
                    raise ValueError('A FAST scan is already queued or running. Wait for it to finish.')
                return dict(current)
            db.execute('''INSERT INTO fast_scan(id,state,started_at,updated_at,total,processed,
                station,requested_by,requested_at) VALUES(1,'queued',?,?,0,0,?,?,?)
                ON CONFLICT(id) DO UPDATE SET state='queued',started_at=excluded.started_at,
                updated_at=excluded.updated_at,finished_at=NULL,total=0,processed=0,failed=0,error=NULL,
                station=excluded.station,requested_by=excluded.requested_by,requested_at=excluded.requested_at''',
                       (now, now, station, username, now))
            return dict(db.execute('SELECT * FROM fast_scan WHERE id=1').fetchone())

    def claim_fast_scan(self, now):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            current = db.execute("SELECT * FROM fast_scan WHERE id=1 AND state='queued'").fetchone()
            if current is None:
                return None
            db.execute("UPDATE fast_scan SET state='scanning',started_at=?,updated_at=? WHERE id=1", (now, now))
            return dict(db.execute('SELECT * FROM fast_scan WHERE id=1').fetchone())

    def interrupt_fast_scan(self, now):
        with self.connect() as db:
            db.execute("""UPDATE fast_scan SET state='interrupted',updated_at=?,finished_at=?,
                error='Worker stopped before the scan finished. Request another scan.'
                WHERE id=1 AND state='scanning'""", (now, now))

    def fast_progress(self, now, failed=False):
        with self.connect() as db:
            db.execute('UPDATE fast_scan SET processed=processed+1,failed=failed+?,updated_at=? WHERE id=1', (int(failed), now))

    def fast_finish(self, now, error=None, state='completed'):
        with self.connect() as db:
            db.execute('UPDATE fast_scan SET state=?,updated_at=?,finished_at=?,error=? WHERE id=1',
                       (state, now, now, error))

    def fast_actions(self):
        with self.connect() as db:
            return [dict(r) for r in db.execute('SELECT * FROM fast_actions ORDER BY rowid DESC LIMIT 20')]

    def request_fast_action(self, job_id, station, period, action, actor, now):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            existing = db.execute('SELECT * FROM fast_actions WHERE id=?', (job_id,)).fetchone()
            if existing:
                if (existing['station'], existing['period'], existing['action'], existing['actor']) != (station, period, action, actor):
                    raise ValueError('Request identifier is already used for another operation.')
                return dict(existing)
            if db.execute("SELECT 1 FROM fast_actions WHERE state IN ('queued','running','needs_recovery')").fetchone():
                raise ValueError('Finish or resume the current FAST operation first.')
            scan = db.execute("SELECT 1 FROM fast_scan WHERE state IN ('queued','scanning')").fetchone()
            if scan:
                raise ValueError('Wait for the FAST scan to finish before changing a period.')
            db.execute('INSERT INTO fast_actions(id,station,period,action,actor,state,requested_at,updated_at) VALUES(?,?,?,?,?,\'queued\',?,?)',
                       (job_id, station, period, action, actor, now, now))
            return dict(db.execute('SELECT * FROM fast_actions WHERE id=?', (job_id,)).fetchone())

    def resume_fast_action(self, job_id, now):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM fast_actions WHERE id=?', (job_id,)).fetchone()
            if not row or row['state'] != 'needs_recovery':
                raise ValueError('Choose an operation that needs recovery.')
            if db.execute("SELECT 1 FROM fast_scan WHERE state IN ('queued','scanning')").fetchone():
                raise ValueError('Wait for the FAST scan to finish before resuming recovery.')
            db.execute("UPDATE fast_actions SET state='queued',updated_at=?,error=NULL WHERE id=?", (now, job_id))
            return dict(db.execute('SELECT * FROM fast_actions WHERE id=?', (job_id,)).fetchone())

    def claim_fast_action(self, now):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute("SELECT * FROM fast_actions WHERE state='queued' LIMIT 1").fetchone()
            if row is None:
                return None
            db.execute("UPDATE fast_actions SET state='running',updated_at=? WHERE id=?", (now, row['id']))
            return dict(db.execute('SELECT * FROM fast_actions WHERE id=?', (row['id'],)).fetchone())

    def fast_action_state(self, job_id, state, now, error=None, records=None, changed=None):
        with self.connect() as db:
            db.execute('UPDATE fast_actions SET state=?,updated_at=?,error=?,records=COALESCE(?,records),changed=COALESCE(?,changed) WHERE id=?',
                       (state, now, error, records, changed, job_id))

    def interrupt_fast_actions(self, now):
        with self.connect() as db:
            db.execute("UPDATE fast_actions SET state='needs_recovery',updated_at=?,error='Worker stopped. Resume manually to verify and finish.' WHERE state='running'", (now,))

    def complete_fast_action(self, job, summary, records, changed, now):
        # Publish the verified cache and audit outcome in the same transaction.
        with self.connect() as db:
            db.execute('UPDATE fast_observations SET checked_at=?,successful_at=?,summary_json=?,error=NULL WHERE station=?',
                       (now, now, json.dumps(summary), job['station']))
            db.execute("UPDATE fast_actions SET state='completed',updated_at=?,error=NULL,records=?,changed=? WHERE id=?",
                       (now, records, changed, job['id']))

    def event(self, db, schedule_id, now, action, detail='', actor=None, record=None):
        actor = actor or {}
        if record is None and schedule_id is not None:
            record = db.execute('SELECT app,year,month,recid,record_date,source FROM schedules WHERE id=?', (schedule_id,)).fetchone()
        record = dict(record or {})
        db.execute('''INSERT INTO events(schedule_id,at,action,detail,actor,client_ip,app,year,month,recid,record_date,source)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)''', (schedule_id, now, action, detail, actor.get('username'), actor.get('client_ip'),
                record.get('app'), record.get('year'), record.get('month'), record.get('recid'), record.get('record_date'), record.get('source')))

    def access(self, db, app, row, now, pending=None):
        db.execute('''INSERT INTO access_states(app,recid,record_date,allow_value,seen_at,pending_schedule_id)
            VALUES(?,?,?,?,?,?) ON CONFLICT(app,recid,record_date) DO UPDATE SET
            allow_value=excluded.allow_value,seen_at=excluded.seen_at,pending_schedule_id=excluded.pending_schedule_id''',
            (app, row['recid'], row['date'], row['allow'], now, pending))

    def observe_access(self, app, rows, now):
        months = Counter(r['date'][:7] for r in rows if r['date'])
        identifiers = Counter(r['recid'] for r in rows)
        with self.connect() as db:
            for row in rows:
                if not row['date'] or months[row['date'][:7]] != 1 or identifiers[row['recid']] != 1:
                    continue
                prior = db.execute('SELECT * FROM access_states WHERE app=? AND recid=? AND record_date=?',
                                   (app, row['recid'], row['date'])).fetchone()
                if row['allow'] is True and (prior is None or prior['allow_value'] != 1):
                    if prior and prior['pending_schedule_id']:
                        self.event(db, prior['pending_schedule_id'], now, 'opening_observed',
                                   'Open access detected after an unverified dashboard request. This is the detection time.')
                    else:
                        year, month = map(int, row['date'][:7].split('-'))
                        self.event(db, None, now, 'dcr_open_detected' if prior else 'dcr_access_observed',
                                   'Direct DCR Change. Timestamp is when open access was detected.',
                                   actor={'username': '(Direct DCR Change)'},
                                   record=dict(app=app, year=year, month=month, recid=row['recid'], record_date=row['date'], source='dcr'))
                elif row['allow'] is False and prior and prior['allow_value'] == 1:
                    year, month = map(int, row['date'][:7].split('-'))
                    self.event(db, None, now, 'dcr_close_detected', 'Direct DCR Change. Closure detected at this time.',
                               actor={'username': '(Direct DCR Change)'},
                               record=dict(app=app, year=year, month=month, recid=row['recid'], record_date=row['date'], source='dcr'))
                self.access(db, app, row, now)

    def state(self, schedule_id, now, state, error=None, *, actor=None, action=None, detail=None, access=_UNSET):
        with self.connect() as db:
            previous = db.execute('SELECT * FROM schedules WHERE id=?', (schedule_id,)).fetchone()
            db.execute('UPDATE schedules SET state=?,error=?,updated_at=? WHERE id=?', (state, error, now, schedule_id))
            if previous is None or (previous['state'], previous['error']) != (state, error):
                self.event(db, schedule_id, now, action or state, detail if detail is not None else error or '', actor=actor)
            if previous and access is not _UNSET:
                self.access(db, previous['app'], dict(recid=previous['recid'], date=previous['record_date'], allow=access), now)

    def close_deadline(self, schedule_id, now, actor=None):
        with self.connect() as db:
            db.execute("UPDATE schedules SET closes_at=?,updated_at=? WHERE id=? AND state IN ('pending','active','error')",
                       (now, now, schedule_id))
            self.event(db, schedule_id, now, 'close_requested', 'Manual close requested', actor=actor)

    def audit_apps(self):
        with self.connect() as db:
            return [r[0] for r in db.execute('SELECT app FROM schedules UNION SELECT app FROM events WHERE app IS NOT NULL ORDER BY app')]

    def audit(self, page=1, app='', origin='', month=''):
        query = '''SELECT e.id,e.schedule_id,e.at,e.action,e.detail,e.actor,e.client_ip,
            COALESCE(e.app,s.app) AS app,COALESCE(e.year,s.year) AS year,COALESCE(e.month,s.month) AS month,
            COALESCE(e.recid,s.recid) AS recid,COALESCE(e.record_date,s.record_date) AS record_date,
            COALESCE(e.source,s.source) AS source,
            CASE WHEN e.actor='System' OR COALESCE(e.source,s.source)='empty_repair' THEN 'system'
                 WHEN COALESCE(e.source,s.source) IN ('dcr','detected') THEN 'dcr' ELSE 'dashboard' END AS origin
            FROM events e LEFT JOIN schedules s ON s.id=e.schedule_id'''
        clauses, values = [], []
        for key, value in (('app', app), ('origin', origin)):
            if value:
                clauses.append(key + '=?')
                values.append(value)
        if month:
            year, number = map(int, month.split('-'))
            clauses.extend(['year=?', 'month=?'])
            values.extend([year, number])
        where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
        with self.connect() as db:
            total = db.execute('SELECT COUNT(*) FROM (' + query + ')' + where, values).fetchone()[0]
            pages = max(1, (total + 49) // 50)
            page = max(1, min(page, pages))
            entries = [dict(r) for r in db.execute('SELECT * FROM (' + query + ')' + where + ' ORDER BY id DESC LIMIT 50 OFFSET ?', values + [(page - 1) * 50])]
            return dict(entries=entries, total=total, page=page, pages=pages)
