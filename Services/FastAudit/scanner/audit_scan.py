import hashlib, json, os, sqlite3, sys, time, traceback, zlib
from datetime import date, datetime
from pathlib import Path
from dbfread import DBF
from dbfread.exceptions import DBFNotFound

FIELDS = {
 "SUMPAY": "TRANS_NO VOUCHER_NO VCH_DATE O_REF SUPPNO PAYEE AMOUNT APP_AMT PAYFOR1 PAYFOR2 PARTICULAR APPROVED APPROVEBY CHECKNO CHKDATE BANK ACCT_NO DEBIT CREDIT GL_POSTED GL_REF CHK_STATUS PRE_BY DEL_BY DEL_DTE CANCEL APVNO".split(),
 "APLEDGER": "ACCT_NO TRN_DATE DESC DEBIT CREDIT TRANS_NO DBF_REF POSTED MODULE PAY_KIND SUPPNO VOUCHER_NO D_ACCT_NO C_ACCT_NO AMOUNT EDITING GLTRANS PARTICULAR".split(),
}
def clean(v): return v.isoformat() if isinstance(v, (date, datetime)) else v
def pack(v): return zlib.compress(json.dumps(v, separators=(",", ":")).encode(), 6)
def unpack(v): return json.loads(zlib.decompress(v).decode())
def digest(v): return hashlib.sha256(json.dumps(v, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
def read(path, table, key):
    attempt = 0
    while attempt < 3:
        try:
            out = {}
            for i, raw in enumerate(DBF(str(path), encoding="cp1252", char_decode_errors="replace", ignore_missing_memofile=True)):
                row = {k: clean(raw.get(k)) for k in FIELDS[table]}; value = str(row.get(key, "")).strip()
                out[value or f"row-{i}"] = row
            return out
        except (BlockingIOError, PermissionError) as error:
            attempt += 1
            if attempt == 3:
                raise
            print(f"Waiting for locked {path}: {error}", flush=True)
            time.sleep(2)
def log_source_error(con, context, error):
    message = f"{context}: {error} (skipped; will retry next scan)"
    con.execute("INSERT INTO error_logs(occurred_at,source,message,details) VALUES(?,?,?,?)", (datetime.now().astimezone().isoformat(), "scanner", message, traceback.format_exc()))
    con.commit()
    print(message, file=sys.stderr, flush=True)

def scan(root, db):
    root = Path(root)
    con = sqlite3.connect(db, timeout=30)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA busy_timeout=30000")
    con.executescript("CREATE TABLE IF NOT EXISTS state(station TEXT,table_name TEXT,record_key TEXT,digest TEXT,record_json BLOB,PRIMARY KEY(station,table_name,record_key)); CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,detected_at TEXT,station TEXT,table_name TEXT,record_key TEXT,operation TEXT,old_record BLOB,new_record BLOB); CREATE TABLE IF NOT EXISTS error_logs(id INTEGER PRIMARY KEY,occurred_at TEXT,source TEXT,message TEXT,details TEXT);")
    for station in root.iterdir():
        try:
            if not station.is_dir(): continue
            d = next((p for p in station.iterdir() if p.name.lower() == "dbase" and p.is_dir()), None)
            if not d: continue
            found = {p.name.lower(): p for p in d.iterdir() if p.is_file()}
        except OSError as error:
            log_source_error(con, str(station), error)
            continue
        files = {"SUMPAY": (found.get("sumpay.dbf"), "TRANS_NO"), "APLEDGER": (found.get("apledger.dbf"), "DBF_REF")}
        for table, (path, keyfield) in files.items():
            try:
                if path is None:
                    raise FileNotFoundError(f"Missing {table}.DBF in {d}")
                current = read(path, table, keyfield)
            except (OSError, DBFNotFound) as error:
                log_source_error(con, f"{station.name}/{table}", error)
                continue
            old = {k: (h, unpack(b)) for k, h, b in con.execute("SELECT record_key,digest,record_json FROM state WHERE station=? AND table_name=?", (station.name, table))}
            if old:
                now = datetime.now().astimezone().isoformat()
                for key in sorted(set(old) | set(current)):
                    before, after = old.get(key), current.get(key); op = "INSERT" if not before and after else "DELETE" if before and not after else "UPDATE" if before and digest(after) != before[0] else None
                    if op: con.execute("INSERT INTO events VALUES(NULL,?,?,?,?,?,?,?)", (now, station.name, table, key, op, pack(before[1]) if before else None, pack(after) if after else None))
            con.execute("DELETE FROM state WHERE station=? AND table_name=?", (station.name, table))
            con.executemany("INSERT INTO state VALUES(?,?,?,?,?)", [(station.name, table, k, digest(v), pack(v)) for k, v in current.items()])
            con.commit()
    con.commit(); con.close()
if __name__ == "__main__":
    try:
        scan(sys.argv[1], sys.argv[2])
    except Exception as error:
        try:
            con = sqlite3.connect(sys.argv[2], timeout=30)
            con.execute("CREATE TABLE IF NOT EXISTS error_logs(id INTEGER PRIMARY KEY,occurred_at TEXT,source TEXT,message TEXT,details TEXT,resolved_at TEXT)")
            con.execute("INSERT INTO error_logs(occurred_at,source,message,details) VALUES(?,?,?,?)", (datetime.now().astimezone().isoformat(), "scanner", str(error), traceback.format_exc()))
            con.commit(); con.close()
        except Exception:
            pass
        print(traceback.format_exc(), file=sys.stderr, flush=True)
        raise
