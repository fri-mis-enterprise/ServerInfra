from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
import hashlib

from werkzeug.security import check_password_hash

from conftest import row
from systemmonitor.web import create_app

BASE = '/systemmonitor/api'


def settings(writes=True, password='password', frontend=None):
    result = SimpleNamespace(base='/systemmonitor', interval=30, password=password, secret='test-secret', writes=writes)
    if frontend is not None:
        result.frontend = frontend
    return result


def post(client, path, data):
    token = client.get(BASE + '/session').json['csrf']
    return client.post(BASE + path, json=data, headers={'X-CSRF-Token': token})


def sign_in(client, username='mis', password='password'):
    return post(client, '/login', {'username': username, 'password': password})


def invite(app):
    admin = app.test_client()
    assert sign_in(admin).status_code == 200
    result = post(admin, '/invitations', {})
    assert result.status_code == 200
    return result.json['link'].split('invitation=')[1]


def test_read_only_api_status_and_csrf(rig):
    service, source, writer = rig([row(9, True)], writes=False)
    client = create_app(settings(writes=False), service).test_client()
    assert client.get(BASE + '/status').status_code == 401
    assert sign_in(client).status_code == 200
    result = client.get(BASE + '/status')
    assert result.status_code == 200
    assert result.json['unhealthy'] is True
    assert result.json['writes'] is False
    assert client.get(BASE + '/open-options').status_code == 200
    assert client.post(BASE + '/open', json={}).status_code == 400
    assert post(client, '/open', {}).status_code == 403
    assert post(client, '/close/1', {}).status_code == 403
    assert writer.calls == []


def test_api_open_close_user_audit_and_hidden_ip(rig):
    service, source, writer = rig([row(9, True)])
    service.tick(datetime(2026, 10, 4, 8, tzinfo=timezone.utc))
    client = create_app(settings(), service).test_client()
    assert client.get(BASE + '/status', headers={'Authorization': 'Basic bWlzOnBhc3N3b3Jk'}).status_code == 401
    assert sign_in(client).status_code == 200
    data = client.get(BASE + '/status').json
    assert data['active'][0]['source'] == 'detected'
    result = post(client, '/open', {
        'request_id': 'web-submit', 'app': 'Test', 'year': '2026',
        'months': [9], 'close_at': '2026-10-07T12:30'})
    assert result.status_code == 200
    schedule = service.store.active()[0]
    assert schedule['source'] == 'dashboard'
    result = post(client, f"/close/{schedule['id']}", {})
    assert result.status_code == 200
    assert service.store.active() == []
    close = next(e for e in service.store.audit()['entries'] if e['action'] == 'manual_closed')
    assert close['actor'] == 'mis'
    assert close['client_ip'] == '127.0.0.1'
    history = client.get(BASE + '/audit').json
    assert all('client_ip' not in entry for entry in history['entries'])
    assert any(e['actor'] == '(Direct DCR Change)' for e in history['entries'])
    filtered = client.get(BASE + '/audit?app=Test&month=2026-09&origin=dashboard').json
    assert all(e['origin'] == 'dashboard' for e in filtered['entries'])
    assert client.get(BASE + '/audit?origin=invalid').status_code == 400
    assert client.get(BASE + '/audit?month=invalid').status_code == 400
    assert post(client, '/open', {'year': None, 'months': '9'}).status_code == 400


def test_server_clock_uses_scheduler_time_and_requires_auth(rig, monkeypatch):
    service, source, writer = rig([row(9)])
    now = datetime(2026, 10, 3, 1, 30, 15, tzinfo=timezone.utc)
    monkeypatch.setattr('systemmonitor.web.utcnow', lambda: now)
    client = create_app(settings(), service).test_client()
    assert client.get(BASE + '/time').status_code == 401
    assert client.get(BASE + '/session').json['server_time'] == now.isoformat()
    sign_in(client)
    result = client.get(BASE + '/time')
    assert result.json == {'server_time': now.isoformat(), 'timezone': 'Asia/Manila'}
    assert result.headers['Cache-Control'] == 'no-store'
    options = client.get(BASE + '/open-options').json
    assert options['close_min'] == '2026-10-03T09:30'
    assert options['close_default'] == '2026-10-06T09:30'
    assert options['request_id']


