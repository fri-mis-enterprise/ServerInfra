from datetime import date, datetime, timedelta, timezone
import threading

import dbf

from systemmonitor.fast import read_periods
from systemmonitor.fast_worker import scan, process_requested_scan
from systemmonitor.store import Store
from systemmonitor.web import create_app
from test_web import BASE, settings, sign_in, post


def station_table(root, station):
    folder = root / station / 'DBASE'
    folder.mkdir(parents=True)
    path = folder / 'monthly.DBF'
    table = dbf.Table(str(path), 'TRANS_DATE D; ACCT_NO C(25)', dbf_type='db3')
    table.open(dbf.READ_WRITE)
    table.append((date(2026, 9, 1), 'ONE'))
    table.append((date(2026, 8, 1), 'ONE'))
    dbf.delete(table[1])
    table.close()
    return path


def test_scan_preserves_failed_and_missing_station_results(tmp_path, monkeypatch):
    root = tmp_path / 'share'
    path = station_table(root, 'FASTPA2')
    original = path.read_bytes()
    store = Store(tmp_path / 'data')
    scan(root, store)
    assert store.fast_scan()['processed'] == 1
    assert store.fast_scan()['state'] == 'completed'
    cached = store.fast_observations()[0]
    assert cached['summary']['periods']['2026-09']['active'] == 1
    assert cached['summary']['periods']['2026-08']['status'] == 'open_deleted'
    def unavailable(_):
        raise OSError('Network unavailable')
    monkeypatch.setattr('systemmonitor.fast_worker.read_periods', unavailable)
    scan(root, store)
    failed = store.fast_observations()[0]
    assert failed['summary'] == cached['summary']
    assert failed['successful_at'] == cached['successful_at']
    assert failed['error'] == 'Network unavailable'
    assert path.read_bytes() == original
    path.rename(path.with_suffix('.backup'))
    station_table(root, 'Other')
    scan(root, store)
    assert 'no longer found' in store.fast_observations()[0]['error']
    scan(tmp_path / 'absent', store)
    assert store.fast_scan()['state'] == 'error'
    assert store.fast_observations()[0]['summary'] == cached['summary']


def test_interrupted_scan_retains_progress_and_can_restart(tmp_path, monkeypatch):
    root = tmp_path / 'share'
    station_table(root, 'First')
    station_table(root, 'Second')
    store = Store(tmp_path / 'data')
    stop = threading.Event()
    def interrupt(path):
        result = read_periods(path)
        stop.set()
        return result
    monkeypatch.setattr('systemmonitor.fast_worker.read_periods', interrupt)
    scan(root, store, stop)
    assert store.fast_scan()['state'] == 'interrupted'
    assert store.fast_scan()['processed'] == 1
    assert len(store.fast_observations()) == 2
    assert store.fast_observations()[1]['summary'] is None
    monkeypatch.setattr('systemmonitor.fast_worker.read_periods', read_periods)
    scan(root, store)
    assert store.fast_scan()['processed'] == 2
    assert all(r['summary'] for r in store.fast_observations())


def test_fast_api_reads_only_cache_and_marks_uncertain_results(rig, monkeypatch):
    service, _, writer = rig([])
    now = datetime(2026, 10, 3, 1, tzinfo=timezone.utc)
    monkeypatch.setattr('systemmonitor.web.utcnow', lambda: now)
    def forbidden(_):
        raise AssertionError('Web requests must not read the DBF share')
    monkeypatch.setattr('systemmonitor.fast_worker.read_periods', forbidden)
    client = create_app(settings(), service).test_client()
    assert client.get(BASE + '/fast/status').status_code == 401
    sign_in(client)
    assert client.get(BASE + '/fast/status').json['stations'] == []
    fresh = now.isoformat()
    summary = dict(total_records=1, periods={'2026-09': dict(period='2026-09',
        status='closed_records_present', active=1, deleted=0, first_day_active=1, other_days=0)})
    store = service.store
    store.fast_start(2, fresh)
    store.fast_observe('FASTPA2', fresh, summary)
    store.fast_observe('fastmnv', fresh, dict(total_records=0, periods={}))
    store.fast_finish(fresh)
    data = client.get(BASE + '/fast/status').json
    assert data['period'] == '2026-09'
    assert data['read_only'] is True
    assert data['stations'][0]['status'] == 'closed_records_present'
    assert data['stations'][1]['generation_excluded'] is True
    assert data['stations'][1]['status'] == 'missing'
    assert client.get(BASE + '/fast/status?period=2026-08').json['stations'][0]['status'] == 'missing'
    assert client.get(BASE + '/fast/status?period=2026-13').status_code == 400
    store.fast_observe('FASTPA2', fresh, error='Network unavailable')
    failed = client.get(BASE + '/fast/status').json['stations'][0]
    assert failed['status'] == 'unverified'
    assert failed['cached_status'] == 'closed_records_present'
    assert failed['active'] == 1
    store.fast_observe('FASTPA2', (now - timedelta(hours=1)).isoformat(), summary)
    saved = client.get(BASE + '/fast/status').json['stations'][0]
    assert saved['status'] == 'closed_records_present'
    assert saved['successful_at'] == (now - timedelta(hours=1)).isoformat()
    store.fast_finish(fresh, error='Discovery failed', state='error')
    assert client.get(BASE + '/fast/status').json['stations'][0]['status'] == 'closed_records_present'
    assert writer.calls == []


