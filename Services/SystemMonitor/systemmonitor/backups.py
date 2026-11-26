"""Unix socket client connecting SystemMonitor (Docker) to host backup-bridge.service."""

from __future__ import annotations

import json
import re
import socket
from pathlib import Path
from typing import Any

TARGET_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,23}$")
DEST_IP_RE = re.compile(r"^[a-zA-Z0-9._-]{1,128}$")
JOB_KEY_RE = re.compile(r"^(ibs|[a-z0-9][a-z0-9_-]{0,23}_(fast|system3|sql))$")
SERVICE_UNIT_RE = re.compile(
    r"^(backup-target@[a-z0-9][a-z0-9_-]{0,23}\.service"
    r"|backup-job@[a-z0-9][a-z0-9_-]{0,23}_(fast|system3|sql)\.service"
    r"|ibs-backup\.service)$"
)
TIMER_UNIT_RE = re.compile(
    r"^(backup-target-[a-z0-9][a-z0-9_-]{0,23}\.timer|ibs-backup\.timer)$"
)
ALLOWED_CONFIGS = {"backup", "ibs", "notify"}


class BackupBridgeError(RuntimeError):
    """Raised when the host backup bridge is unreachable or returns an error."""

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class BackupBridgeClient:
    """Thin newline-delimited JSON client over a host-shared Unix domain socket."""

    def __init__(self, socket_path: str | Path, timeout: float = 25.0) -> None:
        self.socket_path = Path(socket_path)
        self.timeout = timeout

    def call(self, action: str, params: dict[str, Any] | None = None, timeout: float | None = None) -> dict[str, Any]:
        if not self.socket_path.exists():
            raise BackupBridgeError(
                f"Host backup bridge is not running ({self.socket_path.name} missing). "
                "Run 'sudo bash backups/install.sh' on the host.",
                status_code=503,
            )

        payload = json.dumps({"action": action, "params": params or {}}) + "\n"
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(timeout or self.timeout)
        try:
            sock.connect(str(self.socket_path))
            sock.sendall(payload.encode("utf-8"))
            chunks: list[bytes] = []
            while True:
                data = sock.recv(65536)
                if not data:
                    break
                chunks.append(data)
                if b"\n" in data:
                    break
        except FileNotFoundError as exc:
            raise BackupBridgeError(
                "Host backup bridge socket not found. Run 'sudo bash backups/install.sh' on the host.",
                status_code=503,
            ) from exc
        except (PermissionError, ConnectionRefusedError) as exc:
            raise BackupBridgeError(
                f"Cannot connect to host backup bridge ({exc}). Check 'systemctl status backup-bridge'.",
                status_code=503,
            ) from exc
        except socket.timeout as exc:
            raise BackupBridgeError("Host backup bridge request timed out.", status_code=504) from exc
        except OSError as exc:
            raise BackupBridgeError(f"Host backup bridge error: {exc}", status_code=502) from exc
        finally:
            sock.close()

        raw = b"".join(chunks).decode("utf-8", errors="replace").strip()
        if not raw:
            raise BackupBridgeError("Empty response from host backup bridge.", status_code=502)
        try:
            resp = json.loads(raw.splitlines()[0])
        except json.JSONDecodeError as exc:
            raise BackupBridgeError("Malformed response from host backup bridge.", status_code=502) from exc

        if not isinstance(resp, dict):
            raise BackupBridgeError("Invalid response from host backup bridge.", status_code=502)
        if not resp.get("ok"):
            raise BackupBridgeError(str(resp.get("error") or "Backup operation failed."), status_code=400)
        return resp
