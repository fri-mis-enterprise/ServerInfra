from datetime import datetime, timezone
from types import SimpleNamespace
import re

from conftest import row
from systemmonitor.web import create_app


def test_dashboard_read_only_and_stale_health(rig):
    service, source, writer = rig([row(9, True)], writes=False)
    settings = SimpleNamespace(base='/systemmonitor', interval=30, password='', secret='test-secret', writes=False)
    app = create_app(settings, service)
    client = app.test_client()
    page = client.get('/systemmonitor/')
    assert page.status_code == 200
    assert b'Refresh needs attention' in page.data
    assert b'Read-only' in page.data
    assert b'htmx.min.js' in page.data
    assert client.get('/systemmonitor/open').status_code == 200
    assert client.post('/systemmonitor/open', data={}).status_code == 400
    assert client.get('/systemmonitor/status').status_code == 200


def test_dashboard_detection_and_csrf(rig):
    service, source, writer = rig([row(9, True)])
    service.tick(datetime(2026, 10, 4, 8, tzinfo=timezone.utc))
    settings = SimpleNamespace(base='/systemmonitor', interval=30, password='password', secret='test-secret', writes=True)
    app = create_app(settings, service)
    client = app.test_client()
    assert client.get('/systemmonitor/').status_code == 401
    assert client.get('/systemmonitor/', headers={'Authorization': 'Basic YWRtaW46cGFzc3dvcmQ='}).status_code == 401
    headers = {'Authorization': 'Basic bWlzOnBhc3N3b3Jk'}
    page = client.get('/systemmonitor/', headers=headers)
    assert page.status_code == 200
    assert b'Detected outside dashboard' in page.data
    assert b'Scheduled close' in page.data
    assert b'Close now' in page.data
    form = client.get('/systemmonitor/open', headers=headers)
    csrf = re.search(rb'name="csrf" value="([a-f0-9]+)"', form.data).group(1).decode()
    assert b'Close date and time (Asia/Manila)' in form.data
    result = client.post('/systemmonitor/open', headers=headers, data={
        'csrf': csrf, 'request_id': 'web-submit', 'app': 'Test', 'year': '2026',
        'months': ['9'], 'close_at': '2026-10-07T12:30'})
    assert result.status_code == 303
    schedule = service.store.active()[0]
    assert schedule['source'] == 'dashboard'
    status = client.get('/systemmonitor/status', headers=headers)
    csrf = re.search(rb'name="csrf" value="([a-f0-9]+)"', status.data).group(1).decode()
    result = client.post(f"/systemmonitor/close/{schedule['id']}", headers=headers, data={'csrf': csrf})
    assert result.status_code == 303
    assert service.store.active() == []


def test_server_clock_uses_scheduler_time_and_requires_auth(rig, monkeypatch):
    service, source, writer = rig([row(9)])
    now = datetime(2026, 10, 3, 1, 30, 15, tzinfo=timezone.utc)
    monkeypatch.setattr('systemmonitor.web.utcnow', lambda: now)
    settings = SimpleNamespace(base='/systemmonitor', interval=30, password='password', secret='test-secret', writes=True)
    client = create_app(settings, service).test_client()
    assert client.get('/systemmonitor/time').status_code == 401
    headers = {'Authorization': 'Basic bWlzOnBhc3N3b3Jk'}
    result = client.get('/systemmonitor/time', headers=headers)
    assert result.json == {'server_time': now.isoformat(), 'timezone': 'Asia/Manila'}
    assert result.headers['Cache-Control'] == 'no-store'
    page = client.get('/systemmonitor/', headers=headers)
    assert now.isoformat().encode() in page.data
    assert b'System time' in page.data
    assert b'03 Oct 2026, 09:30 AM' in page.data