def test_manual_station_scan_reads_only_requested_table_and_never_auto_repeats(tmp_path, monkeypatch):
    root = tmp_path / 'share'
    first = station_table(root, 'First')
    second = station_table(root, 'Second')
    store = Store(tmp_path / 'data')
    scan(root, store)
    previous = store.fast_observations()[1]
    read_paths = []
    def read(path):
        read_paths.append(path)
        return read_periods(path)
    def forbid_discovery(_):
        raise AssertionError('Single-station scan must not discover all stations')
    monkeypatch.setattr('systemmonitor.fast_worker.read_periods', read)
    monkeypatch.setattr('systemmonitor.fast_worker.monthly_tables', forbid_discovery)
    assert process_requested_scan(root, store) is False
    store.request_fast_scan('First', datetime.now(timezone.utc).isoformat(), 'mis')
    assert store.fast_scan()['state'] == 'queued'
    assert process_requested_scan(root, store) is True
    assert read_paths == [first.resolve()]
    assert store.fast_observations()[1] == previous
    assert store.fast_scan()['station'] == 'First'
    assert store.fast_scan()['requested_by'] == 'mis'
    assert process_requested_scan(root, store) is False
    # A failed single-station request must not invalidate another station's cache.
    first.rename(first.with_suffix('.backup'))
    store.request_fast_scan('First', datetime.now(timezone.utc).isoformat(), 'mis')
    process_requested_scan(root, store)
    assert store.fast_observations()[0]['error']
    assert store.fast_observations()[1] == previous
    assert second.is_file()


def test_manual_scan_api_queue_conflicts_and_restart(rig, monkeypatch):
    service, _, writer = rig([])
    now = datetime(2026, 10, 3, 1, tzinfo=timezone.utc)
    monkeypatch.setattr('systemmonitor.web.utcnow', lambda: now)
    def forbidden(_):
        raise AssertionError('API and idle worker must never access the FAST share')
    monkeypatch.setattr('systemmonitor.fast_worker.monthly_tables', forbidden)
    client = create_app(settings(writes=False), service).test_client()
    assert client.post(BASE + '/fast/scan', json={}).status_code == 401
    sign_in(client)
    assert client.post(BASE + '/fast/scan', json={}).status_code == 400
    assert post(client, '/fast/scan', {'station': '../Other'}).status_code == 400
    assert post(client, '/fast/scan', {'station': []}).status_code == 400
    assert client.get(BASE + '/fast/status').json['scan_mode'] == 'on_demand'
    assert process_requested_scan('/does-not-exist', service.store) is False
    request = post(client, '/fast/scan', {})
    assert request.status_code == 202
    assert request.json['scan']['state'] == 'queued'
    assert request.json['scan']['requested_by'] == 'mis'
    assert post(client, '/fast/scan', {}).json['scan']['requested_at'] == request.json['scan']['requested_at']
    restarted = Store(service.store.directory)
    restarted.interrupt_fast_scan(now.isoformat())
    assert restarted.fast_scan()['state'] == 'queued'  # Explicit pending intent survives restart.
    restarted.fast_prepare(['First'], now.isoformat())
    assert post(client, '/fast/scan', {'station': 'First'}).status_code == 409
    assert restarted.claim_fast_scan(now.isoformat())['state'] == 'scanning'
    assert restarted.claim_fast_scan(now.isoformat()) is None
    restarted.interrupt_fast_scan(now.isoformat())
    assert restarted.fast_scan()['state'] == 'interrupted'
    assert process_requested_scan('/does-not-exist', restarted) is False
    assert post(client, '/fast/scan', {'station': 'First'}).status_code == 202
    assert restarted.fast_scan()['station'] == 'First'
    assert writer.calls == []
