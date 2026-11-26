from types import SimpleNamespace

from conftest import row
from systemmonitor.backups import BackupBridgeClient
from systemmonitor.web import create_app

BASE = '/systemmonitor/api'

STATUS = {
    'healthy': True,
    'targets': [
        {
            'name': 'roi',
            'kind': 'cifs',
            'dest_ip': '10.0.0.10',
            'cred_configured': True,
            'cred_username': 'backup',
            'status': 'OK',
            'is_running': False,
            'active_phase': '',
            'last_run': '2026-11-26 01:00:00',
            'jobs': [
                {
                    'key': 'roi_fast',
                    'target': 'roi',
                    'job': 'fast',
                    'status': 'OK',
                    'last_run': '2026-11-26 01:00:00',
                    'duration_fmt': '00:12',
                    'archive': 'fast.tar.zst',
                    'size': '1.2G',
                    'message': 'Completed',
                    'log_path': '/var/log/vfp-backup/roi_fast.log',
                    'is_running': False,
                    'running_phase': '',
                    'active_unit': '',
                    'dest_display': '10.0.0.10/fast',
                }
            ],
            'timer': {
                'unit': 'backup-target-roi.timer',
                'target': 'roi',
                'enabled': 'enabled',
                'active': 'active',
                'on_calendar': '*-*-* 01:00:00',
                'next_run': '2026-11-27 01:00:00',
                'left': '23h',
                'last_run': '2026-11-26 01:00:00',
            },
        },
        {
            'name': 'ibs',
            'kind': 'ibs',
            'dest_ip': '10.0.0.30:5432',
            'cred_configured': True,
            'cred_username': 'postgres',
            'status': 'NEVER',
            'is_running': False,
            'active_phase': '',
            'last_run': '-',
            'jobs': [],
            'timer': {
                'unit': 'ibs-backup.timer',
                'target': 'ibs',
                'enabled': 'disabled',
                'active': 'inactive',
                'on_calendar': 'Sun *-*-* 02:00:00',
                'next_run': '-',
                'left': '-',
                'last_run': '-',
            },
        },
    ],
    'health': {
        'mounts': [{'name': 'System3', 'path': '/mnt/system3', 'exists': True, 'is_mount': True}],
        'staging_free': '42G',
        'staging_total': '100G',
        'staging_used_pct': 58.0,
        'pigz_available': True,
        'failure_count': 0,
    },
    'recent_failures': [],
}

PREFLIGHT = {
    'items': [
        {'category': 'Mounts', 'name': 'System3 source', 'ok': True, 'detail': '/mnt/system3 (mounted)'},
        {'category': 'Tools', 'name': 'pigz', 'ok': False, 'detail': 'not installed (optional)'},
    ]
}

CONFIGS = {
    'configs': [
        {'id': 'backup', 'label': 'Global Settings (backup.conf)', 'path': '/etc/backups/backup.conf', 'content': 'FAST_SRC=/mnt/fast\n'},
        {'id': 'ibs', 'label': 'IBS PostgreSQL (ibs.conf)', 'path': '/etc/backups/ibs.conf', 'content': 'PG_USER=postgres\n'},
        {'id': 'notify', 'label': 'Notifications (notify.conf)', 'path': '/etc/backups/notify.conf', 'content': 'NOTIFY_EMAIL=mis@example.test\n'},
    ]
}


def settings(backup_controls=True):
    return SimpleNamespace(base='/systemmonitor', interval=30, password='password', secret='test-secret',
                           writes=True, backup_controls=backup_controls)


class FakeBackupBridge:
    def __init__(self):
        self.calls = []

    def call(self, action, params=None, timeout=None):
        params = params or {}
        self.calls.append((action, params))
        if action == 'status':
            return {'ok': True, 'data': STATUS}
        if action == 'preflight':
            return {'ok': True, 'data': PREFLIGHT}
        if action == 'logs':
            return {'ok': True, 'data': {
                'files': [{'name': 'failures.log', 'path': '/var/log/vfp-backup/failures.log',
                           'size': '2K', 'mtime': '2026-11-26 01:00:00'}],
                'content': f"log:{params.get('source')}:{params.get('path') or params.get('unit') or ''}",
            }}
        if action == 'configs':
            return {'ok': True, 'data': CONFIGS}
        if action == 'validate_calendar':
            return {'ok': True, 'data': {'valid': True, 'detail': 'Next run: tomorrow 01:00'}}
        return {'ok': True, 'message': f'{action} ok'}