def test_registration_login_logout_and_persistence(rig):
    service, source, writer = rig([row(9)])
    config = settings()
    app = create_app(config, service)
    token = invite(app)
    client = app.test_client()
    assert client.get(BASE + '/register').status_code == 403
    assert client.post(BASE + '/register', json={}).status_code == 400
    assert client.get(BASE + '/register?invitation=' + token).status_code == 200
    result = post(client, '/register', {'invitation': token, 'username': 'alice',
        'display_name': 'Alice', 'password': 'abcd', 'confirm_password': 'abcd'})
    assert result.status_code == 200
    assert result.json['user']['display_name'] == 'Alice'
    assert app.test_client().get(BASE + '/register?invitation=' + token).status_code == 403
    assert client.get(BASE + '/invitations').status_code == 403
    assert post(client, '/invitations', {}).status_code == 403
    user = service.store.login_user('alice')
    assert user['password_hash'] != 'abcd'
    assert check_password_hash(user['password_hash'], 'abcd')
    old_csrf = client.get(BASE + '/session').json['csrf']
    assert post(client, '/logout', {}).status_code == 200
    assert client.get(BASE + '/audit').status_code == 401
    restarted = create_app(config, service).test_client()
    assert sign_in(restarted, 'alice', 'abcd').status_code == 200
    assert restarted.get(BASE + '/session').json['user']['display_name'] == 'Alice'
    assert restarted.post(BASE + '/open', json={}, headers={'X-CSRF-Token': old_csrf}).status_code == 400


def test_duplicate_registration_does_not_consume_invitation(rig):
    service, source, writer = rig([row(9)])
    app = create_app(settings(), service)
    token = invite(app)
    client = app.test_client()
    result = post(client, '/register', {'invitation': token, 'username': 'MIS', 'display_name': 'Other MIS',
        'password': 'abcd', 'confirm_password': 'abcd'})
    assert result.status_code == 409
    assert 'already registered' in result.json['error']
    assert client.get(BASE + '/register?invitation=' + token).status_code == 200
    assert service.store.login_user('mis')['display_name'] == 'MIS'
    assert sign_in(client, password='wrong').status_code == 401


def test_invitation_expiry_revocation_and_password_minimum(rig):
    service, source, writer = rig([row(9)])
    app = create_app(settings(), service)
    token = invite(app)
    client = app.test_client()
    response = post(client, '/register', {'invitation': token, 'username': 'alice',
        'display_name': 'Alice', 'password': 'abc', 'confirm_password': 'abc'})
    assert response.status_code == 400
    assert 'at least 4 characters' in response.json['error']
    assert client.get(BASE + '/register?invitation=' + token).status_code == 200
    admin = app.test_client()
    sign_in(admin)
    invitation_id = service.store.invitations()[0]['id']
    assert post(admin, f'/invitations/{invitation_id}/revoke', {}).status_code == 200
    assert client.get(BASE + '/register?invitation=' + token).status_code == 403
    now = datetime.now(timezone.utc)
    service.store.create_invitation(hashlib.sha256(b'expired').hexdigest(), 'mis',
        (now - timedelta(days=3)).isoformat(), (now - timedelta(days=1)).isoformat())
    assert client.get(BASE + '/register?invitation=expired').status_code == 403
    assert client.get(BASE + '/register?invitation=forged').status_code == 403


def test_svelte_shell_deep_links_assets_and_json_errors(rig, tmp_path):
    service, source, writer = rig([row(9)])
    frontend = tmp_path / 'frontend'
    asset_dir = frontend / '_app' / 'immutable'
    asset_dir.mkdir(parents=True)
    (frontend / 'index.html').write_text('<html>SvelteKit interface</html>')
    (asset_dir / 'example.js').write_text('console.log("asset")')
    client = create_app(settings(frontend=frontend), service).test_client()
    for path in ('/', '/dcr', '/fast', '/login', '/register?invitation=test', '/open', '/audit?month=2026-09', '/invitations'):
        result = client.get('/systemmonitor' + path)
        assert result.status_code == 200
        assert b'SvelteKit interface' in result.data
    asset = client.get('/systemmonitor/_app/immutable/example.js')
    assert asset.status_code == 200
    assert 'max-age=31536000' in asset.headers['Cache-Control']
    assert client.get('/systemmonitor/_app/missing.js').status_code == 404
    sign_in(client)
    assert client.get(BASE + '/missing').status_code == 404
    token = client.get(BASE + '/session').json['csrf']
    assert client.post(BASE + '/login', data='invalid', headers={'X-CSRF-Token': token}).status_code == 400
