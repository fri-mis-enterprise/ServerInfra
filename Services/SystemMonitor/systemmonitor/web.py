"""Dashboard reads cached observations; only the worker polls the System3 share."""
import calendar
import hmac
import secrets
from datetime import datetime, timedelta

from flask import Blueprint, Flask, abort, flash, jsonify, redirect, render_template, request, session, url_for

from .config import APPS, Settings
from .dbf import Source
from .service import MANILA, Service, normal_access, utcnow
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
                      SESSION_COOKIE_PATH=settings.base or '/', MAX_CONTENT_LENGTH=16384)
    app.extensions['monitor'] = service
    bp = Blueprint('dashboard', __name__, url_prefix=settings.base)

    @app.before_request
    def protect():
        if request.endpoint == 'static':
            return
        if settings.password:
            auth = request.authorization
            if not auth or auth.type != 'basic' or not hmac.compare_digest(auth.username or '', 'mis') or not hmac.compare_digest((auth.password or '').encode(), settings.password.encode()):
                return 'Authentication required', 401, {'WWW-Authenticate': 'Basic realm="System Monitor"'}
        if request.method == 'POST':
            token = session.get('csrf', '')
            if not token or not hmac.compare_digest(token.encode(), request.form.get('csrf', '').encode()):
                abort(400, 'Form expired. Reload the page and try again.')

    @app.after_request
    def headers(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        return response

    @app.template_filter('manila')
    def manila(value):
        return datetime.fromisoformat(value).astimezone(MANILA).strftime('%d %b %Y, %I:%M %p') if value else 'Never'

    @app.context_processor
    def clock_context():
        return dict(server_time=utcnow().isoformat(), writes=settings.writes)

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
            result = service.close_now(schedule_id)
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
                                         request.form.get('close_at', ''), request.form.get('request_id', ''))
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
