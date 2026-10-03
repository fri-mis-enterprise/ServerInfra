import os
from pathlib import Path

APPS = {
    'DCR_Bienes': 'DCR_Bienes/DATA/lockmonth.dbf',
    'DCR_DPUE': 'DCR_DPUE/Data/lockmonth.dbf',
    'DCR_MCY': 'DCR_MCY/DATA/lockmonth.dbf',
    'DCR_MMSI': 'DCR_MMSI/data/lockmonth.dbf',
    'DCR_Main': 'DCR_Main/Data/lockmonth.dbf',
    'DCR_Mobility': 'DCR_Mobility/Data/lockmonth.dbf',
    'DCR_Syvill': 'DCR_Syvill/data/lockmonth.dbf',
    'DCR_Vosa': 'DCR_Vosa/data/lockmonth.dbf',
}


class Settings:
    def __init__(self):
        self.root = Path(os.getenv('SYSTEM3_ROOT', '/mnt/system3'))
        self.data = Path(os.getenv('MONITOR_DATA', './data'))
        self.base = os.getenv('BASE_PATH', '/systemmonitor').rstrip('/')
        self.interval = int(os.getenv('POLL_SECONDS', '30'))
        self.writes = os.getenv('ENABLE_WRITES', 'false').lower() == 'true'
        self.password = os.getenv('ADMIN_PASSWORD', '')
        self.secret = os.getenv('SECRET_KEY', '')
        self.trusted_proxy_host = os.getenv('TRUSTED_PROXY_HOST', 'caddy')
        if self.interval < 5:
            raise ValueError('POLL_SECONDS must be at least 5')
        if self.writes and not self.secret:
            raise ValueError('Writes require SECRET_KEY')
