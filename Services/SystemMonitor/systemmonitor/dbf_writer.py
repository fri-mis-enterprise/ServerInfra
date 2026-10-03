"""Targeted ALLOW updates using the Python DBF package."""
from datetime import date

import dbf

SCHEMA = ['RECID', 'DATE', 'LOCKED', 'LOCKEDBY', 'LOCKEDDATE', 'ALLOW']


def _logical(value):
    if value is None or value is dbf.Unknown:
        return None
    return bool(value)


def _identity_fields(record):
    locked_at = record.LOCKEDDATE
    if locked_at is not None and locked_at is not dbf.Null:
        locked_at = locked_at.isoformat()
    else:
        locked_at = None
    return (int(record.RECID), record.DATE.isoformat() if record.DATE else None,
            _logical(record.LOCKED), str(record.LOCKEDBY).rstrip(), locked_at)


class DbfWriter:
    """Write only ALLOW, validating the record again against its live DBF row."""

    def __init__(self, source, enabled=False):
        self.source, self.enabled = source, enabled

    def set_allow(self, app, expected_row, value):
        if not self.enabled:
            raise RuntimeError('Read-only mode: DBF updates are disabled')
        if app not in self.source.apps or type(value) is not bool:
            raise ValueError('Invalid application or ALLOW value')
        expected_date = date.fromisoformat(expected_row['date'])
        year_month = expected_row['date'][:7]
        path = self.source.root / self.source.apps[app]
        table = dbf.Table(str(path))
        table.open(dbf.READ_WRITE)
        try:
            if [str(name).upper() for name in table.field_names] != SCHEMA:
                raise ValueError('lockmonth schema changed; refusing to update')
            rows = [record for record in table if not dbf.is_deleted(record)]
            month_rows = [record for record in rows
                          if record.DATE and record.DATE.strftime('%Y-%m') == year_month]
            if len(month_rows) != 1:
                raise ValueError(f'{year_month}: expected one month record, found {len(month_rows)}')
            record = month_rows[0]
            if record.DATE != expected_date or int(record.RECID) != expected_row['recid']:
                raise ValueError('Month record identity changed; refusing to update')
            if sum(int(other.RECID) == int(record.RECID) for other in rows) != 1:
                raise ValueError('Record identifier is ambiguous; refusing to update')
            if _logical(record.ALLOW) is not expected_row['allow']:
                raise ValueError('ALLOW changed before update; refusing to overwrite')
            identity_before = _identity_fields(record)
            dbf.write(record, ALLOW=value)
            if _logical(record.ALLOW) is not value or _identity_fields(record) != identity_before:
                raise RuntimeError('DBF package did not verify an ALLOW-only update')
        finally:
            table.close()

        verified = self.source.month(app, int(year_month[:4]), int(year_month[5:7]))
        if (verified['recid'], verified['date'], verified['allow']) != (
                expected_row['recid'], expected_row['date'], value):
            raise RuntimeError('DBF update could not be verified after closing the table')