def post(client, path, data):
    token = client.get(BASE + '/session').json['csrf']
    return client.post(BASE + path, json=data, headers={'X-CSRF-Token': token})


def sign_in(client):
    return post(client, '/login', {'username': 'mis', 'password': 'password'})


def client_for(rig, bridge=None, backup_controls=True):
    service, source, writer = rig([row(9)])
    bridge = bridge or FakeBackupBridge()
    client = create_app(settings(backup_controls), service, backup_bridge=bridge).test_client()
    return client, bridge


def test_backups_require_auth_csrf_and_controls(rig):
    client, _ = client_for(rig)
    assert client.get(BASE + '/backups/status').status_code == 401
    assert client.get(BASE + '/backups/preflight').status_code == 401
    assert client.get(BASE + '/backups/configs').status_code == 401
    assert sign_in(client).status_code == 200
    assert client.post(BASE + '/backups/run', json={'scope': 'all'}).status_code == 400
    assert post(client, '/backups/run', {'scope': 'all'}).status_code == 200

    read_only, _ = client_for(rig, backup_controls=False)
    assert sign_in(read_only).status_code == 200
    assert read_only.get(BASE + '/backups/status').json['controls_enabled'] is False
    for path, data in (
        ('/backups/run', {'scope': 'all'}),
        ('/backups/stop', {'unit': 'ibs-backup.service'}),
        ('/backups/timers/toggle', {'timer': 'ibs-backup.timer', 'enabled': False}),
        ('/backups/timers/schedule', {'timer': 'ibs-backup.timer', 'schedule': '*-*-* 01:00:00'}),
        ('/backups/targets/register', {'name': 'roi', 'dest_ip': '10.0.0.10',
                                       'schedule': '*-*-* 01:00:00', 'username': 'backup'}),
        ('/backups/targets/delete', {'name': 'roi'}),
        ('/backups/configs/save', {'id': 'backup', 'content': 'FAST_SRC=/mnt/fast\n'}),
        ('/backups/tools/test-notify', {}),
        ('/backups/tools/clear-failures', {}),
        ('/backups/tools/rebuild-manifest', {}),
    ):
        assert post(read_only, path, data).status_code == 403


def test_backup_read_endpoints(rig):
    client, bridge = client_for(rig)
    sign_in(client)

    status = client.get(BASE + '/backups/status').json
    assert status['healthy'] is True
    assert status['controls_enabled'] is True
    assert [target['name'] for target in status['targets']] == ['roi', 'ibs']
    assert status['targets'][0]['jobs'][0]['key'] == 'roi_fast'
    assert status['health']['staging_free'] == '42G'
    assert status['activity'] == []
    assert ('status', {'max_age_hours': 36}) in bridge.calls

    preflight = client.get(BASE + '/backups/preflight').json
    assert preflight['items'][0]['name'] == 'System3 source'
    assert preflight['items'][1]['ok'] is False

    logs = client.get(BASE + '/backups/logs?source=failures').json
    assert logs['files'][0]['name'] == 'failures.log'
    assert logs['content'] == 'log:failures:'
    assert client.get(BASE + '/backups/logs?source=journal&unit=ibs-backup.service').json['content'] == 'log:journal:ibs-backup.service'
    assert client.get(BASE + '/backups/logs?source=file&path=/var/log/vfp-backup/roi_fast.log').json['content'] == 'log:file:/var/log/vfp-backup/roi_fast.log'
    assert client.get(BASE + '/backups/logs?source=bogus').status_code == 400
    assert client.get(BASE + '/backups/logs?source=journal&unit=not-a-unit').status_code == 400

    configs = client.get(BASE + '/backups/configs').json
    assert [config['id'] for config in configs['configs']] == ['backup', 'ibs', 'notify']
    assert configs['configs'][0]['content'].startswith('FAST_SRC')


