import json
import shutil
import subprocess
import sys

import pytest

from systemmonitor.fast_station_trial import operate, sha


def test_station_trial_recovers_only_planned_flags(tmp_path):
    # Minimal observed-schema blob: four September rows plus one unrelated row.
    import struct
    blob = bytearray(65 + 5 * 274 + 1)
    blob[0] = 3
    struct.pack_into('<IHH', blob, 4, 5, 65, 274)
    blob[32:42] = b'TRANS_DATE'
    blob[43] = ord('D')
    blob[48] = 8
    blob[64] = 13
    positions = [65 + i * 274 for i in range(4)]
    for pos in positions + [65 + 4 * 274]:
        blob[pos] = ord(' ')
        blob[pos + 1:pos + 9] = b'20260901' if pos in positions else b'20260801'
    blob[-1] = 26
    original = bytes(blob)
    opened = bytearray(blob)
    for pos in positions:
        opened[pos] = ord('*')
    folder, target = tmp_path / 'artifacts', tmp_path / 'target'
    folder.mkdir()
    target.mkdir()
    for name, content in [('monthly.dbf', original), ('monthly.cdx', b'INDEX'), ('opened.dbf', opened)]:
        (folder / name).write_bytes(content)
    for name in ('monthly.dbf', 'monthly.cdx'):
        shutil.copyfile(folder / name, target / name)
    manifest = dict(station='fastsyg', period='2026-09', records=4, positions=positions,
                    dbf_sha256=sha(original), cdx_sha256=sha(b'INDEX'), opened_sha256=sha(opened))
    (folder / 'manifest.json').write_text(json.dumps(manifest))
    import sqlite3
    with sqlite3.connect(folder / 'job.sqlite3') as db:
        db.execute('CREATE TABLE job (state TEXT)')
        db.execute("INSERT INTO job VALUES ('prepared')")
    operate(folder, target, 'open')
    with pytest.raises(ValueError, match='original state'):
        operate(folder, target, 'open')
    result = subprocess.run([sys.executable, '-m', 'systemmonitor.fast_station_trial', 'recall',
                             '--artifacts', str(folder), '--target', str(target), '--interrupt'])
    assert result.returncode == 91
    partial = (target / 'monthly.dbf').read_bytes()
    assert sum(partial[pos] == ord('*') for pos in positions) == 1
    operate(folder, target, 'recall')
    assert (target / 'monthly.dbf').read_bytes() == original
    assert (target / 'monthly.cdx').read_bytes() == b'INDEX'
    operate(folder, target, 'recall')
    changed = bytearray(original)
    changed[positions[0] + 20] = 1
    (target / 'monthly.dbf').write_bytes(changed)
    with pytest.raises(ValueError, match='Other live DBF bytes changed'):
        operate(folder, target, 'recall')
    assert (target / 'monthly.dbf').read_bytes() == changed
    (target / 'monthly.dbf').write_bytes(original)
    (target / 'monthly.cdx').write_bytes(b'CHANGED INDEX')
    with pytest.raises(ValueError, match='Live index changed'):
        operate(folder, target, 'recall')
