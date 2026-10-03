from datetime import datetime, timedelta, timezone

import pytest

from conftest import row
from systemmonitor.service import MANILA, normal_access, next_midnight


def when(day, hour=12, month=10, year=2026):
    return datetime(year, month, day, hour, tzinfo=MANILA).astimezone(timezone.utc)


def close_at(now, hours):
    return (now + timedelta(hours=hours)).astimezone(MANILA).strftime('%Y-%m-%dT%H:%M')


def test_noncontiguous_open_and_expiry_after_restart(rig):
    service, source, writer = rig([row(1), row(2), row(3)])
    now = when(2)
    service.open_months('Test', 2026, [1, 3], close_at(now, 72), 'submission-1', now)
    assert writer.calls == [(1, True), (3, True)]
    assert source.rows[1]['allow'] is False
    assert all(s['closes_at'] == (now + timedelta(hours=72)).isoformat(timespec='seconds') for s in service.store.active())
    # New Service uses persisted SQLite deadlines.
    replacement = type(service)(service.store, source, writer, True)
    replacement.tick(now + timedelta(hours=72, seconds=1))
    assert writer.calls[-2:] == [(1, False), (3, False)]
    assert replacement.store.active() == []
    assert all(r['locked'] for r in source.rows)


def test_detect_midnight_once_and_explicit_replacement(rig):
    service, source, writer = rig([row(9, True)])
    first = when(4, 15)
    service.tick(first)
    prior = service.store.active()[0]
    assert prior['source'] == 'detected'
    assert prior['closes_at'] == next_midnight(first).astimezone(timezone.utc).isoformat(timespec='seconds')
    service.tick(first + timedelta(hours=1))
    assert service.store.active()[0]['id'] == prior['id']
    service.open_months('Test', 2026, [9], close_at(first + timedelta(hours=1), 72), 'replace', first + timedelta(hours=1))
    current = service.store.active()[0]
    assert current['source'] == 'dashboard' and current['id'] != prior['id']
    service.tick(next_midnight(first).astimezone(timezone.utc) + timedelta(seconds=1))
    assert source.rows[0]['allow'] is True
    assert writer.calls == []


def test_normal_window_across_year_and_third_fourth(rig):
    assert normal_access(2025, 12, when(3, 23, 1, 2026))
    assert not normal_access(2025, 12, when(4, 0, 1, 2026))
    service, source, writer = rig([row(12, True, 2025)])
    service.tick(when(3, 23, 1, 2026))
    assert service.store.active() == []
    service.tick(when(4, 0, 1, 2026))
    assert service.store.active()[0]['source'] == 'detected'


def test_early_close_and_failed_closure_retry(rig):
    service, source, writer = rig([row(1)])
    now = when(1)
    service.open_months('Test', 2026, [1], close_at(now, 24), 'first', now)
    source.rows[0]['allow'] = False
    service.tick(now + timedelta(hours=1))
    assert service.store.active() == []
    assert writer.calls == [(1, True)]
    service.open_months('Test', 2026, [1], close_at(now + timedelta(hours=2), 24), 'second', now + timedelta(hours=2))
    writer.failure = 'timeout'
    service.tick(now + timedelta(hours=27))
    assert service.store.active()[0]['state'] == 'error'
    writer.failure = None
    service.tick(now + timedelta(hours=28))
    assert service.store.active() == []
    assert source.rows[0]['allow'] is False


def test_uncertain_opening_is_retained_and_closed(rig):
    service, source, writer = rig([row(1)])
    writer.failure = 'lost response'
    writer.commit_before_failure = True
    now = when(1)
    result = service.open_months('Test', 2026, [1], close_at(now, 24), 'uncertain', now)
    assert 'could not be verified' in result[0]
    assert service.store.active()[0]['state'] == 'error'
    writer.failure = None
    service.tick(now + timedelta(hours=25))
    assert source.rows[0]['allow'] is False
    assert service.store.active() == []


