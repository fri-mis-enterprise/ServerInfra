"""Interruption/recovery rehearsal on disposable monthly DBFs under /tmp only.

Replays an existing closed period; does not calculate new ledger summaries.
Never opens the supplied source for writing or installs a production writer.
"""
import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import struct
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

import dbf


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def sync(path):
    with Path(path).open('rb') as stream:
        os.fsync(stream.fileno())


def apply(path, plan, mode, interrupt=None):
    """Only called with disposable trial tables, including the expected result."""
    source = dbf.Table(str(plan), codepage='cp1252')
    source.open(dbf.READ_ONLY)
    target = dbf.Table(str(path), codepage='cp1252')
    target.open(dbf.READ_WRITE)
    try:
        if mode == 'recall':
            records = [r for r in target if dbf.is_deleted(r)]
            for index, record in enumerate(records, 1):
                dbf.undelete(record)
                if interrupt == 'partial' and index == 3:
                    target.close()  # Model three writes accepted by the remote server.
                    sync(path)
                    os._exit(91)
        else:
            for index, record in enumerate(source, 1):
                target.append(record)
                if interrupt == 'partial' and index == 3:
                    target.close()
                    sync(path)
                    os._exit(91)
    finally:
        target.close()
        source.close()
    sync(path)


def worker(folder, interrupt=None):
    """Persist intent before writing; classify uncertain outcomes on restart."""
    folder = Path(folder)
    if not folder.resolve().is_relative_to(Path('/tmp')):
        raise ValueError('Recovery trial must be under /tmp')
    with sqlite3.connect(folder / 'job.sqlite3') as connection:
        connection.execute('PRAGMA synchronous=FULL')
        mode, before, expected, plan_hash, state = connection.execute('SELECT * FROM job').fetchone()
        live, backup = folder / 'monthly.dbf', folder / 'before.dbf'
        if (digest(backup) != before or digest(folder / 'expected.dbf') != expected
                or digest(folder / 'plan.dbf') != plan_hash):
            raise ValueError('Trial backup or expected result is damaged; refusing recovery')
        actual = digest(live)
        if actual == expected:
            connection.execute("UPDATE job SET state='completed'")
            connection.commit()
            return
        if state == 'completed':
            raise ValueError('Completed trial table changed; refusing automatic restoration')
        if actual != before:
            connection.execute("UPDATE job SET state='restoring'")
            connection.commit()
            # In-place restoration is deliberately interruptible for this rehearsal.
            with backup.open('rb') as source, live.open('wb') as target:
                target.write(source.read(128))
                target.flush()
                os.fsync(target.fileno())
                if interrupt == 'restore':
                    os._exit(91)
                shutil.copyfileobj(source, target)
                target.flush()
                os.fsync(target.fileno())
            if digest(live) != before:
                raise ValueError('Restore verification failed')
        connection.execute("UPDATE job SET state='writing'")
        connection.commit()
        if interrupt == 'before':
            os._exit(91)
        apply(live, folder / 'plan.dbf', mode, interrupt)
        if interrupt == 'after':
            os._exit(91)
        if digest(live) != expected:
            raise ValueError('Trial result differs from prepared result')
        connection.execute("UPDATE job SET state='completed'")
        connection.commit()
        if interrupt == 'completed':
            os._exit(91)


def subprocess_worker(folder, interrupt=None):
    code = ('from systemmonitor.fast_trial import worker; import sys; '
            'worker(sys.argv[1], sys.argv[2] or None)')
    return subprocess.run([sys.executable, '-c', code, str(folder), interrupt or ''],
                          check=False).returncode


