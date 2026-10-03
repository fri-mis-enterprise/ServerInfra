"""Bounded, read-only reader for the observed lockmonth schema; never opens CDX/DBC."""
import os
import struct
from datetime import date, datetime, timedelta

SCHEMA = [('RECID', 'I', 4), ('DATE', 'D', 8), ('LOCKED', 'L', 1),
          ('LOCKEDBY', 'C', 4), ('LOCKEDDATE', 'T', 8), ('ALLOW', 'L', 1)]
MAX_BYTES = 1024 * 1024


def logical(value):
    if value in (b'T', b't', b'Y', b'y'):
        return True
    if value in (b'F', b'f', b'N', b'n'):
        return False
    if value in (b'?', b' ', b'\0'):
        return None
    raise ValueError('Invalid logical value')


def parse(blob):
    if len(blob) < 32 or blob[0] not in (0x30, 0x31):
        raise ValueError('Unsupported or incomplete FoxPro header')
    count, header, width = struct.unpack_from('<IHH', blob, 4)
    if header < 225 or header > len(blob) or width != 27:
        raise ValueError('Unexpected lockmonth layout')
    fields = []
    for offset in range(32, header, 32):
        if blob[offset] == 13:
            break
        item = blob[offset:offset + 32]
        if len(item) != 32 or item[18] & 2:
            raise ValueError('Unsupported field descriptor or nullable field')
        fields.append((item[:11].split(b'\0')[0].decode('ascii'), chr(item[11]), item[16]))
    else:
        raise ValueError('Missing field terminator')
    if fields != SCHEMA or blob[29] != 3:
        raise ValueError('Schema or code page changed; review before reading')
    end = header + count * width
    if end > len(blob) or blob[end:] not in (b'', b'\x1a'):
        raise ValueError('Record count and file size disagree')
    rows = []
    for pos in range(header, end, width):
        record = blob[pos:pos + width]
        if record[0:1] == b'*':
            continue
        if record[0:1] != b' ':
            raise ValueError('Invalid record deletion marker')
        raw_date = record[5:13]
        day = None if not raw_date.strip(b' 0\0') else date(
            int(raw_date[:4]), int(raw_date[4:6]), int(raw_date[6:8])).isoformat()
        julian, milliseconds = struct.unpack_from('<II', record, 18)
        if milliseconds >= 86400000:
            raise ValueError('Invalid FoxPro time')
        locked_at = (datetime.fromordinal(julian - 1721425) + timedelta(milliseconds=milliseconds)).isoformat() if julian else None
        rows.append(dict(recid=struct.unpack_from('<i', record, 1)[0], date=day,
                         locked=logical(record[13:14]), locked_by=record[14:18].decode('cp1252').rstrip(),
                         locked_at=locked_at, allow=logical(record[26:27])))
    return rows


def read_table(path):
    with open(path, 'rb', buffering=0) as stream:
        before = os.fstat(stream.fileno())
        if before.st_size > MAX_BYTES:
            raise ValueError('lockmonth exceeds the 1 MiB safety limit')
        first = stream.read(MAX_BYTES + 1)
        stream.seek(0)
        second = stream.read(MAX_BYTES + 1)
        after = os.fstat(stream.fileno())
    current = os.stat(path)
    fingerprint = lambda s: (s.st_ino, s.st_size, s.st_mtime_ns)
    if first != second or fingerprint(before) != fingerprint(after) or fingerprint(after) != fingerprint(current):
        raise ValueError('Table changed during read; try on next refresh')
    return parse(first)


class Source:
    def __init__(self, root, apps):
        self.root, self.apps = root, apps

    def read(self, app):
        return read_table(self.root / self.apps[app])

    def month(self, app, year, month):
        key = f'{year:04d}-{month:02d}'
        all_rows = self.read(app)
        rows = [r for r in all_rows if r['date'] and r['date'][:7] == key]
        if len(rows) != 1:
            raise ValueError(f'{key}: expected one month record, found {len(rows)}')
        if sum(r['recid'] == rows[0]['recid'] for r in all_rows) != 1:
            raise ValueError(f'{key}: record identifier is ambiguous')
        return rows[0]
