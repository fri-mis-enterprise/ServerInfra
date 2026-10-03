from datetime import datetime, timezone, timedelta
import hashlib
from types import SimpleNamespace
import re

from werkzeug.security import check_password_hash

from conftest import row
from systemmonitor.web import create_app


def settings(writes=True, password='password'):
    return SimpleNamespace(base='/systemmonitor', interval=30, password=password, secret='test-secret', writes=writes)


def csrf(client, path='/systemmonitor/login'):
    page = client.get(path)
    return re.search(rb'name="csrf" value="([a-f0-9]+)"', page.data).group(1).decode()


def sign_in(client, username='mis', password='password'):
    return client.post('/systemmonitor/login', data={'csrf': csrf(client), 'username': username, 'password': password})


def invite(app):
    admin = app.test_client()
    sign_in(admin)
    result = admin.post('/systemmonitor/invitations', data={'csrf': csrf(admin, '/systemmonitor/invitations')})
    return re.search(rb'id="invitation-link" type="text" value="([^"]+)"', result.data).group(1).decode().replace('&amp;', '&')


def test_dashboard_read_only_and_stale_health(rig):
    service, source, writer = rig([row(9, True)], writes=False)
    client = create_app(settings(writes=False), service).test_client()
    assert sign_in(client).status_code == 303
    page = client.get('/systemmonitor/')
    assert page.status_code == 200
    assert b'Refresh needs attention' in page.data
    assert b'Read-only' in page.data
    assert b'htmx.min.js' in page.data
    assert client.get('/systemmonitor/open').status_code == 200
    assert client.post('/systemmonitor/open', data={}).status_code == 400
    assert client.get('/systemmonitor/status').status_code == 200


def test_dashboard_detection_csrf_and_user_audit(rig):
    service, source, writer = rig([row(9, True)])
    service.tick(datetime(2026, 10, 4, 8, tzinfo=timezone.utc))
    client = create_app(settings(), service).test_client()
    assert client.get('/systemmonitor/').status_code == 302
    assert client.get('/systemmonitor/', headers={'Authorization': 'Basic bWlzOnBhc3N3b3Jk'}).status_code == 302
    assert sign_in(client).status_code == 303
    page = client.get('/systemmonitor/')
    assert page.status_code == 200
    assert b'(Direct DCR Change)' in page.data
    assert b'Scheduled close' in page.data
    assert b'Close now' in page.data
    token = csrf(client, '/systemmonitor/open')
    result = client.post('/systemmonitor/open', data={
        'csrf': token, 'request_id': 'web-submit', 'app': 'Test', 'year': '2026',
        'months': ['9'], 'close_at': '2026-10-07T12:30'}, headers={'X-Forwarded-For': '203.0.113.9'})
    assert result.status_code == 303
    schedule = service.store.active()[0]
    assert schedule['source'] == 'dashboard'
    token = csrf(client, '/systemmonitor/status')
    result = client.post(f"/systemmonitor/close/{schedule['id']}", data={'csrf': token})
    assert result.status_code == 303
    assert service.store.active() == []
    events = service.store.audit()['entries']
    close = next(e for e in events if e['action'] == 'manual_closed')
    assert close['actor'] == 'mis'
    assert close['client_ip'] == '127.0.0.1'  # Untrusted forwarded headers are ignored.
    assert b'mis' in client.get('/systemmonitor/audit').data


def test_server_clock_uses_scheduler_time_and_requires_auth(rig, monkeypatch):
    service, source, writer = rig([row(9)])
    now = datetime(2026, 10, 3, 1, 30, 15, tzinfo=timezone.utc)
    monkeypatch.setattr('systemmonitor.web.utcnow', lambda: now)
    client = create_app(settings(), service).test_client()
    assert client.get('/systemmonitor/time').status_code == 401
    sign_in(client)
    result = client.get('/systemmonitor/time')
    assert result.json == {'server_time': now.isoformat(), 'timezone': 'Asia/Manila'}
    assert result.headers['Cache-Control'] == 'no-store'
    page = client.get('/systemmonitor/')
    assert now.isoformat().encode() in page.data
    assert b'System time' in page.data
    assert b'03 Oct 2026, 09:30 AM' in page.data


def test_registration_login_logout_and_persistence(rig):
    service, source, writer = rig([row(9)])
    config = settings()
    app = create_app(config, service)
    link = invite(app)
    token = link.split('invitation=')[1]
    client = app.test_client()
    assert client.get('/systemmonitor/register').status_code == 403
    assert client.post('/systemmonitor/register', data={}).status_code == 400
    result = client.post('/systemmonitor/register', data={
        'csrf': csrf(client, link), 'invitation': token, 'username': 'alice',
        'display_name': 'Alice', 'password': 'abcd', 'confirm_password': 'abcd'})
    assert result.status_code == 303
    assert b'Alice' in client.get('/systemmonitor/').data
    assert app.test_client().get(link).status_code == 403
    assert client.get('/systemmonitor/invitations').status_code == 403
    user = service.store.login_user('alice')
    assert user['password_hash'] != 'abcd'
    assert check_password_hash(user['password_hash'], 'abcd')
    token = csrf(client, '/systemmonitor/open')
    assert client.post('/systemmonitor/logout', data={'csrf': token}).status_code == 303
    assert client.get('/systemmonitor/audit').status_code == 302
    restarted = create_app(config, service).test_client()
    assert sign_in(restarted, 'alice', 'abcd').status_code == 303
    assert b'Alice' in restarted.get('/systemmonitor/').data
    assert restarted.post('/systemmonitor/open', data={'csrf': token}).status_code == 400


def test_duplicate_registration_and_login_redirect_safety(rig):
    service, source, writer = rig([row(9)])
    app = create_app(settings(), service)
    link = invite(app)
    client = app.test_client()
    result = client.post('/systemmonitor/register', data={
        'csrf': csrf(client, link), 'invitation': link.split('invitation=')[1], 'username': 'MIS', 'display_name': 'Other MIS',
        'password': 'a-long-password', 'confirm_password': 'a-long-password'})
    assert b'already registered' in result.data
    assert client.get(link).status_code == 200
    assert service.store.login_user('mis')['display_name'] == 'MIS'
    result = client.post('/systemmonitor/login', data={
        'csrf': csrf(client), 'username': 'mis', 'password': 'password', 'next': 'https://example.com/'})
    assert result.location == '/systemmonitor/'


def test_invitation_expiry_revocation_and_password_minimum(rig):
    service, source, writer = rig([row(9)])
    app = create_app(settings(), service)
    link = invite(app)
    client = app.test_client()
    token = link.split('invitation=')[1]
    response = client.post('/systemmonitor/register', data={
        'csrf': csrf(client, link), 'invitation': token, 'username': 'alice',
        'display_name': 'Alice', 'password': 'abc', 'confirm_password': 'abc'})
    assert b'at least 4 characters' in response.data
    assert client.get(link).status_code == 200
    admin = app.test_client()
    sign_in(admin)
    invitation_id = service.store.invitations()[0]['id']
    assert admin.post(f'/systemmonitor/invitations/{invitation_id}/revoke',
        data={'csrf': csrf(admin, '/systemmonitor/invitations')}).status_code == 303
    assert client.get(link).status_code == 403
    now = datetime.now(timezone.utc)
    service.store.create_invitation(hashlib.sha256(b'expired').hexdigest(), 'mis',
        (now - timedelta(days=3)).isoformat(), (now - timedelta(days=1)).isoformat())
    assert client.get('/systemmonitor/register?invitation=expired').status_code == 403
    assert client.get('/systemmonitor/register?invitation=forged').status_code == 403
