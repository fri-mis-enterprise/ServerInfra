from datetime import date
import json

import dbf

from systemmonitor.fast_trial import run_trial


def test_process_crash_recovery_preserves_source(tmp_path):
    source = tmp_path / 'monthly.dbf'
    table = dbf.Table(str(source), 'TRANS_DATE D; ACCT_NO C(25); DEBIT N(15,2)', dbf_type='db3')
    table.open(dbf.READ_WRITE)
    table.append((date(2026, 8, 1), 'UNRELATED', 12.34))
    for index in range(5):
        table.append((date(2026, 9, 1), str(index), index + .25))
    table.close()
    before = source.read_bytes()
    folder = run_trial(source, 2026, 9)
    report = json.loads((folder / 'report.json').read_text())
    assert len(report['cases']) == 10
    assert all(case['recovered'] for case in report['cases'])
    assert report['source_unchanged'] is True
    assert source.read_bytes() == before
