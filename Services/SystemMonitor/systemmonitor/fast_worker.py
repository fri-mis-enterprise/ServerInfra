"""Process manually requested, read-only FAST scans without periodic share reads."""
import argparse
import logging
import signal
import threading

from .config import Settings
from .fast import monthly_tables, read_periods, station_monthly
from .service import stamp, utcnow
from .store import Store


def scan(root, store, stop=None, station=None):
    store.fast_start(0, stamp(utcnow()))
    try:
        tables = {station: station_monthly(root, station)} if station else dict(monthly_tables(root))
        if not tables:
            raise ValueError('No station monthly tables found')
        store.fast_start(len(tables), stamp(utcnow()))
        store.fast_prepare(tables, stamp(utcnow()))
        for name, path in tables.items():
            if stop and stop.is_set():
                store.fast_finish(stamp(utcnow()), state='interrupted')
                return
            failed = False
            try:
                summary = read_periods(path)
                store.fast_observe(name, stamp(utcnow()), summary=summary)
            except Exception as error:
                failed = True
                logging.exception('FAST read failed for %s', name)
                store.fast_observe(name, stamp(utcnow()), error=str(error))
            store.fast_progress(stamp(utcnow()), failed)
        if not station:
            for previous in store.fast_observations():
                if previous['station'] not in tables:
                    store.fast_observe(previous['station'], stamp(utcnow()),
                                       error='Monthly table no longer found during station discovery')
        store.fast_finish(stamp(utcnow()))
    except Exception as error:
        logging.exception('FAST station discovery failed')
        affected = [station] if station else [row['station'] for row in store.fast_observations()]
        for name in affected:
            store.fast_observe(name, stamp(utcnow()), error=str(error))
        store.fast_finish(stamp(utcnow()), error=str(error), state='error')


def process_requested_scan(root, store, stop=None):
    request = store.claim_fast_scan(stamp(utcnow()))
    if request is None:
        return False
    scan(root, store, stop, request['station'])
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--station', help='With --once, scan only this station')
    args = parser.parse_args()
    if args.station and not args.once:
        parser.error('--station requires --once')
    logging.basicConfig(level=logging.INFO)
    settings = Settings()
    store = Store(settings.data)
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())
    # Separate from the DCR operation lock; refuse a second FAST scanner.
    import fcntl
    with (store.directory / 'fast-scan.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        store.interrupt_fast_scan(stamp(utcnow()))
        store.interrupt_fast_actions(stamp(utcnow()))
        if args.once:
            store.request_fast_scan(args.station, stamp(utcnow()), 'CLI')
            process_requested_scan(settings.fast_root, store, stop)
            return
        while not stop.is_set():
            from .fast_control import process_requested_action
            if not process_requested_action(settings.fast_root, store, settings.fast_writes, stop):
                process_requested_scan(settings.fast_root, store, stop)
            stop.wait(1)  # Poll local SQLite only; an idle worker never accesses FAST.


if __name__ == '__main__':
    main()
