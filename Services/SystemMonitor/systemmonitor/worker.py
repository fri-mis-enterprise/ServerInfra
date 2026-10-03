import logging
import signal
import threading

from .config import APPS, Settings
from .dbf import Source
from .service import Service
from .dbf_writer import DbfWriter
from .store import Store


def main():
    logging.basicConfig(level=logging.INFO)
    settings = Settings()
    store = Store(settings.data)
    source = Source(settings.root, APPS)
    service = Service(store, source, DbfWriter(source, settings.writes), settings.writes)
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())
    while not stop.is_set():
        try:
            service.tick()
        except Exception:
            logging.exception('Monitor cycle failed')
        stop.wait(settings.interval)


if __name__ == '__main__':
    main()