def test_missing_ambiguous_identity_and_stale_read(rig):
    service, source, writer = rig([row(1), row(2)])
    with pytest.raises(ValueError, match='found 0'):
        service.open_months('Test', 2026, [1, 3], close_at(when(1), 24), 'missing', when(1))
    assert writer.calls == []
    service.open_months('Test', 2026, [1], close_at(when(1), 24), 'valid', when(1))
    source.rows[0]['recid'] = 40
    service.tick(when(2))
    assert service.store.active()[0]['state'] == 'error'
    assert writer.calls == [(1, True)]
    source.error = 'share unavailable'
    service.tick(when(3))
    assert service.store.observations()['Test']['error'] == 'share unavailable'
    assert service.store.active()[0]['state'] == 'error'


def test_duplicate_recid_rejected_before_write(rig):
    service, source, writer = rig([row(1), row(2, recid=1)])
    with pytest.raises(ValueError, match='identifier is ambiguous'):
        service.open_months('Test', 2026, [1], close_at(when(1), 24), 'dup', when(1))
    assert writer.calls == []


def test_duplicate_submission_and_read_only_expiry(rig):
    service, source, writer = rig([row(1)])
    now = when(1)
    first = service.open_months('Test', 2026, [1], close_at(now, 72), 'same', now)
    assert service.open_months('Test', 2026, [1], close_at(now, 168), 'same', now + timedelta(hours=2)) == first
    assert len(writer.calls) == 1
    service.writes = False
    service.tick(now + timedelta(days=4))
    assert service.store.active()[0]['state'] == 'error'
    assert writer.calls == [(1, True)]


def test_worker_and_extension_serialize(rig):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    service, source, writer = rig([row(1)])
    now = when(1)
    service.open_months('Test', 2026, [1], close_at(now, 24), 'original', now)
    entered, release = Event(), Event()
    original_write = writer.set_allow

    def delayed(app, target, value):
        if value is False:
            entered.set()
            assert release.wait(5)
        original_write(app, target, value)

    writer.set_allow = delayed
    with ThreadPoolExecutor(max_workers=2) as pool:
        closing = pool.submit(service.tick, now + timedelta(hours=25))
        assert entered.wait(5)
        extending = pool.submit(service.open_months, 'Test', 2026, [1], close_at(now + timedelta(hours=25), 72), 'extended', now + timedelta(hours=25))
        release.set()
        closing.result(timeout=5)
        extending.result(timeout=5)
    assert source.rows[0]['allow'] is True
    assert service.store.active()[0]['closes_at'] == (now + timedelta(hours=97)).isoformat(timespec='seconds')


def test_removed_application_retains_history_without_monitoring(rig):
    service, source, writer = rig([row(1)])
    now = when(1)
    service.open_months('Test', 2026, [1], close_at(now, 24), 'before-removal', now)


def test_close_time_is_exact_manila_time_and_validated(rig):
    service, source, writer = rig([row(1)])
    now = when(2, 9)
    exact = '2026-10-05T12:30'
    service.open_months('Test', 2026, [1], exact, 'exact', now)
    assert service.store.active()[0]['closes_at'] == '2026-10-05T04:30:00+00:00'
    assert writer.calls == [(1, True)]
    for invalid in ('bad', '2026-10-02T08:59', '2027-01-01T12:00', '2026-10-05T12:30:12'):
        with pytest.raises(ValueError):
            service.open_months('Test', 2026, [1], invalid, f'invalid-{invalid}', now)
    source.apps.clear()
    service.tick(now + timedelta(days=2))
    assert service.store.active() == []
    assert writer.calls == [(1, True)]
    with service.store.connect() as db:
        schedule = db.execute('SELECT state FROM schedules').fetchone()
        event = db.execute('SELECT action FROM events ORDER BY id DESC LIMIT 1').fetchone()
    assert schedule['state'] == 'excluded'
    assert event['action'] == 'excluded'


