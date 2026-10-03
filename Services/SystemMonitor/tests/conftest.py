from copy import deepcopy

import pytest

from systemmonitor.dbf import Source
from systemmonitor.service import Service
from systemmonitor.store import Store


def row(month, allow=False, year=2026, recid=None):
    return dict(recid=recid or month, date=f'{year:04d}-{month:02d}-01',
                allow=allow, locked=True, locked_by='TEST', locked_at=None)


class MemorySource(Source):
    def __init__(self, rows):
        self.apps = {'Test': 'unused'}
        self.rows = rows
        self.error = None

    def read(self, app):
        if self.error:
            raise OSError(self.error)
        return deepcopy(self.rows)


class Writer:
    def __init__(self, source, store):
        self.source, self.store = source, store
        self.calls = []
        self.failure = None
        self.commit_before_failure = False

    def set_allow(self, app, target, value):
        assert any(s['recid'] == target['recid'] for s in self.store.active()), 'Expiry must be durable before writing'
        self.calls.append((target['recid'], value))
        if not self.failure or self.commit_before_failure:
            candidate = next(r for r in self.source.rows if r['recid'] == target['recid'])
            assert candidate['date'] == target['date']
            assert candidate['allow'] == target['allow']
            candidate['allow'] = value
        if self.failure:
            raise OSError(self.failure)


@pytest.fixture
def rig(tmp_path):
    def make(rows, writes=True):
        store = Store(tmp_path)
        source = MemorySource(rows)
        writer = Writer(source, store)
        return Service(store, source, writer, writes), source, writer
    return make
