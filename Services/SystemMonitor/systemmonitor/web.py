"""Dashboard reads cached observations; only the worker polls the System3 share."""
import calendar
import hmac
import hashlib
import ipaddress
import re
import secrets
import socket
import sqlite3
from datetime import datetime, timedelta
from urllib.parse import urlsplit

from flask import Blueprint, Flask, abort, flash, g, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

from .config import APPS, Settings
from .dbf import Source
from .service import MANILA, Service, normal_access, stamp, utcnow
from .dbf_writer import DbfWriter
from .store import Store


def create_app(settings=None, service=None):
    settings = settings or Settings()
    if service is None:
        source = Source(settings.root, APPS)
        service = Service(Store(settings.data), source, DbfWriter(source, settings.writes), settings.writes)
    app = Flask(__name__, static_url_path=settings.base + '/static')
    app.config.update(SECRET_KEY=settings.secret or secrets.token_hex(32),
                      SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Strict',
                      SESSION_COOKIE_PATH=settings.base or '/', MAX_CONTENT_LENGTH=16384,
                      PERMANENT_SESSION_LIFETIME=timedelta(hours=12))
    app.extensions['monitor'] = service
    bp = Blueprint('dashboard', __name__, url_prefix=settings.base)
    if settings.password:
        service.store.bootstrap_user('mis', 'MIS', generate_password_hash(settings.password), stamp(utcnow()))
    proxy_addresses = set()
    if getattr(settings, 'trusted_proxy_host', ''):
        try:
            proxy_addresses = {item[4][0] for item in socket.getaddrinfo(settings.trusted_proxy_host, None)}
        except OSError:
            app.logger.warning('Trusted proxy could not be resolved; audit will use the immediate peer IP')

    @app.before_request
    def protect():
        if request.endpoint == 'static':
            return
        g.current_user = service.store.user(session.get('user_id'))
        session.setdefault('csrf', secrets.token_hex(32))
        if request.endpoint not in ('dashboard.login', 'dashboard.register') and not g.current_user:
            target = url_for('dashboard.login', next=request.full_path.rstrip('?'))
            if request.headers.get('HX-Request') or request.endpoint == 'dashboard.server_clock':
                return jsonify(error='Please sign in again.'), 401, {'HX-Redirect': target}
            return redirect(target)
        if request.method == 'POST':
            token = session.get('csrf', '')
            if not token or not hmac.compare_digest(token.encode(), request.form.get('csrf', '').encode()):
                abort(400, 'Form expired. Reload the page and try again.')

    def sign_in(user_id):
        session.clear()
        session['user_id'] = user_id
        session['csrf'] = secrets.token_hex(32)
        session.permanent = True

    def login_destination():
        target = request.values.get('next', '')
        parts = urlsplit(target)
        if target.startswith(settings.base + '/') and not parts.scheme and not parts.netloc:
            return target
        return url_for('dashboard.index')

    @bp.route('/login', methods=['GET', 'POST'])
    def login():
        if g.current_user:
            return redirect(url_for('dashboard.index'))
        if request.method == 'POST':
            username = request.form.get('username', '').strip().lower()
            password = request.form.get('password', '')
            user = service.store.login_user(username)
            if user and len(password) <= 1024 and check_password_hash(user['password_hash'], password):
                destination = login_destination()
                sign_in(user['id'])
                return redirect(destination, code=303)
            flash('Username or password is incorrect.', 'error')
        return render_template('auth.html', registering=False)

    @bp.route('/register', methods=['GET', 'POST'])
    def register():
        if g.current_user:
            return redirect(url_for('dashboard.index'))
        token = request.form.get('invitation', '') if request.method == 'POST' else request.args.get('invitation', '')
        invitation_hash = hashlib.sha256(token.encode()).hexdigest()
        if not token or not service.store.valid_invitation(invitation_hash, stamp(utcnow())):
            return render_template('invitation_required.html'), 403
        if request.method == 'POST':
            username = request.form.get('username', '').strip().lower()
            display_name = request.form.get('display_name', '').strip()
            password = request.form.get('password', '')
            if not re.fullmatch(r'[a-z0-9][a-z0-9._-]{2,31}', username):
                flash('Use a username of 3–32 letters, numbers, dots, hyphens, or underscores.', 'error')
            elif not 1 <= len(display_name) <= 80 or any(ord(c) < 32 for c in display_name):
                flash('Enter your name, up to 80 characters.', 'error')
            elif not 4 <= len(password) <= 1024:
                flash('Use a password with at least 4 characters.', 'error')
            elif password != request.form.get('confirm_password', ''):
                flash('The passwords do not match.', 'error')
            else:
                try:
                    user_id = service.store.create_user(username, display_name, generate_password_hash(password), stamp(utcnow()), invitation_hash)
                except sqlite3.IntegrityError:
                    flash('That username is already registered. Choose another or sign in.', 'error')
                except ValueError:
                    return render_template('invitation_required.html'), 403
                else:
                    sign_in(user_id)
                    flash('Your account is ready. You are now signed in.')
                    return redirect(url_for('dashboard.index'), code=303)
        return render_template('auth.html', registering=True, invitation=token)

    @bp.route('/invitations', methods=['GET', 'POST'])
    def invitations():
        if g.current_user['username'] != 'mis':
            abort(403)
        link = None
        now = utcnow()
        if request.method == 'POST':
            token = secrets.token_urlsafe(32)
            service.store.create_invitation(hashlib.sha256(token.encode()).hexdigest(), 'mis',
                                            stamp(now), stamp(now + timedelta(hours=48)))
            scheme = request.scheme
            if request.remote_addr in proxy_addresses:
                forwarded_scheme = request.headers.get('X-Forwarded-Proto', '')
                if forwarded_scheme in ('http', 'https'):
                    scheme = forwarded_scheme
            link = url_for('dashboard.register', invitation=token, _external=True, _scheme=scheme)
        return render_template('invitations.html', invitations=service.store.invitations(), link=link, now=stamp(now))

    @bp.post('/invitations/<int:invitation_id>/revoke')
    def revoke_invitation(invitation_id):
        if g.current_user['username'] != 'mis':
            abort(403)
        service.store.revoke_invitation(invitation_id, stamp(utcnow()))
        flash('Invitation revoked.')
        return redirect(url_for('dashboard.invitations'), code=303)

    @bp.post('/logout')
    def logout():
        session.clear()
        return redirect(url_for('dashboard.login'), code=303)

    def actor():
        peer = request.remote_addr
        if peer in proxy_addresses:
            candidate = request.headers.get('X-Forwarded-For', '').split(',')[-1].strip()
            try:
                peer = str(ipaddress.ip_address(candidate))
            except ValueError:
                pass
        return dict(username=g.current_user['username'], client_ip=peer)

    @app.after_request
    def headers(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        return response

    @app.template_filter('manila')
    def manila(value):
        return datetime.fromisoformat(value).astimezone(MANILA).strftime('%d %b %Y, %I:%M %p') if value else 'Never'

    @app.context_processor
    def clock_context():
        return dict(server_time=utcnow().isoformat(), writes=settings.writes,
                    current_user=getattr(g, 'current_user', None))

    @app.template_filter('audit_time')
    def audit_time(value):
        return datetime.fromisoformat(value).astimezone(MANILA).strftime('%d %b %Y, %I:%M:%S %p')

    @bp.get('/audit')
    def audit():
        app_filter = request.args.get('app', '')
        origin = request.args.get('origin', '')
        if origin not in ('', 'dashboard', 'dcr', 'system'):
            abort(400, 'Choose a valid audit source.')
        month = request.args.get('month', '')
        if month and not re.fullmatch(r'(19|20|21)[0-9]{2}-(0[1-9]|1[0-2])', month):
            abort(400, 'Choose a valid audit month.')
        page = request.args.get('page', 1, type=int) or 1
        result = service.store.audit(page, app_filter, origin, month)
        return render_template('audit.html', **result, apps=sorted(set(service.store.audit_apps()) | set(service.source.apps)),
                               app_filter=app_filter, origin=origin, month_filter=month, months=calendar.month_name)

    @bp.get('/time')
    def server_clock():
        return jsonify(server_time=utcnow().isoformat(), timezone='Asia/Manila')

    def error_page(error):
        return render_template('error.html', error=error), error.code

    for code in (400, 403, 404):
        app.register_error_handler(code, error_page)

    def context():
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
        return dict(active=active, untracked=untracked, health=health,
                    unhealthy=any(h['stale'] or h['error'] for h in health),
                    writes=settings.writes, months=calendar.month_name, interval=settings.interval)

    @bp.get('/')
    def index():
        session.setdefault('csrf', secrets.token_hex(32))
        return render_template('index.html', **context())

    @bp.get('/status')
    def status():
        session.setdefault('csrf', secrets.token_hex(32))
        return render_template('_status.html', **context())

    @bp.post('/close/<int:schedule_id>')
    def close_month(schedule_id):
        if not settings.writes:
            abort(403, 'Closing months is disabled in read-only mode')
        try:
            result = service.close_now(schedule_id, actor=actor())
        except ValueError as exc:
            flash(str(exc), 'error')
        except Exception:
            app.logger.exception('Manual closure failed')
            flash('Closure could not be verified; check the dashboard before retrying.', 'error')
        else:
            flash(result)
        return redirect(url_for('dashboard.index'), code=303)

    @bp.get('/open')
    def form():
        session.setdefault('csrf', secrets.token_hex(32))
        now = utcnow()
        close_default = (now + timedelta(days=3)).astimezone(MANILA).replace(second=0, microsecond=0)
        close_min = now.astimezone(MANILA).replace(second=0, microsecond=0)
        close_max = (now + timedelta(days=90)).astimezone(MANILA).replace(second=0, microsecond=0)
        return render_template('open.html', apps=service.source.apps, months=calendar.month_name,
                               year=utcnow().astimezone(MANILA).year, writes=settings.writes,
                               request_id=secrets.token_hex(24),
                               close_default=close_default.isoformat(timespec='minutes'),
                               close_default_display=close_default.strftime('%d %b %Y, %I:%M %p'),
                               close_min=close_min.isoformat(timespec='minutes'),
                               close_max=close_max.isoformat(timespec='minutes'))

    @bp.post('/open')
    def open_months():
        if not settings.writes:
            abort(403, 'Opening months is disabled in read-only mode')
        try:
            results = service.open_months(request.form.get('app', ''), int(request.form.get('year', '')),
                                         [int(m) for m in request.form.getlist('months')],
                                         request.form.get('close_at', ''), request.form.get('request_id', ''), actor=actor())
        except (ValueError, KeyError) as exc:
            flash(str(exc), 'error')
            return redirect(url_for('dashboard.form'), code=303)
        except Exception:
            app.logger.exception('Opening request failed')
            flash('The request could not be completed. Check the dashboard before submitting again.', 'error')
        else:
            for result in results:
                flash(result, 'warning' if 'could not be verified' in result or 'already submitted' in result else 'message')
        return redirect(url_for('dashboard.index'), code=303)

    app.register_blueprint(bp)
    return app
