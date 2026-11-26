#!/usr/bin/env python3
"""Host-side Unix socket bridge daemon for SystemMonitor <-> SystemBackups.

Listens on BACKUP_BRIDGE_SOCKET (default: /home/mis/Services/SystemMonitor/data/backup-bridge.sock)
so the unprivileged SystemMonitor Docker container can read live host backup state,
logs, timers, and invoke whitelisted backup-ctl.sh operations without privileged Docker access.
"""

from __future__ import annotations

import json
import os
import signal
import socketserver
import sys
from pathlib import Path
from typing import Any

_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

import backup_engine as eng

DEFAULT_SOCKET = "/home/mis/Services/SystemMonitor/data/backup-bridge.sock"
SOCKET_PATH = Path(os.environ.get("BACKUP_BRIDGE_SOCKET", DEFAULT_SOCKET))
SOCKET_UID = int(os.environ.get("BACKUP_BRIDGE_UID", "1000"))
SOCKET_GID = int(os.environ.get("BACKUP_BRIDGE_GID", "1000"))
MAX_REQUEST_BYTES = 131072


def handle_request(req: dict[str, Any]) -> dict[str, Any]:
    action = str(req.get("action", "")).strip()
    params = req.get("params") or {}
    if not isinstance(params, dict):
        return {"ok": False, "error": "Invalid params"}

    if action == "ping":
        return {"ok": True, "data": {"bridge": "ready"}}

    if action == "status":
        max_age = int(params.get("max_age_hours", eng.DEFAULT_MAX_AGE_HOURS))
        return {"ok": True, "data": eng.collect_full_snapshot(max_age_hours=max_age)}

    if action == "preflight":
        items = [i.to_dict() for i in eng.run_preflight_checks()]
        return {"ok": True, "data": {"items": items}}

    if action == "logs":
        source = str(params.get("source", "file"))
        path = str(params.get("path", ""))
        unit = str(params.get("unit", "")) or None
        lines = max(10, min(1000, int(params.get("lines", 400))))
        files = eng.list_log_files(limit=80)
        if source == "journal":
            content = eng.read_journal(unit=unit, lines=lines)
        elif source == "failures" or not path:
            content = eng.read_log_tail(eng.LOG_DIR / "failures.log", max_lines=lines)
        else:
            content = eng.read_log_tail(path, max_lines=lines)
        return {"ok": True, "data": {"files": files, "content": content}}

    if action == "configs":
        return {"ok": True, "data": {"configs": eng.list_global_configs()}}

    if action == "validate_calendar":
        ok, detail = eng.validate_calendar(str(params.get("schedule", "")))
        return {"ok": True, "data": {"valid": ok, "detail": detail}}

    if action == "run_job":
        ok, msg = eng.start_job(str(params.get("key", "")))
        return {"ok": ok, "message": msg} if ok else {"ok": False, "error": msg}

    if action == "run_target":
        ok, msg = eng.start_target(str(params.get("target", "")))
        return {"ok": ok, "message": msg} if ok else {"ok": False, "error": msg}

    if action == "run_all":
        ok, msg = eng.start_all(include_ibs=bool(params.get("include_ibs", True)))
        return {"ok": ok, "message": msg} if ok else {"ok": False, "error": msg}

    if action == "stop_unit":
        ok, msg = eng.stop_unit(str(params.get("unit", "")))
        return {"ok": ok, "message": msg} if ok else {"ok": False, "error": msg}

    if action == "timer_toggle":
        ok, msg = eng.set_timer_enabled(str(params.get("timer", "")), bool(params.get("enabled", True)))
        return {"ok": ok, "message": msg} if ok else {"ok": False, "error": msg}

    if action == "timer_schedule":
        ok, msg = eng.update_timer_schedule(str(params.get("timer", "")), str(params.get("schedule", "")))
        return {"ok": ok, "message": msg} if ok else {"ok": False, "error": msg}

    if action == "register_target":
        ok, msg = eng.register_target(
            name=str(params.get("name", "")),
            dest_ip=str(params.get("dest_ip", "")),
            schedule=str(params.get("schedule", "")),
            enabled=bool(params.get("enabled", True)),
            username=str(params.get("username", "")),
            password=str(params.get("password", "")),
            domain=str(params.get("domain", "")),
            keep_cred=bool(params.get("keep_cred", False)),
        )
        return {"ok": ok, "message": msg} if ok else {"ok": False, "error": msg}

    if action == "delete_target":
        ok, msg = eng.delete_target(str(params.get("name", "")))
        return {"ok": ok, "message": msg} if ok else {"ok": False, "error": msg}

    if action == "save_config":
        ok, msg = eng.save_global_config(str(params.get("id", "")), str(params.get("content", "")))
        return {"ok": ok, "message": msg} if ok else {"ok": False, "error": msg}

    if action == "test_notify":
        ok, msg = eng.send_test_notify(str(params.get("target", "systemmonitor")))
        return {"ok": ok, "message": msg} if ok else {"ok": False, "error": msg}

    if action == "clear_failures":
        ok, msg = eng.clear_failures()
        return {"ok": ok, "message": msg} if ok else {"ok": False, "error": msg}

    if action == "rebuild_manifest":
        ok, msg = eng.rebuild_manifest()
        return {"ok": ok, "message": msg} if ok else {"ok": False, "error": msg}

    return {"ok": False, "error": f"Unknown action: {action}"}


class BridgeHandler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        raw = self.rfile.readline(MAX_REQUEST_BYTES)
        if not raw:
            return
        try:
            req = json.loads(raw.decode("utf-8"))
            if not isinstance(req, dict):
                resp = {"ok": False, "error": "Request must be a JSON object"}
            else:
                resp = handle_request(req)
        except Exception as exc:
            resp = {"ok": False, "error": f"Bridge error: {exc}"}
        self.wfile.write((json.dumps(resp) + "\n").encode("utf-8"))
        self.wfile.flush()


class ThreadingUnixServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> int:
    SOCKET_PATH.parent.mkdir(parents=True, exist_ok=True)
    if SOCKET_PATH.exists():
        SOCKET_PATH.unlink()

    server = ThreadingUnixServer(str(SOCKET_PATH), BridgeHandler)
    try:
        os.chmod(SOCKET_PATH, 0o660)
        if os.geteuid() == 0:
            os.chown(SOCKET_PATH, SOCKET_UID, SOCKET_GID)
    except OSError as exc:
        print(f"Warning: could not set socket ownership/mode: {exc}", file=sys.stderr)

    def _shutdown(_signum: int, _frame: Any) -> None:
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    print(f"backup-bridge listening on {SOCKET_PATH}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if SOCKET_PATH.exists():
            try:
                SOCKET_PATH.unlink()
            except OSError:
                pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