def test_backup_run_scopes_and_validation(rig):
    client, bridge = client_for(rig)
    sign_in(client)

    assert post(client, '/backups/run', {'scope': 'job', 'key': 'roi_fast'}).json == {'message': 'run_job ok'}
    assert bridge.calls[-1] == ('run_job', {'key': 'roi_fast'})
    assert post(client, '/backups/run', {'scope': 'target', 'target': 'ROI'}).json == {'message': 'run_target ok'}
    assert bridge.calls[-1] == ('run_target', {'target': 'roi'})
    assert post(client, '/backups/run', {'scope': 'target', 'target': 'ibs'}).status_code == 200
    assert bridge.calls[-1] == ('run_target', {'target': 'ibs'})
    assert post(client, '/backups/run', {'scope': 'all', 'include_ibs': False}).status_code == 200
    assert bridge.calls[-1] == ('run_all', {'include_ibs': False})

    for data in (
        {'scope': 'job', 'key': 'bad key'},
        {'scope': 'target', 'target': 'bad target'},
        {'scope': 'unknown'},
        {},
    ):
        assert post(client, '/backups/run', data).status_code == 400


def test_backup_stop_and_timer_controls(rig):
    client, bridge = client_for(rig)
    sign_in(client)

    assert post(client, '/backups/stop', {'unit': 'backup-job@roi_fast.service'}).status_code == 200
    assert bridge.calls[-1] == ('stop_unit', {'unit': 'backup-job@roi_fast.service'})
    assert post(client, '/backups/stop', {'unit': 'not-a-unit'}).status_code == 400

    assert post(client, '/backups/timers/toggle', {'timer': 'backup-target-roi.timer', 'enabled': False}).status_code == 200
    assert bridge.calls[-1] == ('timer_toggle', {'timer': 'backup-target-roi.timer', 'enabled': False})
    assert post(client, '/backups/timers/toggle', {'timer': 'roi.timer', 'enabled': True}).status_code == 400

    assert post(client, '/backups/timers/schedule', {
        'timer': 'ibs-backup.timer', 'schedule': 'Sun *-*-* 02:00:00'}).status_code == 200
    assert bridge.calls[-1] == ('timer_schedule', {'timer': 'ibs-backup.timer', 'schedule': 'Sun *-*-* 02:00:00'})
    assert post(client, '/backups/timers/schedule', {'timer': 'bad', 'schedule': '*-*-* 01:00:00'}).status_code == 400
    assert post(client, '/backups/timers/schedule', {'timer': 'ibs-backup.timer', 'schedule': ''}).status_code == 400


def test_backup_target_register_and_delete(rig):
    client, bridge = client_for(rig)
    sign_in(client)

    target = {'name': 'newbox', 'dest_ip': '10.0.0.20', 'schedule': '*-*-* 02:00:00',
              'enabled': False, 'username': 'svc', 'password': 'secret',
              'domain': 'WORKGROUP', 'keep_cred': False}
    assert post(client, '/backups/targets/register', target).status_code == 200
    assert bridge.calls[-1] == ('register_target', target)
    assert post(client, '/backups/targets/register', {
        'name': 'newbox', 'dest_ip': '10.0.0.20', 'schedule': '*-*-* 02:00:00',
        'enabled': True, 'username': '', 'password': '', 'domain': '', 'keep_cred': True}).status_code == 200

    for name in ('IBS', 'all', 'bad name', ''):
        assert post(client, '/backups/targets/register', {
            'name': name, 'dest_ip': '10.0.0.20', 'schedule': '*-*-* 02:00:00',
            'username': 'svc'}).status_code == 400
    assert post(client, '/backups/targets/register', {
        'name': 'newbox', 'dest_ip': 'bad ip', 'schedule': '*-*-* 02:00:00',
        'username': 'svc'}).status_code == 400
    assert post(client, '/backups/targets/register', {
        'name': 'newbox', 'dest_ip': '10.0.0.20', 'schedule': '*-*-* 02:00:00',
        'username': ''}).status_code == 400
    assert post(client, '/backups/targets/register', {
        'name': 'newbox', 'dest_ip': '10.0.0.20', 'schedule': '*-*-* 02:00:00\nbad',
        'username': 'svc'}).status_code == 400
    assert post(client, '/backups/targets/register', {
        'name': 'newbox', 'dest_ip': '10.0.0.20', 'schedule': '*-*-* 02:00:00',
        'username': 'svc\nbad'}).status_code == 400

    assert post(client, '/backups/targets/delete', {'name': 'ROI'}).status_code == 200
    assert bridge.calls[-1] == ('delete_target', {'name': 'roi'})
    assert post(client, '/backups/targets/delete', {'name': 'ibs'}).status_code == 400
    assert post(client, '/backups/targets/delete', {'name': 'bad name'}).status_code == 400


