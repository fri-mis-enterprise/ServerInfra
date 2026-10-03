from datetime import date
from pathlib import Path

import dbf
import pytest

from systemmonitor.dbf import Source
from systemmonitor.dbf_writer import DbfWriter


def make_source(tmp_path, values):
    path = tmp_path / 'lockmonth.dbf'
    table = dbf.Table(
        str(path),
        'RECID I; DATE D; LOCKED L; LOCKEDBY C(4); LOCKEDDATE T; ALLOW L',
        dbf_type='vfp', codepage='cp1252',
    )
    table.open(dbf.READ_WRITE)
    for recid, month, allow in values:
        table.append((recid, dbf.Date(2026, month, 3), True, 'TEST', None, allow))
    table.close()
    return Source(tmp_path, {'Test': 'lockmonth.dbf'})


def test_python_writer_opens_and_closes_only_allow(tmp_path):
    source = make_source(tmp_path, [(42, 5, False), (43, 6, False)])
    before = source.read('Test')
    writer = DbfWriter(source, enabled=True)

    writer.set_allow('Test', source.month('Test', 2026, 5), True)
    opened = source.read('Test')
    assert opened[0]['allow'] is True
    assert opened[1] == before[1]
    assert {k: v for k, v in opened[0].items() if k != 'allow'} == {
        k: v for k, v in before[0].items() if k != 'allow'
    }

    writer.set_allow('Test', source.month('Test', 2026, 5), False)
    assert source.read('Test') == before


def test_python_writer_rejects_read_only_and_stale_identity(tmp_path):
    source = make_source(tmp_path, [(42, 5, False)])
    row = source.month('Test', 2026, 5)
    with pytest.raises(RuntimeError, match='Read-only'):
        DbfWriter(source).set_allow('Test', row, True)
    writer = DbfWriter(source, enabled=True)
    changed = dict(row, recid=99)
    with pytest.raises(ValueError, match='identity changed'):
        writer.set_allow('Test', changed, True)
    assert source.month('Test', 2026, 5)['allow'] is False


def test_python_writer_refuses_ambiguous_month_and_duplicate_recid(tmp_path):
    source = make_source(tmp_path, [(42, 5, False), (43, 5, False)])
    with pytest.raises(ValueError, match='found 2'):
        DbfWriter(source, enabled=True).set_allow('Test', source.read('Test')[0], True)

    source = make_source(tmp_path, [(42, 5, False), (42, 6, False)])
    with pytest.raises(ValueError, match='identifier is ambiguous'):
        DbfWriter(source, enabled=True).set_allow('Test', source.month('Test', 2026, 5), True)


def test_python_writer_fills_unknown_allow(tmp_path):
    source = make_source(tmp_path, [(42, 5, dbf.Unknown)])
    writer = DbfWriter(source, enabled=True)
    writer.set_allow('Test', source.month('Test', 2026, 5), False)
    assert source.month('Test', 2026, 5)['allow'] is False
