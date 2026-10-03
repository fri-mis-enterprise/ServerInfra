"""Exercise manual FAST changes and recovery on disposable DBF/CDX copies."""
import json
import struct
from datetime import date

import dbf

from systemmonitor.fast import read_period, read_periods
from systemmonitor.fast_control import checked_index, digest, durable, positions, process_requested_action, summarize_bytes
from systemmonitor.service import stamp, utcnow
from systemmonitor.store import Store
from systemmonitor.web import create_app
from test_web import BASE, post, settings, sign_in


SCHEMA = ('TRANS_DATE D; ACCT_NO C(25); ACCT_NAME C(40); ACCT_LEVEL N(1,0); '
          'NORM_BAL C(6); GENERAL C(25); MONTH C(2); YEAR C(4); DEBIT N(15,2); '
          'CREDIT N(15,2); POSTED L; FIND_DATA L; DATE_POST D; NAMOUNT N(20,2); '
          'NBEGAMT N(15,2); LBEGIN L; USER C(50); DATE D; TIME C(8); WORKSTATIO C(20)')


def monthly(root):
    folder = root / 'fastsyg' / 'DBASE'
    folder.mkdir(parents=True)
    path = folder / 'monthly.dbf'
    table = dbf.Table(str(path), SCHEMA, dbf_type='db3')
    table.open(dbf.READ_WRITE)
    for day, account in ((date(2026, 9, 1), 'ONE'), (date(2026, 9, 1), 'TWO'),
                         (date(2026, 8, 1), 'OLD')):
        table.append({'TRANS_DATE': day, 'ACCT_NO': account})
    table.close()
    blob = bytearray(path.read_bytes())
    blob[28] = 1
    path.write_bytes(blob)
    index = bytearray(3072)
    struct.pack_into('<I', index, 0, 1024)
    struct.pack_into('<HH', index, 1024, 3, 1)
    struct.pack_into('<I', index, 1024 + 14, 0xffff)
    index[1024 + 23] = 3
    index[1024 + 24:1024 + 27] = (1536).to_bytes(3, 'little')
    index[1536 + 14] = 0x60
    expression = b'DTOS(TRANS_DATE)\0'
    struct.pack_into('<H', index, 1536 + 506, 1)
    struct.pack_into('<H', index, 1536 + 510, len(expression))
    index[1536 + 512:1536 + 512 + len(expression)] = expression
    (folder / 'monthly.cdx').write_bytes(index)
    return path


def request(store, action, name):
    return store.request_fast_action(name * 32, 'fastsyg', '2026-09', action, 'mis', stamp(utcnow()))


def test_open_close_and_resume_partial_month(tmp_path):
    root = tmp_path / 'share'
    path = monthly(root)
    original = path.read_bytes()
    assert summarize_bytes(original) == read_periods(path)
    index = (path.parent / 'monthly.cdx').read_bytes()
    store = Store(tmp_path / 'data')
    store.fast_prepare(['fastsyg'], stamp(utcnow()))
    request(store, 'open', 'a')
    assert process_requested_action(root, store, True)
    assert store.fast_actions()[0]['state'] == 'completed'
    assert read_period(path, 2026, 9)['status'] == 'open_deleted'
    assert summarize_bytes(path.read_bytes()) == read_periods(path)
    assert read_period(path, 2026, 8)['active'] == 1

    job = request(store, 'close', 'b')
    opened = path.read_bytes()
    folder = store.directory / 'fast-actions' / job['id']
    folder.mkdir(parents=True)
    durable(folder / 'monthly.dbf', opened)
    durable(folder / 'monthly.cdx', index)
    durable(folder / 'manifest.json', json.dumps(dict(station='fastsyg', period='2026-09',
        action='close', dbf_sha256=digest(opened), cdx_sha256=digest(index), records=2)).encode())
    partial = bytearray(opened)
    partial[positions(opened, '2026-09')[0]] = ord(' ')
    path.write_bytes(partial)
    store.fast_action_state(job['id'], 'needs_recovery', stamp(utcnow()), 'simulated interruption')
    assert not process_requested_action(root, store, True)
    store.resume_fast_action(job['id'], stamp(utcnow()))
    assert process_requested_action(root, store, True)
    assert path.read_bytes() == original
    assert (path.parent / 'monthly.cdx').read_bytes() == index
    assert store.fast_actions()[0]['changed'] == 2
    assert store.fast_observations()[0]['summary']['periods']['2026-09']['status'] == 'closed_records_present'


def test_index_filter_and_unrelated_change_block_write(tmp_path):
    root = tmp_path / 'share'
    path = monthly(root)
    store = Store(tmp_path / 'data')
    index_path = path.parent / 'monthly.cdx'
    changed = bytearray(index_path.read_bytes())
    changed[1536 + 14] |= 8
    try:
        checked_index(changed)
    except ValueError:
        pass
    else:
        raise AssertionError('Filtered index must be rejected')
    request(store, 'open', 'c')
    assert process_requested_action(root, store, True)
    assert store.fast_actions()[0]['state'] == 'completed'
    job = request(store, 'close', 'd')
    opened = path.read_bytes()
    folder = store.directory / 'fast-actions' / job['id']
    folder.mkdir(parents=True)
    durable(folder / 'monthly.dbf', opened)
    durable(folder / 'monthly.cdx', index_path.read_bytes())
    durable(folder / 'manifest.json', json.dumps(dict(station='fastsyg', period='2026-09',
        action='close', dbf_sha256=digest(opened), cdx_sha256=digest(index_path.read_bytes()), records=2)).encode())
    altered = bytearray(opened)
    altered[positions(opened, '2026-09')[0] + 10] ^= 1
    path.write_bytes(altered)
    assert process_requested_action(root, store, True)
    assert store.fast_actions()[0]['state'] == 'needs_recovery'
    assert path.read_bytes() == altered


def test_action_api_requires_auth_csrf_and_explicit_enable(rig):
    service, _, _ = rig([])
    service.store.fast_prepare(['fastsyg'], stamp(utcnow()))
    client = create_app(settings(writes=False), service).test_client()
    body = dict(station='fastsyg', period='2026-09', action='open', request_id='a' * 32)
    assert client.post(BASE + '/fast/action', json=body).status_code == 401
    sign_in(client)
    assert client.post(BASE + '/fast/action', json=body).status_code == 400
    assert post(client, '/fast/action', body).status_code == 403
    config = settings(writes=False)
    config.fast_writes = True
    enabled = create_app(config, service).test_client()
    sign_in(enabled)
    assert post(enabled, '/fast/action', {**body, 'station': '../fastsyg'}).status_code == 400
    assert post(enabled, '/fast/action', {**body, 'period': '2026-13'}).status_code == 400
    assert post(enabled, '/fast/action', body).status_code == 202
    assert post(enabled, '/fast/action', body).json['action']['id'] == body['request_id']
    assert post(enabled, '/fast/scan', {'station': 'fastsyg'}).status_code == 409