def test_backup_configs_tools_and_activity(rig):
    client, bridge = client_for(rig)
    sign_in(client)

    assert post(client, '/backups/configs/save', {'id': 'backup', 'content': 'FAST_SRC=/mnt/fast\n'}).status_code == 200
    assert bridge.calls[-1] == ('save_config', {'id': 'backup', 'content': 'FAST_SRC=/mnt/fast\n'})
    assert post(client, '/backups/configs/save', {'id': 'other', 'content': 'x'}).status_code == 400
    assert post(client, '/backups/configs/save', {'id': 'backup', 'content': 123}).status_code == 400
    assert post(client, '/backups/configs/save', {'id': 'backup', 'content': 'x' * 60001}).status_code == 400

    assert post(client, '/backups/validate-calendar', {'schedule': '*-*-* 01:00:00'}).json['valid'] is True
    assert post(client, '/backups/validate-calendar', {'schedule': ''}).status_code == 400

    for path in ('/backups/tools/test-notify', '/backups/tools/clear-failures', '/backups/tools/rebuild-manifest'):
        assert post(client, path, {}).status_code == 200

    activity = client.get(BASE + '/backups/status').json['activity']
    actions = {entry['action'] for entry in activity}
    assert {'save_config', 'test_notify', 'clear_failures', 'rebuild_manifest'} <= actions
    assert all(entry['actor'] == 'mis' for entry in activity)
    assert all(entry['target'] and entry['detail'] for entry in activity)


def test_backup_activity_records_control_actions(rig):
    client, _ = client_for(rig)
    sign_in(client)

    assert post(client, '/backups/run', {'scope': 'all'}).status_code == 200
    assert post(client, '/backups/run', {'scope': 'target', 'target': 'roi'}).status_code == 200
    assert post(client, '/backups/run', {'scope': 'job', 'key': 'roi_fast'}).status_code == 200
    assert post(client, '/backups/stop', {'unit': 'ibs-backup.service'}).status_code == 200
    assert post(client, '/backups/timers/toggle', {'timer': 'ibs-backup.timer', 'enabled': True}).status_code == 200
    assert post(client, '/backups/timers/schedule', {'timer': 'ibs-backup.timer', 'schedule': '*-*-* 03:00:00'}).status_code == 200
    assert post(client, '/backups/targets/register', {
        'name': 'leo', 'dest_ip': '10.0.0.11', 'schedule': '*-*-* 01:00:00', 'username': 'backup'}).status_code == 200
    assert post(client, '/backups/targets/delete', {'name': 'leo'}).status_code == 200

    activity = client.get(BASE + '/backups/status').json['activity']
    actions = [entry['action'] for entry in activity]
    assert actions[:8] == [
        'delete_target', 'register_target', 'timer_schedule', 'timer_toggle',
        'stop_unit', 'run_job', 'run_target', 'run_all',
    ]


def test_backup_bridge_missing_socket_returns_503(rig, tmp_path):
    service, source, writer = rig([row(9)])
    bridge = BackupBridgeClient(tmp_path / 'backup-bridge.sock')
    client = create_app(settings(), service, backup_bridge=bridge).test_client()
    sign_in(client)

    for path in ('/backups/status', '/backups/preflight', '/backups/configs'):
        result = client.get(BASE + path)
        assert result.status_code == 503
        assert 'backup bridge' in result.json['error'].lower()
    assert post(client, '/backups/run', {'scope': 'all'}).status_code == 503
