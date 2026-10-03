"""Read-only FAST monthly-period inspection; no closing or opening operations."""
import argparse
import json
import os
from datetime import date
from pathlib import Path

import dbf


def monthly_tables(root):
    """Find direct station tables, preserving the share's mixed filename case."""
    for station in sorted(Path(root).iterdir()):
        if not station.is_dir():
            continue
        for folder in station.iterdir():
            if folder.name.lower() != 'dbase' or not folder.is_dir():
                continue
            for path in folder.iterdir():
                if path.name.lower() == 'monthly.dbf' and path.is_file():
                    yield station.name, path


def station_monthly(root, station):
    """Resolve one known station without discovering or reading other stations."""
    if not station or station in ('.', '..') or Path(station).name != station:
        raise ValueError('Invalid station name')
    root = Path(root).resolve()
    directory = root / station
    if not directory.resolve().is_relative_to(root):
        raise ValueError('Station directory is outside the FAST root')
    for folder in directory.iterdir():
        if folder.name.lower() == 'dbase' and folder.is_dir():
            for path in folder.iterdir():
                if path.name.lower() == 'monthly.dbf' and path.is_file():
                    if not path.resolve().is_relative_to(directory.resolve()):
                        raise ValueError('Monthly table is outside the station directory')
                    return path
    raise FileNotFoundError('Station monthly table was not found')


def period_status(active, deleted, first_day_active):
    if active and deleted:
        return 'mixed'
    if first_day_active:
        return 'closed_records_present'
    if active:
        return 'unexpected_dates'
    return 'open_deleted' if deleted else 'missing'


def read_periods(path):
    """Read all period summaries in one read-only pass, including deleted rows."""
    path = Path(path)
    before = path.stat()
    table = dbf.Table(str(path))
    table.open(dbf.READ_ONLY)
    periods = {}
    try:
        if 'TRANS_DATE' not in table.field_names or table.field_info('TRANS_DATE')[:3] != (ord('D'), 8, 0):
            raise ValueError('Expected TRANS_DATE date field in monthly.dbf')
        for record in table:
            day = record.TRANS_DATE
            if not day:
                continue
            key = day.isoformat()[:7]
            counts = periods.setdefault(key, dict(active=0, deleted=0, first_day_active=0, other_days=0))
            if dbf.is_deleted(record):
                counts['deleted'] += 1
            else:
                counts['active'] += 1
                counts['first_day_active'] += day.day == 1
            counts['other_days'] += day.day != 1
        total = len(table)
    finally:
        table.close()
    after = path.stat()
    fingerprint = lambda s: (s.st_ino, s.st_size, s.st_mtime_ns)
    if fingerprint(before) != fingerprint(after):
        raise ValueError('monthly.dbf changed during read; retry inspection')
    return dict(total_records=total, periods={
        key: dict(period=key, status=period_status(c['active'], c['deleted'], c['first_day_active']), **c)
        for key, c in periods.items()})


def empty_period(period):
    return dict(period=period, status='missing', active=0, deleted=0, first_day_active=0, other_days=0)


def read_period(path, year, month):
    key = date(year, month, 1).isoformat()[:7]
    result = read_periods(path)
    return dict(result['periods'].get(key, empty_period(key)), total_records=result['total_records'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=os.getenv('FAST_ROOT', '/mnt/fast_system'))
    parser.add_argument('--year', type=int, required=True)
    parser.add_argument('--month', type=int, required=True)
    parser.add_argument('--station', help='Inspect one station (case insensitive)')
    args = parser.parse_args()
    try:
        date(args.year, args.month, 1)
    except ValueError as error:
        parser.error(str(error))
    found = failed = False
    for station, path in monthly_tables(args.root):
        if args.station and station.casefold() != args.station.casefold():
            continue
        found = True
        result = dict(station=station, path=str(path), read_only=True,
                      generation_excluded=station.casefold() == 'fastmnv')
        try:
            result.update(read_period(path, args.year, args.month))
        except (OSError, ValueError, dbf.DbfError) as error:
            result.update(status='error', error=str(error))
            failed = True
        print(json.dumps(result), flush=True)
    if not found:
        parser.error('No matching station monthly.dbf found')
    return int(failed)


if __name__ == '__main__':
    raise SystemExit(main())
