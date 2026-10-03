"""Mount the FAST share for the FAST worker using the host's existing CIFS login.

Run after a reboot with: python3 scripts/mount_fast_rw.py
This helper never prints or stores the SMB password after mounting.
"""
import os
import subprocess
import tempfile
from pathlib import Path

SOURCE = '//192.168.0.234/fast_system'
TARGET = Path('/home/mis/.local/share/systemmonitor-fast-rw')


def main():
    entries = [line.split() for line in Path('/etc/fstab').read_text().splitlines()
               if len(line.split()) >= 4 and line.split()[1] == '/mnt/fast_system']
    if len(entries) != 1 or entries[0][0] != SOURCE or entries[0][2] != 'cifs':
        raise RuntimeError('Expected exactly one existing FAST CIFS mount entry')
    options = dict(part.split('=', 1) for part in entries[0][3].split(',') if '=' in part)
    username = options.get('username')
    password = options.get('password') or options.get('pass')
    if not username or not password:
        raise RuntimeError('The existing FAST mount entry has no reusable CIFS credentials')
    if not TARGET.is_dir():
        raise RuntimeError(f'Mount directory is missing: {TARGET}')

    def mounted():
        result = subprocess.run(['findmnt', '-n', '-T', str(TARGET), '-o', 'TARGET,SOURCE,FSTYPE,OPTIONS'],
                                capture_output=True, text=True, check=True)
        return result.stdout.split(maxsplit=3)

    current = mounted()
    if current[0] == str(TARGET):
        if current[1] != SOURCE or current[2] != 'cifs' or 'rw' not in current[3].split(','):
            raise RuntimeError('Mount point already contains an unexpected filesystem')
        print('FAST writable mount already active')
        return

    credential_path = None
    attached = False
    try:
        fd, credential_path = tempfile.mkstemp(prefix='systemmonitor-fast-credentials-', dir='/tmp')
        with os.fdopen(fd, 'w') as stream:
            stream.write(f'username={username}\npassword={password}\n')
            if 'domain' in options:
                stream.write(f'domain={options["domain"]}\n')
            stream.flush()
            os.fsync(stream.fileno())
        mount_options = (f'rw,credentials={credential_path},vers=3.1.1,uid=1000,gid=1000,'
                         'file_mode=0660,dir_mode=0770,nosuid,nodev,soft')
        result = subprocess.run(['sudo', '-n', '/usr/bin/mount', '-t', 'cifs', SOURCE,
                                 str(TARGET), '-o', mount_options],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode:
            raise RuntimeError(f'CIFS mount failed (exit {result.returncode})')
        attached = True
        current = mounted()
        if current[0] != str(TARGET) or current[1] != SOURCE or current[2] != 'cifs' or 'rw' not in current[3].split(','):
            raise RuntimeError('New FAST mount is not confirmed read/write')
        with tempfile.NamedTemporaryFile(prefix='.systemmonitor-writecheck-',
                                         dir=TARGET / 'fastsyg' / 'DBASE') as probe:
            probe.write(b'SystemMonitor mount check\n')
            probe.flush()
            os.fsync(probe.fileno())
        print('FAST writable mount verified with a temporary fastsyg file')
    except Exception:
        if attached:
            subprocess.run(['sudo', '-n', '/usr/bin/umount', str(TARGET)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        raise
    finally:
        if credential_path:
            Path(credential_path).unlink(missing_ok=True)


if __name__ == '__main__':
    main()
