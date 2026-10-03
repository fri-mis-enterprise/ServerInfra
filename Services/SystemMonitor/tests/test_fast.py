from datetime import date

import dbf
import pytest

from systemmonitor.fast import monthly_tables, read_period


def test_read_only_period_inspection(tmp_path):
    folder = tmp_path / 'FASTPA2' / 'DBASE'
    folder.mkdir(parents=True)
    path = folder / 'MONTHLY.DBF'
    table = dbf.Table(str(path), 'TRANS_DATE D; ACCT_NO C(25)', dbf_type='db3')
    table.open(dbf.READ_WRITE)
    for day in [date(2026, 9, 1), date(2026, 9, 1), date(2026, 8, 1), date(2026, 7, 1), date(2026, 6, 2)]:
        table.append((day, 'TEST'))
    dbf.delete(table[1])
    dbf.delete(table[3])
    table.close()
    before = path.read_bytes()
    assert list(monthly_tables(tmp_path)) == [('FASTPA2', path)]
    result = read_period(path, 2026, 9)
    assert (result['status'], result['active'], result['deleted'], result['first_day_active']) == ('mixed', 1, 1, 1)
    assert read_period(path, 2026, 8)['status'] == 'closed_records_present'
    assert read_period(path, 2026, 7)['status'] == 'open_deleted'
    assert read_period(path, 2026, 6)['status'] == 'unexpected_dates'
    assert read_period(path, 2026, 10)['status'] == 'missing'
    assert path.read_bytes() == before
    with pytest.raises(ValueError):
        read_period(path, 2026, 13)


def test_rejects_wrong_date_schema(tmp_path):
    path = tmp_path / 'monthly.dbf'
    table = dbf.Table(str(path), 'TRANS_DATE C(8)', dbf_type='db3')
    table.open(dbf.READ_WRITE)
    table.close()
    with pytest.raises(ValueError, match='TRANS_DATE date'):
        read_period(path, 2026, 9)
