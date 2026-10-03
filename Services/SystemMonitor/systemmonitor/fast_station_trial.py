"""September 2026 reopening/recall rehearsal for the designated fastsyg station.

This is a station-specific test, not a production closer. It changes only DBF
deletion markers and returns the DBF/CDX to their exact original byte state.
Index maintenance and generation are outside this test's scope.
"""
import argparse
import hashlib
import json
import os
import sqlite3
import struct
from pathlib import Path

SOURCE = Path('/mnt/fast_system/fastsyg/DBASE')


def sha(blob):
    return hashlib.sha256(blob).hexdigest()


def durable(path, blob):
    with path.open('xb') as stream:
        stream.write(blob)
        stream.flush()
        os.fsync(stream.fileno())


def markers(blob):
    if len(blob) < 32 or blob[0] != 3:
        raise ValueError('Unexpected monthly DBF header')
    count, header, width = struct.unpack_from('<IHH', blob, 4)
    if blob[32:43].split(b'\0')[0] != b'TRANS_DATE' or blob[43] != ord('D') or blob[48] != 8:
        raise ValueError('Expected TRANS_DATE as the first date field')
    if width != 274 or header + count * width > len(blob):
        raise ValueError('Unexpected or truncated monthly DBF')
    positions = [pos for pos in range(header, header + count * width, width)
                 if blob[pos + 1:pos + 9] == b'20260901']
    if not positions or any(blob[pos:pos + 1] != b' ' for pos in positions):
        raise ValueError('September reference records must all be active')
    # Refuse a partial period or dates that the intended opening would also affect.
    all_september = [pos for pos in range(header, header + count * width, width)
                     if blob[pos + 1:pos + 7] == b'202609']
    if positions != all_september:
        raise ValueError('September contains unexpected transaction dates')
    return positions


def prepare(folder):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=False)
    sources = {p.name.lower(): p for p in SOURCE.iterdir()}
    blobs = {}
    for name in ('monthly.dbf', 'monthly.cdx'):
        path = sources[name]
        first = path.read_bytes()
        if first != path.read_bytes():
            raise ValueError(f'{name} changed while backing up')
        blobs[name] = first
        durable(folder / name, first)
    positions = markers(blobs['monthly.dbf'])
    opened = bytearray(blobs['monthly.dbf'])
    for pos in positions:
        opened[pos] = ord('*')
    durable(folder / 'opened.dbf', opened)
    manifest = dict(station='fastsyg', period='2026-09', records=len(positions),
                    positions=positions, source=str(SOURCE), dbf_sha256=sha(blobs['monthly.dbf']),
                    cdx_sha256=sha(blobs['monthly.cdx']), opened_sha256=sha(opened))
    durable(folder / 'manifest.json', (json.dumps(manifest, indent=2) + '\n').encode())
    with sqlite3.connect(folder / 'job.sqlite3') as db:
        db.execute('CREATE TABLE job (state TEXT NOT NULL)')
        db.execute("INSERT INTO job VALUES ('prepared')")
    print(json.dumps({k: v for k, v in manifest.items() if k != 'positions'}), flush=True)
    return manifest


def set_state(folder, state):
    with sqlite3.connect(folder / 'job.sqlite3') as db:
        db.execute('PRAGMA synchronous=FULL')
        db.execute('UPDATE job SET state=?', (state,))


def load(folder, target):
    manifest = json.loads((folder / 'manifest.json').read_text())
    original = (folder / 'monthly.dbf').read_bytes()
    if (manifest['station'], manifest['period']) != ('fastsyg', '2026-09'):
        raise ValueError('This trial only supports fastsyg September 2026')
    if sha(original) != manifest['dbf_sha256'] or markers(original) != manifest['positions']:
        raise ValueError('Backup or marker plan failed verification')
    if sha((folder / 'monthly.cdx').read_bytes()) != manifest['cdx_sha256']:
        raise ValueError('Index backup failed verification')
    files = {p.name.lower(): p for p in target.iterdir()}
    path = files['monthly.dbf']
    if sha(files['monthly.cdx'].read_bytes()) != manifest['cdx_sha256']:
        raise ValueError('Live index changed; refusing to proceed')
    live = bytearray(path.read_bytes())
    if len(live) != len(original):
        raise ValueError('Live DBF size changed; manual recovery required')
    for pos in manifest['positions']:
        if live[pos] not in (ord(' '), ord('*')):
            raise ValueError('Unexpected live deletion marker')
        live[pos] = original[pos]
    if bytes(live) != original:
        raise ValueError('Other live DBF bytes changed; refusing automatic overwrite')
    return manifest, original, path


def operate(folder, target, action, interrupt=False):
    folder, target = Path(folder), Path(target)
    manifest, original, path = load(folder, target)
    if action == 'open':
        if sha(path.read_bytes()) != manifest['dbf_sha256']:
            raise ValueError('Live DBF is not in the prepared original state')
        with sqlite3.connect(folder / 'job.sqlite3') as db:
            if db.execute('SELECT state FROM job').fetchone()[0] != 'prepared':
                raise ValueError('Reopening is permitted only once per prepared trial')
        blob = (folder / 'opened.dbf').read_bytes()
        if sha(blob) != manifest['opened_sha256']:
            raise ValueError('Opening plan failed verification')
        set_state(folder, 'opening')
        # No truncation: an interrupted write can only affect the planned markers.
        with path.open('r+b', buffering=0) as stream:
            remaining = memoryview(blob)
            while remaining:
                written = stream.write(remaining)
                if not written:
                    raise OSError('Opening write made no progress')
                remaining = remaining[written:]
            os.fsync(stream.fileno())
        if sha(path.read_bytes()) != manifest['opened_sha256']:
            raise ValueError('Reopening verification failed; resume with recall')
        set_state(folder, 'opened')
    else:
        if sha(path.read_bytes()) == manifest['dbf_sha256']:
            set_state(folder, 'completed')
            print('Already matches the verified original closing state', flush=True)
            return
        set_state(folder, 'recalling')
        with path.open('r+b', buffering=0) as stream:
            for index, pos in enumerate(manifest['positions'], 1):
                stream.seek(pos)
                if stream.write(b' ') != 1:
                    raise OSError('Recall marker write failed')
                if interrupt and index == 3:
                    os.fsync(stream.fileno())
                    os._exit(91)
            os.fsync(stream.fileno())
        final, _, _ = load(folder, target)
        if sha(path.read_bytes()) != final['dbf_sha256']:
            raise ValueError('Final recall differs from the original DBF')
        set_state(folder, 'completed')
    print(json.dumps(dict(action=action, station='fastsyg', period='2026-09',
                          records=manifest['records'], verified=True)), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('prepare', 'open', 'recall'))
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--target', type=Path)
    parser.add_argument('--interrupt', action='store_true')
    args = parser.parse_args()
    if args.action == 'prepare':
        prepare(args.artifacts)
    else:
        if args.target is None:
            parser.error('--target is required')
        operate(args.artifacts, args.target, args.action, args.interrupt)


if __name__ == '__main__':
    main()
