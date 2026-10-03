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

from .config import APPS, Settings
from .dbf import Source
from .dbf_writer import DbfWriter
from .fast import empty_period
from .service import MANILA, Service, normal_access, stamp, utcnow
from .store import Store


def create_app(settings=None, service=None):
    settings = settings or Settings()
    if service is None:
        source = Source(settings.root, APPS)
        service = Service(Store(settings.data), source, DbfWriter(source, settings.writes), settings.writes)
    app = Flask(__name__, static_folder=None)
    app.config.update(SECRET_KEY=settings.secret or secrets.token_hex(32),
                      SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Strict',
                      SESSION_COOKIE_PATH=settings.base or '/', MAX_CONTENT_LENGTH=16384,
                      PERMANENT_SESSION_LIFETIME=timedelta(hours=12))
    app.extensions['monitor'] = service
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
                       close_default=local(now + timedelta(days=3)), close_min=local(now), close_max=local(now + timedelta(days=90)))

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
