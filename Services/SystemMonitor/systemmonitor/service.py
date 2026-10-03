import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

MANILA = ZoneInfo('Asia/Manila')


def utcnow():
    return datetime.now(timezone.utc)


def stamp(now):
    return now.astimezone(timezone.utc).isoformat(timespec='seconds')


def normal_access(year, month, now):
    local = now.astimezone(MANILA)
    current = (local.year, local.month)
    previous = (local.replace(day=1) - timedelta(days=1))
    return (year, month) == current or (local.day <= 3 and (year, month) == (previous.year, previous.month))


def next_midnight(now):
    local = now.astimezone(MANILA)
    return (local + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)


class Service:
    def __init__(self, store, source, writer, writes=False):
        self.store, self.source, self.writer, self.writes = store, source, writer, writes

    def schedule(self, app, row, source, now, expires, state, actor=None):
        year, month = map(int, row['date'][:7].split('-'))
        with self.store.connect() as db:
            existing = db.execute("SELECT id FROM schedules WHERE app=? AND year=? AND month=? AND state IN ('pending','active','error')", (app, year, month)).fetchone()
            if existing:
                db.execute("UPDATE schedules SET state='replaced',updated_at=? WHERE id=?", (stamp(now), existing['id']))
                self.store.event(db, existing['id'], stamp(now), 'replaced', 'New explicit close time', actor=actor)
            result = db.execute('''INSERT INTO schedules(app,year,month,recid,record_date,source,created_at,closes_at,state,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?)''', (app, year, month, row['recid'], row['date'], source,
                stamp(now), stamp(expires), state, stamp(now)))
            self.store.event(db, result.lastrowid, stamp(now), 'open_requested' if source == 'dashboard' else 'scheduled',
                             'Closes ' + expires.astimezone(MANILA).strftime('%d %b %Y, %I:%M %p Manila'), actor=actor)
            if source == 'dashboard':
                self.store.access(db, app, row, stamp(now), pending=result.lastrowid)
            return result.lastrowid

    def open_months(self, app, year, months, close_at, request_id, now=None, actor=None):
        supplied_time = now is not None
        if not self.writes:
            raise ValueError('Opening months is disabled in read-only mode')
        if app not in self.source.apps or not 1900 <= year <= 2100:
            raise ValueError('Choose a valid application and year')
        if not months or any(m not in range(1, 13) for m in months):
            raise ValueError('Select at least one valid month')
        try:
            expiry_local = datetime.fromisoformat(close_at)
        except (TypeError, ValueError):
            raise ValueError('Choose a valid close date and time') from None
        if expiry_local.tzinfo is not None or expiry_local.second or expiry_local.microsecond:
            raise ValueError('Choose a close time to the nearest minute in Asia/Manila')
        expires = expiry_local.replace(tzinfo=MANILA).astimezone(timezone.utc)
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 128:
            raise ValueError('A valid submission identifier is required')
        with self.store.operation():
            now = now or utcnow()
            if expires <= now:
                raise ValueError('Close date and time must be in the future')
            if expires > now + timedelta(days=90):
                raise ValueError('Close date and time must be within 90 days')
            with self.store.connect() as db:
                prior = db.execute('SELECT result FROM requests WHERE id=?', (request_id,)).fetchone()
                if prior:
                    return json.loads(prior['result'])
            # Validate every target before changing any DBF record.
            targets = [self.source.month(app, year, m) for m in sorted(set(months))]
            results = []
            # Claim the form token before external effects; retrying a submitted form never extends access.
            with self.store.connect() as db:
                db.execute('INSERT INTO requests(id,result) VALUES(?,?)', (request_id, json.dumps(['Request was already submitted. Check the dashboard for its outcome.'])))
            for row in targets:
                ident = self.schedule(app, row, 'dashboard', now, expires, 'pending', actor=actor)
                try:
                    if row['allow'] is not True:
                        self.writer.set_allow(app, row, True)
                    self.store.state(ident, stamp(now if supplied_time else utcnow()), 'active', actor=actor,
                                     action='deadline_updated' if row['allow'] is True else 'opened',
                                     detail='Closes ' + expires.astimezone(MANILA).strftime('%d %b %Y, %I:%M %p Manila'), access=True)
                    local_close = expires.astimezone(MANILA).strftime('%b %d, %Y at %I:%M %p Manila')
                    results.append(f"{row['date'][:7]}: allowed; closes {local_close}")
                except Exception as exc:
                    # A write can commit before an error is reported: retain the expiry for reconciliation.
                    self.store.state(ident, stamp(now if supplied_time else utcnow()), 'error',
                                     'Opening could not be verified: ' + str(exc), actor=actor, action='opening_failed')
                    results.append(f"{row['date'][:7]}: opening could not be verified")
            with self.store.connect() as db:
                db.execute('UPDATE requests SET result=? WHERE id=?', (json.dumps(results), request_id))
            return results

    def close_now(self, schedule_id, now=None, actor=None):
        supplied_time = now is not None
        if not self.writes:
            raise ValueError('Closing months is disabled in read-only mode')
        with self.store.operation():
            now = now or utcnow()
            schedule = next((s for s in self.store.active() if s['id'] == schedule_id), None)
            if schedule is None or schedule['app'] not in self.source.apps:
                raise ValueError('This opening is no longer active')
            current = self.source.month(schedule['app'], schedule['year'], schedule['month'])
            if (current['recid'], current['date']) != (schedule['recid'], schedule['record_date']):
                raise ValueError('Month record identity changed; review required')
            # Persist a due deadline first so a failed or uncertain write is retried.
            self.store.close_deadline(schedule_id, stamp(now), actor=actor)
            if current['allow'] is False:
                self.store.state(schedule_id, stamp(now), 'closed', actor=actor, action='closure_observed', access=False)
                return 'Month is already closed.'
            if current['allow'] is not True:
                self.store.state(schedule_id, stamp(now), 'error', 'ALLOW is unknown', actor=actor)
                raise ValueError('ALLOW is unknown; closure was not attempted')
            try:
                self.writer.set_allow(schedule['app'], current, False)
                verified = self.source.month(schedule['app'], schedule['year'], schedule['month'])
                if (verified['recid'], verified['date']) != (schedule['recid'], schedule['record_date']) or verified['allow'] is not False:
                    raise RuntimeError('Closure could not be verified')
                self.store.state(schedule_id, stamp(now if supplied_time else utcnow()), 'closed', actor=actor,
                                 action='manual_closed', detail='Closed through the dashboard', access=False)
                return 'Month closed.'
            except Exception as exc:
                self.store.state(schedule_id, stamp(now if supplied_time else utcnow()), 'error',
                                 'Closure failed: ' + str(exc), actor=actor, action='closure_failed')
                raise ValueError('Closure could not be verified; it remains scheduled for retry') from exc

    def tick(self, now=None):
        with self.store.operation():
            now = now or utcnow()
            self.store.retire_excluded(self.source.apps, stamp(now))
            for app in self.source.apps:
                try:
                    rows = self.source.read(app)
                    self.store.observe_access(app, rows, stamp(now))
                    self.store.observe(app, stamp(now), rows)
                    self.reconcile(app, rows, now)
                except Exception as exc:
                    self.store.observe(app, stamp(now), error=str(exc))

    def reconcile(self, app, rows, now):
        groups = {}
        for row in rows:
            if row['date']:
                groups.setdefault(row['date'][:7], []).append(row)
        active = [s for s in self.store.active() if s['app'] == app]
        tracked = {(s['year'], s['month']) for s in active}
        for schedule in active:
            key = f"{schedule['year']:04d}-{schedule['month']:02d}"
            candidates = groups.get(key, [])
            if len(candidates) != 1:
                self.store.state(schedule['id'], stamp(now), 'error', 'Month record is missing or ambiguous', actor={'username': 'System'})
                continue
            row = candidates[0]
            if any(r['recid'] == row['recid'] and r is not row for r in rows):
                self.store.state(schedule['id'], stamp(now), 'error', 'Record identifier is ambiguous', actor={'username': 'System'})
                continue
            if (row['recid'], row['date']) != (schedule['recid'], schedule['record_date']):
                self.store.state(schedule['id'], stamp(now), 'error', 'Month record identity changed; review required', actor={'username': 'System'})
                continue
            if row['allow'] is False:
                self.store.state(schedule['id'], stamp(now), 'closed', actor={'username': 'System'},
                                 action='closure_observed', access=False)
            elif row['allow'] is None and schedule['source'] == 'empty_repair' and datetime.fromisoformat(schedule['closes_at']) <= now:
                try:
                    if not self.writes:
                        raise RuntimeError('Read-only mode: DBF updates are disabled')
                    self.writer.set_allow(app, row, False)
                    verified = self.source.month(app, schedule['year'], schedule['month'])
                    if verified['recid'] != schedule['recid'] or verified['date'] != schedule['record_date'] or verified['allow'] is not False:
                        raise RuntimeError('Previous-month ALLOW update could not be verified')
                    row['allow'] = False
                    self.store.state(schedule['id'], stamp(now), 'closed', actor={'username': 'System'},
                                     action='blank_filled', detail='Previous-month empty ALLOW filled with False', access=False)
                    self.store.observe(app, stamp(now), rows)
                except Exception as exc:
                    self.store.state(schedule['id'], stamp(now), 'error', 'Previous-month ALLOW update failed: ' + str(exc), actor={'username': 'System'})
            elif row['allow'] is None:
                self.store.state(schedule['id'], stamp(now), 'error', 'ALLOW is unknown', actor={'username': 'System'})
            elif datetime.fromisoformat(schedule['closes_at']) <= now:
                try:
                    if not self.writes:
                        raise RuntimeError('Read-only mode: automatic closure is not enabled')
                    self.writer.set_allow(app, row, False)
                    row['allow'] = False
                    self.store.state(schedule['id'], stamp(now), 'closed', actor={'username': 'System'},
                                     action='auto_closed', detail='Closed at the scheduled deadline', access=False)
                    self.store.observe(app, stamp(now), rows)
                except Exception as exc:
                    self.store.state(schedule['id'], stamp(now), 'error', 'Closure failed: ' + str(exc), actor={'username': 'System'})
            elif schedule['state'] != 'active':
                self.store.state(schedule['id'], stamp(now), 'active', actor={'username': 'System'}, detail='Open access confirmed by worker')
        for key, candidates in groups.items():
            year, month = map(int, key.split('-'))
            if (year, month) in tracked or normal_access(year, month, now):
                continue
            if len(candidates) != 1:
                continue
            row = candidates[0]
            if row['allow'] is True:
                self.schedule(app, row, 'detected', now, next_midnight(now), 'active')
            elif row['allow'] is None:
                local = now.astimezone(MANILA)
                previous = local.replace(day=1) - timedelta(days=1)
                if (year, month) == (previous.year, previous.month):
                    self.schedule(app, row, 'empty_repair', now, now, 'pending')
