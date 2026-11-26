"""Python API and static SvelteKit interface; only the worker polls the DBF share."""
import hashlib
import hmac
import ipaddress
import re
import secrets
import socket
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from flask import Blueprint, Flask, abort, g, jsonify, request, send_from_directory, session
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

from .backups import (
    ALLOWED_CONFIGS,
    BackupBridgeClient,
    BackupBridgeError,
    DEST_IP_RE,
    JOB_KEY_RE,
    SERVICE_UNIT_RE,
    TARGET_NAME_RE,
    TIMER_UNIT_RE,
)
from .config import APPS, Settings
from .dbf import Source
from .dbf_writer import DbfWriter
from .fast import empty_period
from .service import MANILA, Service, normal_access, stamp, utcnow
from .store import Store


def create_app(settings=None, service=None, backup_bridge=None):
    settings = settings or Settings()
    if service is None:
        source = Source(settings.root, APPS)
        service = Service(Store(settings.data), source, DbfWriter(source, settings.writes), settings.writes)
    if backup_bridge is None:
        sock = getattr(settings, 'backup_bridge_socket', None) or (Path(getattr(settings, 'data', Path('./data'))) / 'backup-bridge.sock')
        backup_bridge = BackupBridgeClient(sock)
    app = Flask(__name__, static_folder=None)
    app.config.update(SECRET_KEY=settings.secret or secrets.token_hex(32),
                      SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Strict',
                      SESSION_COOKIE_PATH=settings.base or '/', MAX_CONTENT_LENGTH=65536,
                      PERMANENT_SESSION_LIFETIME=timedelta(hours=12))
    app.extensions['monitor'] = service
    app.extensions['backup_bridge'] = backup_bridge
    bp = Blueprint('api', __name__, url_prefix=settings.base + '/api')
    frontend = Path(getattr(settings, 'frontend', Path(__file__).parent / 'frontend')).resolve()
    if settings.password:
        service.store.bootstrap_user('mis', 'MIS', generate_password_hash(settings.password), stamp(utcnow()))
    proxy_addresses = set()
    if getattr(settings, 'trusted_proxy_host', ''):
        try:
            proxy_addresses = {item[4][0] for item in socket.getaddrinfo(settings.trusted_proxy_host, None)}
        except OSError:
            app.logger.warning('Trusted proxy could not be resolved; audit uses immediate peer IP')

    def payload():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            abort(400, 'Send a JSON object.')
        return data

    @app.before_request
    def protect():
        if not request.path.startswith(settings.base + '/api/'):
            return
        g.current_user = service.store.user(session.get('user_id'))
        session.setdefault('csrf', secrets.token_hex(32))
        if request.endpoint not in ('api.session_info', 'api.login', 'api.register') and not g.current_user:
            abort(401, 'Please sign in again.')
        if request.method == 'POST':
            token = request.headers.get('X-CSRF-Token', '')
            if not hmac.compare_digest(session['csrf'].encode(), token.encode()):
                abort(400, 'Form expired. Reload the page and try again.')

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error=error.description), error.code

    @app.after_request
    def headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        # SvelteKit's generated CSP meta tag includes its inline bootstrap hashes.
        response.headers['Content-Security-Policy'] = "frame-ancestors 'none'; base-uri 'none'; object-src 'none'"
        if '/_app/immutable/' not in request.path:
            response.headers['Cache-Control'] = 'no-store'
        return response

    def session_data():
        return dict(user=service.store.user(session.get('user_id')), csrf=session['csrf'],
                    writes=settings.writes, fast_writes=getattr(settings, 'fast_writes', False),
                    backup_controls=getattr(settings, 'backup_controls', True),
                    server_time=utcnow().isoformat(), timezone='Asia/Manila')

    def sign_in(user_id):
        session.clear()
        session.update(user_id=user_id, csrf=secrets.token_hex(32))
        session.permanent = True
        return jsonify(**session_data())

    @bp.get('/session')
    def session_info():
        return jsonify(**session_data())

    @bp.post('/login')
    def login():
        data = payload()
        username = str(data.get('username', '')).strip().lower()
        password = str(data.get('password', ''))
        user = service.store.login_user(username)
        if user and len(password) <= 1024 and check_password_hash(user['password_hash'], password):
            return sign_in(user['id'])
        abort(401, 'Username or password is incorrect.')

    def invitation_hash(token):
        return hashlib.sha256(token.encode()).hexdigest()

    @bp.route('/register', methods=['GET', 'POST'])
    def register():
        data = payload() if request.method == 'POST' else request.args
        token = str(data.get('invitation', ''))
        if not token or not service.store.valid_invitation(invitation_hash(token), stamp(utcnow())):
            abort(403, 'Ask MIS for a registration link. This invitation is invalid, expired, revoked, or already used.')
        if request.method == 'GET':
            return jsonify(valid=True)
        username = str(data.get('username', '')).strip().lower()
        name = str(data.get('display_name', '')).strip()
        password = str(data.get('password', ''))
        if not re.fullmatch(r'[a-z0-9][a-z0-9._-]{2,31}', username):
            abort(400, 'Use a username of 3–32 letters, numbers, dots, hyphens, or underscores.')
        if not 1 <= len(name) <= 80 or any(ord(c) < 32 for c in name):
            abort(400, 'Enter your name, up to 80 characters.')
        if not 4 <= len(password) <= 1024:
            abort(400, 'Use a password with at least 4 characters.')
        if password != data.get('confirm_password'):
            abort(400, 'The passwords do not match.')
        try:
            user_id = service.store.create_user(username, name, generate_password_hash(password), stamp(utcnow()), invitation_hash(token))
        except sqlite3.IntegrityError:
            abort(409, 'That username is already registered. Choose another or sign in.')
        except ValueError as exc:
            abort(403, str(exc))
        return sign_in(user_id)

    @bp.post('/logout')
    def logout():
        session.clear()
        session['csrf'] = secrets.token_hex(32)
        return jsonify(**session_data())

    def require_mis():
        if g.current_user['username'] != 'mis':
            abort(403, 'Only MIS can manage registration invitations.')

    @bp.route('/invitations', methods=['GET', 'POST'])
    def invitations():
        require_mis()
        link = None
        now = utcnow()
        if request.method == 'POST':
            token = secrets.token_urlsafe(32)
            service.store.create_invitation(invitation_hash(token), 'mis', stamp(now), stamp(now + timedelta(hours=48)))
            # Relative link lets the browser use the public origin, including HTTPS.
            link = settings.base + '/register?invitation=' + token
        return jsonify(invitations=service.store.invitations(), link=link, now=stamp(now))

    @bp.post('/invitations/<int:invitation_id>/revoke')
    def revoke_invitation(invitation_id):
        require_mis()
        service.store.revoke_invitation(invitation_id, stamp(utcnow()))
        return jsonify(message='Invitation revoked.')

    def actor():
        peer = request.remote_addr
        if peer in proxy_addresses:
            try:
                peer = str(ipaddress.ip_address(request.headers.get('X-Forwarded-For', '').split(',')[-1].strip()))
            except ValueError:
                pass
        return dict(username=g.current_user['username'], client_ip=peer)

    @bp.get('/audit')
    def audit():
        origin = request.args.get('origin', '')
        month = request.args.get('month', '')
        if origin not in ('', 'dashboard', 'dcr', 'system'):
            abort(400, 'Choose a valid audit source.')
        if month and not re.fullmatch(r'(19|20|21)[0-9]{2}-(0[1-9]|1[0-2])', month):
            abort(400, 'Choose a valid audit month.')
        result = service.store.audit(request.args.get('page', 1, type=int) or 1, request.args.get('app', ''), origin, month)
        for entry in result['entries']:
            entry.pop('client_ip', None)
        return jsonify(**result, apps=sorted(set(service.store.audit_apps()) | set(service.source.apps)))

    @bp.get('/time')
    def server_clock():
        return jsonify(server_time=utcnow().isoformat(), timezone='Asia/Manila')

    @bp.get('/status')
    def status():
        now = utcnow()
        observations = service.store.observations()
        active = [s for s in service.store.active() if s['app'] in service.source.apps]
        tracked = {(s['app'], s['year'], s['month']) for s in active}
        health, untracked = [], []
        for name in service.source.apps:
            observation = observations.get(name, {})
            successful = observation.get('successful_at')
            stale = not successful or now - datetime.fromisoformat(successful) > timedelta(seconds=max(90, settings.interval * 3))
            health.append(dict(app=name, successful_at=successful, stale=stale, error=observation.get('error')))
            for row in observation.get('rows', []):
                if row['allow'] is not True or not row['date']:
                    continue
                year, month = map(int, row['date'][:7].split('-'))
                if (name, year, month) not in tracked and not normal_access(year, month, now):
                    untracked.append(dict(app=name, year=year, month=month))
        by_app = {h['app']: h for h in health}
        for schedule in active:
            schedule['stale'] = by_app[schedule['app']]['stale'] or bool(by_app[schedule['app']]['error'])
        return jsonify(active=active, untracked=untracked, health=health,
                       unhealthy=any(h['stale'] or h['error'] for h in health),
                       writes=settings.writes, interval=settings.interval)

    @bp.get('/fast/status')
    def fast_status():
        now = utcnow()
        local = now.astimezone(MANILA)
        default = (local.replace(day=1) - timedelta(days=1)).strftime('%Y-%m')
        period = request.args.get('period', default)
        if not re.fullmatch(r'(19|20|21)[0-9]{2}-(0[1-9]|1[0-2])', period):
            abort(400, 'Choose a valid FAST period.')
        scan = service.store.fast_scan()
        actions = service.store.fast_actions()
        if scan:
            scan['stalled'] = (scan['state'] == 'scanning' and
                               now - datetime.fromisoformat(scan['updated_at']) > timedelta(minutes=15))
        stations = []
        for observation in service.store.fast_observations():
            successful = observation['successful_at']
            summary = observation['summary']
            cached = summary['periods'].get(period, empty_period(period)) if summary else None
            pending = any(job['station'] == observation['station'] and job['period'] == period
                          and job['state'] in ('queued', 'running', 'needs_recovery') for job in actions)
            verified = cached is not None and not observation['error'] and not pending
            stations.append(dict(station=observation['station'], checked_at=observation['checked_at'],
                                 successful_at=successful, error=observation['error'],
                                 generation_excluded=observation['station'].casefold() == 'fastmnv',
                                 status=cached['status'] if verified else 'unverified',
                                 cached_status=cached['status'] if cached else None,
                                 active=cached['active'] if cached else None,
                                 deleted=cached['deleted'] if cached else None,
                                 other_days=cached['other_days'] if cached else None))
        return jsonify(period=period, default_period=default,
                       read_only=not getattr(settings, 'fast_writes', False),
                       scan_mode='on_demand', stations=stations, scan=scan,
                       actions=actions)

    @bp.post('/fast/scan')
    def request_fast_scan():
        data = payload()
        station = data.get('station')
        if station is not None:
            if not isinstance(station, str) or station not in {
                    row['station'] for row in service.store.fast_observations()}:
                abort(400, 'Choose a known station, or scan all stations for initial discovery.')
        try:
            scan = service.store.request_fast_scan(station, stamp(utcnow()), g.current_user['username'])
        except ValueError as error:
            abort(409, str(error))
        return jsonify(scan=scan, message='Station scan requested.' if station else 'All-station scan requested.'), 202

    @bp.post('/fast/action')
    def request_fast_action():
        if not getattr(settings, 'fast_writes', False):
            abort(403, 'FAST period controls are disabled.')
        data = payload()
        station, period, action, job_id = (data.get(key) for key in ('station', 'period', 'action', 'request_id'))
        if not isinstance(station, str) or station not in {
                row['station'] for row in service.store.fast_observations()}:
            abort(400, 'Choose a known station.')
        if not isinstance(period, str) or not re.fullmatch(r'(19|20|21)[0-9]{2}-(0[1-9]|1[0-2])', period):
            abort(400, 'Choose a valid FAST period.')
        if action not in ('open', 'close'):
            abort(400, 'Choose opening or closing.')
        if not isinstance(job_id, str) or not re.fullmatch(r'[a-f0-9]{32}', job_id):
            abort(400, 'Operation identifier is invalid.')
        try:
            job = service.store.request_fast_action(job_id, station, period, action,
                                                    g.current_user['username'], stamp(utcnow()))
        except ValueError as error:
            abort(409, str(error))
        return jsonify(action=job, message='FAST period operation queued.'), 202

    @bp.post('/fast/action/<job_id>/resume')
    def resume_fast_action(job_id):
        if not getattr(settings, 'fast_writes', False):
            abort(403, 'FAST period controls are disabled.')
        try:
            job = service.store.resume_fast_action(job_id, stamp(utcnow()))
        except ValueError as error:
            abort(409, str(error))
        return jsonify(action=job, message='Recovery requested. The worker will verify saved files before continuing.'), 202

    @bp.post('/close/<int:schedule_id>')
    def close_month(schedule_id):
        if not settings.writes:
            abort(403, 'Closing months is disabled in read-only mode')
        try:
            result = service.close_now(schedule_id, actor=actor())
        except ValueError as exc:
            abort(400, str(exc))
        except Exception:
            app.logger.exception('Manual closure failed')
            abort(503, 'Closure could not be verified; check the dashboard before retrying.')
        return jsonify(message=result)

    @bp.get('/open-options')
    def open_options():
        now = utcnow()
        def local(value):
            return value.astimezone(MANILA).replace(second=0, microsecond=0).strftime('%Y-%m-%dT%H:%M')
        return jsonify(apps=list(service.source.apps), year=now.astimezone(MANILA).year,
                       writes=settings.writes, request_id=secrets.token_hex(24),
                       close_default=local(now + timedelta(days=1)), close_min=local(now), close_max=local(now + timedelta(days=90)))

    @bp.post('/open')
    def open_months():
        if not settings.writes:
            abort(403, 'Opening months is disabled in read-only mode')
        data = payload()
        try:
            months = data.get('months', [])
            if not isinstance(months, list):
                raise ValueError('Select at least one month.')
            results = service.open_months(str(data.get('app', '')), int(data.get('year', '')),
                                         [int(m) for m in months], str(data.get('close_at', '')),
                                         str(data.get('request_id', '')), actor=actor())
        except (ValueError, KeyError, TypeError) as exc:
            abort(400, str(exc))
        except Exception:
            app.logger.exception('Opening request failed')
            abort(503, 'The request could not be completed. Check the dashboard before submitting again.')
        return jsonify(messages=[dict(text=r, kind='warning' if 'could not be verified' in r or 'already submitted' in r else 'success') for r in results])

    # ---- System Backups API (via host backup-bridge.service) ----

    def require_backup_controls():
        if not getattr(settings, 'backup_controls', True):
            abort(403, 'Backup controls are disabled in read-only mode.')

    def call_bridge(action, params=None, timeout=None):
        try:
            return backup_bridge.call(action, params or {}, timeout=timeout)
        except BackupBridgeError as exc:
            abort(exc.status_code, str(exc))

    def audit_backup(action, target, detail):
        service.store.record_backup_event(stamp(utcnow()), g.current_user['username'], action, target, detail)

    @bp.get('/backups/status')
    def backups_status():
        max_age = request.args.get('max_age', 36, type=int) or 36
        max_age = max(1, min(720, max_age))
        resp = call_bridge('status', {'max_age_hours': max_age}, timeout=10)
        data = dict(resp.get('data') or {})
        data['controls_enabled'] = getattr(settings, 'backup_controls', True)
        data['activity'] = service.store.backup_events(limit=25)
        return jsonify(**data)

    @bp.get('/backups/preflight')
    def backups_preflight():
        resp = call_bridge('preflight', {}, timeout=20)
        return jsonify(**(resp.get('data') or {}))

    @bp.get('/backups/logs')
    def backups_logs():
        source = request.args.get('source', 'file')
        if source not in ('file', 'failures', 'journal'):
            abort(400, 'Invalid log source.')
        path = request.args.get('path', '')
        unit = request.args.get('unit', '')
        lines = max(10, min(1000, request.args.get('lines', 400, type=int) or 400))
        if unit and not SERVICE_UNIT_RE.fullmatch(unit):
            abort(400, 'Invalid backup unit.')
        resp = call_bridge('logs', {'source': source, 'path': path, 'unit': unit, 'lines': lines}, timeout=10)
        return jsonify(**(resp.get('data') or {}))

    @bp.get('/backups/configs')
    def backups_configs():
        resp = call_bridge('configs', {}, timeout=10)
        return jsonify(**(resp.get('data') or {}))

    @bp.post('/backups/validate-calendar')
    def backups_validate_calendar():
        data = payload()
        schedule = str(data.get('schedule', '')).strip()
        if not schedule or '\n' in schedule or '\r' in schedule:
            abort(400, 'Enter a single-line systemd OnCalendar expression.')
        resp = call_bridge('validate_calendar', {'schedule': schedule}, timeout=6)
        return jsonify(**(resp.get('data') or {}))

    @bp.post('/backups/run')
    def backups_run():
        require_backup_controls()
        data = payload()
        scope = str(data.get('scope', '')).strip()
        if scope == 'all':
            include_ibs = bool(data.get('include_ibs', True))
            resp = call_bridge('run_all', {'include_ibs': include_ibs})
            msg = resp.get('message', 'Started all backups.')
            audit_backup('run_all', 'all', msg)
            return jsonify(message=msg)
        if scope == 'target':
            target = str(data.get('target', '')).strip().lower()
            if target != 'ibs' and not TARGET_NAME_RE.fullmatch(target):
                abort(400, 'Choose a valid backup target.')
            resp = call_bridge('run_target', {'target': target})
            msg = resp.get('message', f'Started backup for {target}.')
            audit_backup('run_target', target, msg)
            return jsonify(message=msg)
        if scope == 'job':
            key = str(data.get('key', '')).strip().lower()
            if not JOB_KEY_RE.fullmatch(key):
                abort(400, 'Choose a valid backup job.')
            resp = call_bridge('run_job', {'key': key})
            msg = resp.get('message', f'Started job {key}.')
            audit_backup('run_job', key, msg)
            return jsonify(message=msg)
        abort(400, 'Choose a valid run scope (job, target, or all).')

    @bp.post('/backups/stop')
    def backups_stop():
        require_backup_controls()
        data = payload()
        unit = str(data.get('unit', '')).strip()
        if not SERVICE_UNIT_RE.fullmatch(unit):
            abort(400, 'Invalid backup service unit.')
        resp = call_bridge('stop_unit', {'unit': unit})
        msg = resp.get('message', f'Stopped {unit}.')
        audit_backup('stop_unit', unit, msg)
        return jsonify(message=msg)

    @bp.post('/backups/timers/toggle')
    def backups_timer_toggle():
        require_backup_controls()
        data = payload()
        timer = str(data.get('timer', '')).strip()
        enabled = bool(data.get('enabled', True))
        if not TIMER_UNIT_RE.fullmatch(timer):
            abort(400, 'Invalid backup timer unit.')
        resp = call_bridge('timer_toggle', {'timer': timer, 'enabled': enabled})
        msg = resp.get('message', f'Updated {timer}.')
        audit_backup('timer_toggle', timer, msg)
        return jsonify(message=msg)

    @bp.post('/backups/timers/schedule')
    def backups_timer_schedule():
        require_backup_controls()
        data = payload()
        timer = str(data.get('timer', '')).strip()
        schedule = str(data.get('schedule', '')).strip()
        if not TIMER_UNIT_RE.fullmatch(timer):
            abort(400, 'Invalid backup timer unit.')
        if not schedule or '\n' in schedule or '\r' in schedule:
            abort(400, 'Enter a valid single-line schedule.')
        resp = call_bridge('timer_schedule', {'timer': timer, 'schedule': schedule})
        msg = resp.get('message', f'Updated schedule for {timer}.')
        audit_backup('timer_schedule', timer, msg)
        return jsonify(message=msg)

    @bp.post('/backups/targets/register')
    def backups_target_register():
        require_backup_controls()
        data = payload()
        name = str(data.get('name', '')).strip().lower()
        dest_ip = str(data.get('dest_ip', '')).strip()
        schedule = str(data.get('schedule', '')).strip()
        enabled = bool(data.get('enabled', True))
        username = str(data.get('username', '')).strip()
        password = str(data.get('password', ''))
        domain = str(data.get('domain', '')).strip()
        keep_cred = bool(data.get('keep_cred', False))

        if not TARGET_NAME_RE.fullmatch(name) or name in ('ibs', 'all'):
            abort(400, 'Target name must be 1–24 lowercase letters, numbers, hyphens, or underscores (not "ibs" or "all").')
        if not DEST_IP_RE.fullmatch(dest_ip):
            abort(400, 'Enter a valid destination IP address or hostname.')
        if not schedule or '\n' in schedule or '\r' in schedule:
            abort(400, 'Enter a valid single-line systemd OnCalendar schedule.')
        if not keep_cred and not username:
            abort(400, 'Enter an SMB username for this backup target.')
        if any('\n' in s or '\r' in s for s in (username, password, domain)):
            abort(400, 'Credentials cannot contain line breaks.')

        resp = call_bridge('register_target', {
            'name': name,
            'dest_ip': dest_ip,
            'schedule': schedule,
            'enabled': enabled,
            'username': username,
            'password': password,
            'domain': domain,
            'keep_cred': keep_cred,
        })
        msg = resp.get('message', f'Saved backup target {name}.')
        audit_backup('register_target', name, f'{dest_ip} · {schedule} ({"enabled" if enabled else "disabled"})')
        return jsonify(message=msg)

    @bp.post('/backups/targets/delete')
    def backups_target_delete():
        require_backup_controls()
        data = payload()
        name = str(data.get('name', '')).strip().lower()
        if not TARGET_NAME_RE.fullmatch(name) or name in ('ibs', 'all'):
            abort(400, 'Choose a valid registered backup target.')
        resp = call_bridge('delete_target', {'name': name})
        msg = resp.get('message', f'Deleted backup target {name}.')
        audit_backup('delete_target', name, msg)
        return jsonify(message=msg)

    @bp.post('/backups/configs/save')
    def backups_config_save():
        require_backup_controls()
        data = payload()
        cfg_id = str(data.get('id', '')).strip()
        content = data.get('content', '')
        if cfg_id not in ALLOWED_CONFIGS:
            abort(400, 'Choose a valid configuration file (backup, ibs, or notify).')
        if not isinstance(content, str) or len(content) > 60000:
            abort(400, 'Configuration text is invalid or too large.')
        resp = call_bridge('save_config', {'id': cfg_id, 'content': content})
        msg = resp.get('message', f'Saved {cfg_id}.conf.')
        audit_backup('save_config', cfg_id, msg)
        return jsonify(message=msg)

    @bp.post('/backups/tools/test-notify')
    def backups_test_notify():
        require_backup_controls()
        resp = call_bridge('test_notify', {'target': 'systemmonitor'}, timeout=25)
        msg = resp.get('message', 'Sent test notification.')
        audit_backup('test_notify', 'notify', msg)
        return jsonify(message=msg)

    @bp.post('/backups/tools/clear-failures')
    def backups_clear_failures():
        require_backup_controls()
        resp = call_bridge('clear_failures', {})
        msg = resp.get('message', 'Cleared failures.log.')
        audit_backup('clear_failures', 'failures.log', msg)
        return jsonify(message=msg)

    @bp.post('/backups/tools/rebuild-manifest')
    def backups_rebuild_manifest():
        require_backup_controls()
        resp = call_bridge('rebuild_manifest', {})
        msg = resp.get('message', 'Cleared FAST station manifest cache.')
        audit_backup('rebuild_manifest', 'fast', msg)
        return jsonify(message=msg)

    app.register_blueprint(bp)

    @app.get(settings.base + '/')
    @app.get(settings.base + '/<path:path>')
    def interface(path=''):
        if path == 'api' or path.startswith('api/'):
            abort(404)
        if path.startswith('_app/'):
            return send_from_directory(frontend, path, max_age=31536000)
        if not (frontend / 'index.html').exists():
            abort(503, 'SvelteKit assets are missing. Build the frontend before starting the server.')
        return send_from_directory(frontend, 'index.html', max_age=0)

    return app
