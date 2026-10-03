"""Manual, recoverable deletion-marker changes for existing FAST periods."""
import hashlib
import json
import logging
import os
import re
import struct
from datetime import date

from .fast import period_status, station_monthly
from .service import stamp, utcnow


def digest(data):
    return hashlib.sha256(data).hexdigest()


def durable(path, data):
    with path.open('xb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def checked_index(blob):
    """Allow only a compact CDX directory with unfiltered, deletion-independent tags.

    The directory and tag layouts follow Visual FoxPro's compact index format.
    Unknown layouts fail closed because a filtered/DELETED() tag needs a rebuild.
    """
    if len(blob) < 1536 or len(blob) % 512:
        raise ValueError('Unsupported or truncated monthly index')
    root = struct.unpack_from('<I', blob)[0]
    if root < 1024 or root + 512 > len(blob) or root % 512:
        raise ValueError('Unsupported monthly index directory')
    page = blob[root:root + 512]
    kind, count = struct.unpack_from('<HH', page)
    if kind != 3 or not 1 <= count <= 100:
        raise ValueError('Unsupported monthly index directory tree')
    recmask = struct.unpack_from('<I', page, 14)[0]
    recbytes = page[23]
    if recmask not in (0xffff, 0xffffffff) or recbytes not in (3, 5) or 24 + count * recbytes > 512:
        raise ValueError('Unsupported monthly index directory keys')
    offsets = [int.from_bytes(page[24 + i * recbytes:24 + i * recbytes + 4], 'little') & recmask
               for i in range(count)]
    if len(set(offsets)) != count:
        raise ValueError('Duplicate monthly index tag')
    for offset in offsets:
        if offset < 1024 or offset % 512 or offset + 1024 > len(blob):
            raise ValueError('Invalid monthly index tag offset')
        header = blob[offset:offset + 1024]
        options = header[14]
        key_length = struct.unpack_from('<H', header, 510)[0]
        for_length = struct.unpack_from('<H', header, 506)[0]
        if not options & 32 or options & 8 or for_length not in (0, 1) or not 1 <= key_length <= 511:
            raise ValueError('Filtered or unsupported monthly index tag')
        if for_length == 1 and header[512 + key_length] != 0:
            raise ValueError('Unsupported monthly index filter')
        expression = header[512:512 + key_length].rstrip(b'\0').upper()
        known = (re.fullmatch(rb'LEFT\(ACCT_NO,(?:[1-9]|1[0-9]|2[0-5])\)', expression)
                 or expression in (b'ACCT_NAME', b'DTOS(TRANS_DATE)', b'ALLTRIM(ACCT_NO)',
                                   b'ALLTRIM(MONTH)+ALLTRIM(YEAR)',
                                   b'ALLTRIM(ACCT_NO)+ALLTRIM(MONTH)+ALLTRIM(YEAR)'))
        if not known:
            raise ValueError('Monthly index has an unverified key expression')
    return count


def positions(blob, period):
    if len(blob) < 65 or blob[0] != 3 or blob[28] != 1:
        raise ValueError('Expected a dBase III monthly table with a structural index')
    count, header, width = struct.unpack_from('<IHH', blob, 4)
    if blob[32:43].split(b'\0')[0] != b'TRANS_DATE' or blob[43] != ord('D') or blob[48] != 8:
        raise ValueError('Unexpected monthly TRANS_DATE field')
    if width != 274 or header < 65 or header + count * width > len(blob):
        raise ValueError('Unexpected or truncated monthly table')
    day = period.replace('-', '').encode()
    selected = []
    for pos in range(header, header + count * width, width):
        if blob[pos + 1:pos + 7] == day:
            if blob[pos + 1:pos + 9] != day + b'01':
                raise ValueError('Period contains records outside the first day')
            if blob[pos] not in (ord(' '), ord('*')):
                raise ValueError('Unexpected monthly deletion marker')
            selected.append(pos)
    if not selected:
        raise ValueError('This period has no existing monthly records; generation is not available')
    return selected


def summarize_bytes(blob):
    """Summarize the exact DBF bytes already verified after a write."""
    count, header, width = struct.unpack_from('<IHH', blob, 4)
    periods = {}
    for pos in range(header, header + count * width, width):
        marker = blob[pos]
        if marker not in (ord(' '), ord('*')):
            raise ValueError('Unexpected monthly deletion marker')
        raw = blob[pos + 1:pos + 9]
        if raw == b'        ':
            continue
        if not raw.isdigit():
            raise ValueError('Unexpected monthly transaction date')
        try:
            day = date(int(raw[:4]), int(raw[4:6]), int(raw[6:8]))
        except ValueError as error:
            raise ValueError('Unexpected monthly transaction date') from error
        key = day.isoformat()[:7]
        counts = periods.setdefault(key, dict(active=0, deleted=0, first_day_active=0, other_days=0))
        if marker == ord('*'):
            counts['deleted'] += 1
        else:
            counts['active'] += 1
            counts['first_day_active'] += day.day == 1
        counts['other_days'] += day.day != 1
    return dict(total_records=count, periods={
        key: dict(period=key, status=period_status(c['active'], c['deleted'], c['first_day_active']), **c)
        for key, c in periods.items()})


def verify_live(path, index, original, index_hash, selected):
    if digest(index.read_bytes()) != index_hash:
        raise ValueError('Monthly index changed; manual review required')
    live = bytearray(path.read_bytes())
    actual = bytes(live)
    if len(live) != len(original):
        raise ValueError('Monthly table size changed; manual review required')
    for pos in selected:
        if live[pos] not in (ord(' '), ord('*')):
            raise ValueError('Unexpected deletion marker; manual review required')
        live[pos] = original[pos]
    if live != original:
        raise ValueError('Monthly table changed outside the selected period; manual review required')
    if digest(index.read_bytes()) != index_hash:
        raise ValueError('Monthly index changed; manual review required')
    return actual


def run_action(root, store, job):
    path = station_monthly(root, job['station'])
    index = next((file for file in path.parent.iterdir()
                  if file.name.casefold() == 'monthly.cdx' and file.is_file()), None)
    if index is None:
        raise ValueError('The monthly structural index is missing')
    if not index.resolve().is_relative_to(path.parent.resolve()):
        raise ValueError('Monthly index is outside the station directory')
    folder = store.directory / 'fast-actions' / job['id']
    manifest_path = folder / 'manifest.json'
    if not folder.exists() and not os.access(path, os.W_OK):
        raise PermissionError('FAST monthly table is not writable; check the host and container mounts')
    if folder.exists():
        if not manifest_path.is_file():
            raise ValueError('Incomplete preparation; inspect the saved backup before retrying')
        manifest = json.loads(manifest_path.read_text())
        original = (folder / 'monthly.dbf').read_bytes()
        saved_index = (folder / 'monthly.cdx').read_bytes()
        if (manifest['station'], manifest['period'], manifest['action']) != (
                job['station'], job['period'], job['action']):
            raise ValueError('Saved operation does not match this request')
        if digest(original) != manifest['dbf_sha256'] or digest(saved_index) != manifest['cdx_sha256']:
            raise ValueError('Saved backup checksum failed; manual review required')
        selected = positions(original, job['period'])
        checked_index(saved_index)
    else:
        original = path.read_bytes()
        saved_index = index.read_bytes()
        if path.read_bytes() != original or index.read_bytes() != saved_index:
            raise ValueError('Monthly files changed during backup; retry later')
        selected = positions(original, job['period'])
        checked_index(saved_index)
        folder.parent.mkdir(exist_ok=True)
        folder.mkdir()
        durable(folder / 'monthly.dbf', original)
        durable(folder / 'monthly.cdx', saved_index)
        manifest = dict(station=job['station'], period=job['period'], action=job['action'],
                        dbf_sha256=digest(original), cdx_sha256=digest(saved_index), records=len(selected))
        durable(manifest_path, (json.dumps(manifest) + '\n').encode())
        directory_fd = os.open(folder, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    if len(selected) != manifest['records']:
        raise ValueError('Saved record plan changed; manual review required')
    verify_live(path, index, original, manifest['cdx_sha256'], selected)
    goal = ord('*') if job['action'] == 'open' else ord(' ')
    # Only selected one-byte markers are written. A partial write can be resumed.
    with path.open('r+b', buffering=0) as stream:
        for pos in selected:
            stream.seek(pos)
            if stream.read(1)[0] != goal:
                stream.seek(pos)
                if stream.write(bytes([goal])) != 1:
                    raise OSError('Deletion marker write made no progress')
        os.fsync(stream.fileno())
    final = verify_live(path, index, original, manifest['cdx_sha256'], selected)
    if any(final[pos] != goal for pos in selected):
        raise ValueError('Final monthly marker verification failed')
    summary = summarize_bytes(final)
    period = summary['periods'].get(job['period'])
    if not period or period['active' if job['action'] == 'close' else 'deleted'] != len(selected):
        raise ValueError('Final monthly period count verification failed')
    changed = sum(original[pos] != goal for pos in selected)
    store.complete_fast_action(job, summary, len(selected), changed, stamp(utcnow()))


def process_requested_action(root, store, enabled, stop=None):
    if stop and stop.is_set():
        return False
    job = store.claim_fast_action(stamp(utcnow()))
    if job is None:
        return False
    if not enabled:
        store.fast_action_state(job['id'], 'failed', stamp(utcnow()), 'FAST writes are disabled')
        return True
    try:
        run_action(root, store, job)
    except Exception as error:
        logging.exception('FAST %s failed for %s %s', job['action'], job['station'], job['period'])
        folder = store.directory / 'fast-actions' / job['id']
        state = 'needs_recovery' if (folder / 'manifest.json').exists() else 'failed'
        store.fast_action_state(job['id'], state, stamp(utcnow()), str(error))
    return True