def period_fixture(source, folder, year, month):
    """Keep raw period rows and one unrelated row, preserving observed DBF fields."""
    stamp = date(year, month, 1).strftime('%Y%m').encode('ascii')
    with Path(source).open('rb') as stream:
        original = stream.read(64 * 1024 * 1024 + 1)
        stream.seek(0)
        if original != stream.read(64 * 1024 * 1024 + 1):
            raise ValueError('Source changed while capturing the trial fixture')
    if len(original) < 32 or len(original) > 64 * 1024 * 1024 or original[0] != 3:
        raise ValueError('Trial supports observed DB3 monthly tables up to 64 MiB')
    count, header, width = struct.unpack_from('<IHH', original, 4)
    fields, offset, date_offset = [], 1, None
    for pos in range(32, header, 32):
        if original[pos] == 13:
            break
        item = original[pos:pos + 32]
        name = item[:11].split(b'\0')[0]
        if chr(item[11]) not in 'CDNL':
            raise ValueError('Trial does not handle memo/index companions or special fields')
        if name == b'TRANS_DATE' and item[11] == ord('D') and item[16] == 8:
            date_offset = offset
        fields.append(name)
        offset += item[16]
    if date_offset is None or offset != width or header + count * width > len(original):
        raise ValueError('Unexpected monthly schema or truncated source')
    period, unrelated = [], []
    for pos in range(header, header + count * width, width):
        record = original[pos:pos + width]
        if record[:1] not in (b' ', b'*'):
            raise ValueError('Invalid deletion flag')
        if record[date_offset:date_offset + 6] == stamp:
            if record[:1] == b'*':
                raise ValueError('Trial reference period must contain only active records')
            period.append(record)
        elif not unrelated:
            unrelated.append(record)
    if len(period) < 4:
        raise ValueError('Trial needs at least four reference-period records')
    def save(name, records):
        prefix = bytearray(original[:header])
        struct.pack_into('<I', prefix, 4, len(records))
        prefix[28] = 0  # Disposable fixture has no production index companions.
        path = folder / name
        path.write_bytes(prefix + b''.join(records) + b'\x1a')
        sync(path)
    save('plan.dbf', period)
    save('closed.dbf', unrelated + period)
    save('recall.dbf', unrelated + [b'*' + r[1:] for r in period])
    save('append.dbf', unrelated)
    return len(period), hashlib.sha256(original).hexdigest()


def record_bytes(path):
    blob = Path(path).read_bytes()
    count, header, width = struct.unpack_from('<IHH', blob, 4)
    return blob[header:header + count * width]


def run_trial(source, year, month):
    folder = Path(tempfile.mkdtemp(prefix='systemmonitor-fast-trial-', dir='/tmp'))
    count, source_hash = period_fixture(source, folder, year, month)
    results = []
    for mode in ('recall', 'append'):
        for failure in ('before', 'partial', 'after', 'completed', 'restore'):
            case = folder / f'{mode}-{failure}'
            case.mkdir()
            for name in ('monthly.dbf', 'before.dbf', 'expected.dbf'):
                shutil.copyfile(folder / f'{mode}.dbf', case / name)
            shutil.copyfile(folder / 'plan.dbf', case / 'plan.dbf')
            apply(case / 'expected.dbf', case / 'plan.dbf', mode)
            if record_bytes(case / 'expected.dbf') != record_bytes(folder / 'closed.dbf'):
                raise RuntimeError('Prepared result does not preserve the reference rows exactly')
            for name in ('before.dbf', 'expected.dbf', 'monthly.dbf', 'plan.dbf'):
                sync(case / name)
            with sqlite3.connect(case / 'job.sqlite3') as connection:
                connection.execute('CREATE TABLE job (mode TEXT, before_hash TEXT, expected_hash TEXT, plan_hash TEXT, state TEXT)')
                connection.execute('INSERT INTO job VALUES (?, ?, ?, ?, ?)',
                                   (mode, digest(case / 'before.dbf'), digest(case / 'expected.dbf'),
                                    digest(case / 'plan.dbf'), 'prepared'))
            initial = 'partial' if failure == 'restore' else failure
            if subprocess_worker(case, initial) != 91:
                raise RuntimeError(f'{case.name}: failed to inject interruption')
            if failure == 'restore' and subprocess_worker(case, 'restore') != 91:
                raise RuntimeError('Failed to interrupt restoration')
            if subprocess_worker(case) != 0 or digest(case / 'monthly.dbf') != digest(case / 'expected.dbf'):
                raise RuntimeError(f'{case.name}: recovery failed')
            # Repeated resume must leave a completed station byte-for-byte unchanged.
            if subprocess_worker(case) != 0 or digest(case / 'monthly.dbf') != digest(case / 'expected.dbf'):
                raise RuntimeError(f'{case.name}: repeated resume changed the result')
            with sqlite3.connect(case / 'job.sqlite3') as connection:
                if connection.execute('SELECT state FROM job').fetchone()[0] != 'completed':
                    raise RuntimeError('Completion was not durable')
            result = dict(operation=mode, interrupted_at=failure, recovered=True)
            results.append(result)
            print(json.dumps(result), flush=True)
    unchanged = digest(source) == source_hash
    report = dict(source=str(source), source_unchanged=unchanged, period=f'{year:04d}-{month:02d}',
                  reference_records=count, source_sha256=source_hash, cases=results,
                  scope='Local DBF/SQLite process-crash rehearsal; no SMB, index, or ledger-generation validation')
    (folder / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'Trial artifacts: {folder}', flush=True)
    return folder


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('/mnt/fast_system/FASTPA2/DBASE/MONTHLY.DBF'))
    parser.add_argument('--year', type=int, default=2026)
    parser.add_argument('--month', type=int, default=9)
    args = parser.parse_args()
    run_trial(args.source, args.year, args.month)


if __name__ == '__main__':
    main()