def test_manual_close_is_durable_verified_and_retried(rig):
    service, source, writer = rig([row(9)])
    now = when(3)
    service.open_months('Test', 2026, [9], close_at(now, 72), 'manual-close', now)
    schedule = service.store.active()[0]
    assert service.close_now(schedule['id'], now + timedelta(minutes=1)) == 'Month closed.'
    assert writer.calls == [(9, True), (9, False)]
    assert service.store.active() == []


def test_empty_allow_current_month_is_untouched_and_previous_month_respects_grace(rig):
    service, source, writer = rig([row(10, None), row(9, None)])

    service.tick(when(3, 23, month=10))
    assert [r['allow'] for r in source.rows] == [None, None]
    assert service.store.active() == []
    assert writer.calls == []

    service.tick(when(4, 0, month=10))
    repair = service.store.active()
    assert len(repair) == 1
    assert (repair[0]['source'], repair[0]['month'], repair[0]['state']) == ('empty_repair', 9, 'pending')
    assert [r['allow'] for r in source.rows] == [None, None]

    service.tick(when(4, 0, month=10) + timedelta(seconds=1))
    assert [r['allow'] for r in source.rows] == [None, False]
    assert service.store.active() == []
    assert writer.calls == [(9, False)]


def test_empty_previous_month_update_retries_after_failure(rig):
    service, source, writer = rig([row(9, None)])
    writer.failure = 'temporary DBF error'
    now = when(4, 0, month=10)
    service.tick(now)
    service.tick(now + timedelta(seconds=1))
    assert service.store.active()[0]['state'] == 'error'
    assert source.rows[0]['allow'] is None

    writer.failure = None
    service.tick(now + timedelta(seconds=2))
    assert source.rows[0]['allow'] is False
    assert service.store.active() == []


def test_explicit_open_fills_empty_allow_true(rig):
    service, source, writer = rig([row(10, None)])
    now = when(3, month=10)
    results = service.open_months('Test', 2026, [10], close_at(now, 24), 'open-empty', now)
    assert source.rows[0]['allow'] is True
    assert writer.calls == [(10, True)]
    assert 'allowed' in results[0]
    assert service.store.active()[0]['state'] == 'active'


def test_audit_dashboard_open_is_not_detected_as_direct_dcr(rig):
    service, source, writer = rig([row(10, None)])
    now = when(3)
    service.tick(now)
    service.open_months('Test', 2026, [10], close_at(now, 72), 'audited-open', now,
                        actor={'username': 'alice', 'client_ip': '192.168.0.25'})
    service.tick(now + timedelta(seconds=30))
    events = service.store.audit()['entries']
    opened = [e for e in events if e['action'] == 'opened']
    assert len(opened) == 1
    assert opened[0]['actor'] == 'alice'
    assert opened[0]['client_ip'] == '192.168.0.25'
    assert not any(e['action'].startswith('dcr_') for e in events)
    source.rows[0]['allow'] = False
    service.tick(now + timedelta(seconds=60))
    source.rows[0]['allow'] = True
    service.tick(now + timedelta(seconds=90))
    service.tick(now + timedelta(seconds=120))
    events = service.store.audit(origin='dcr')['entries']
    assert [e['action'] for e in events].count('dcr_open_detected') == 1
    assert all(e['actor'] == '(Direct DCR Change)' for e in events)


def test_audit_uncertain_dashboard_open_is_not_misattributed(rig):
    service, source, writer = rig([row(10)])
    now = when(3)
    service.tick(now)
    writer.failure = 'response lost'
    writer.commit_before_failure = True
    service.open_months('Test', 2026, [10], close_at(now, 72), 'uncertain-audit', now,
                        actor={'username': 'alice'})
    service.tick(now + timedelta(seconds=30))
    events = service.store.audit()['entries']
    assert any(e['action'] == 'opening_observed' for e in events)
    assert not any(e['action'].startswith('dcr_') for e in events)
