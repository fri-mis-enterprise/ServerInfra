"""Host-side backup inspection, preflight, and control engine."""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

BACKUP_ETC = Path(os.environ.get("BACKUP_ETC", "/etc/backups"))
STATE_DIR = Path(os.environ.get("BACKUP_STATE_DIR", "/var/lib/vfp-backup/status"))
RUNNING_DIR = Path(os.environ.get("BACKUP_RUNNING_DIR", "/var/lib/vfp-backup/running"))
STAGING_DIR = Path(os.environ.get("BACKUP_STAGING_DIR", "/var/lib/vfp-backup/staging"))
LOG_DIR = Path(os.environ.get("BACKUP_LOG_DIR", "/var/log/vfp-backup"))
SYSTEMD_DIR = Path(os.environ.get("BACKUP_SYSTEMD_DIR", "/etc/systemd/system"))
CTL_SCRIPT = Path(os.environ.get("BACKUP_CTL", "/opt/backups/backup-ctl.sh"))

TARGET_JOBS = ("fast", "system3", "sql")
DEFAULT_MAX_AGE_HOURS = 36


@dataclass
class TargetInfo:
    name: str
    dest_ip: str
    cred_file: str
    cred_configured: bool = False
    cred_username: str = ""


@dataclass
class JobStatus:
    key: str
    target: str
    job: str
    status: str  # RUNNING, OK, FAIL, STALE, NEVER
    last_run: str = "-"
    epoch: int = 0
    duration: int = 0
    duration_fmt: str = "-"
    archive: str = "-"
    size: str = "-"
    message: str = "No runs recorded yet"
    log_path: str = ""
    is_running: bool = False
    running_pid: int = 0
    running_phase: str = ""
    running_log: str = ""
    active_unit: str = ""
    dest_display: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class TimerInfo:
    unit: str
    target: str
    enabled: str
    active: str
    on_calendar: str
    next_run: str
    left: str
    last_run: str
    description: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class MountInfo:
    name: str
    path: str
    exists: bool
    is_mount: bool


@dataclass
class SystemHealth:
    mounts: list[MountInfo] = field(default_factory=list)
    staging_path: str = str(STAGING_DIR)
    staging_free: str = "-"
    staging_total: str = "-"
    staging_used_pct: float = 0.0
    pigz_available: bool = False
    ctl_ok: bool = False
    ctl_message: str = ""
    failure_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "mounts": [asdict(m) for m in self.mounts],
            "staging_path": self.staging_path,
            "staging_free": self.staging_free,
            "staging_total": self.staging_total,
            "staging_used_pct": round(self.staging_used_pct, 1),
            "pigz_available": self.pigz_available,
            "ctl_ok": self.ctl_ok,
            "ctl_message": self.ctl_message,
            "failure_count": self.failure_count,
        }


@dataclass
class PreflightItem:
    category: str
    name: str
    ok: bool
    detail: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def format_duration(seconds: int) -> str:
    if seconds < 0:
        seconds = 0
    hours, rem = divmod(seconds, 3600)
    mins, secs = divmod(rem, 60)
    if hours > 0:
        return f"{hours}h{mins:02d}m{secs:02d}s"
    return f"{mins}m{secs:02d}s"


def format_bytes(num: int) -> str:
    val = float(num)
    for unit in ("B", "K", "M", "G", "T"):
        if abs(val) < 1024.0:
            return f"{val:.1f}{unit}" if unit != "B" else f"{int(val)}B"
        val /= 1024.0
    return f"{val:.1f}P"


def _parse_kv_file(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    if not path.is_file():
        return data
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return data
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip()
        if len(v) >= 2 and ((v[0] == '"' and v[-1] == '"') or (v[0] == "'" and v[-1] == "'")):
            v = v[1:-1]
        data[k] = v
    return data


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if Path(f"/proc/{pid}").exists():
        return True
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except OSError:
        return False


def load_global_config() -> dict[str, str]:
    defaults = {
        "VERIFY_ARCHIVE": "1",
        "LOCK_WAIT_SECS": "300",
        "CIFS_UID": "1000",
        "CIFS_GID": "1000",
        "FAST_SRC": "/mnt/fast_system",
        "SYSTEM3_SRC": "/mnt/system3",
        "SQL_SRC": "/mnt/sql_database",
    }
    defaults.update(_parse_kv_file(BACKUP_ETC / "backup.conf"))
    return defaults


def load_ibs_config() -> dict[str, str]:
    defaults = {
        "PG_HOST": "34.71.89.115",
        "PG_PORT": "5432",
        "PG_USER": "postgres",
        "PGPASS_FILE": str(BACKUP_ETC / "creds" / "ibs.pgpass"),
        "IBS_BASE_DIR": "/home/mis/IBS_Dumps",
    }
    defaults.update(_parse_kv_file(BACKUP_ETC / "ibs.conf"))
    return defaults


def _cred_summary(cred_file: str) -> tuple[bool, str]:
    """Check if credential file exists and extract ONLY username (never password)."""
    if not cred_file:
        return False, ""
    p = Path(cred_file)
    try:
        if not p.is_file():
            return False, ""
        kv = _parse_kv_file(p)
        return True, kv.get("username", "")
    except OSError:
        # Non-root caller cannot read root-only 0700 creds dir
        return True, ""


def discover_targets() -> list[TargetInfo]:
    targets_dir = BACKUP_ETC / "targets"
    targets: list[TargetInfo] = []
    if targets_dir.is_dir():
        for conf in sorted(targets_dir.glob("*.conf")):
            kv = _parse_kv_file(conf)
            cred_path = kv.get("CRED_FILE", "")
            cred_ok, cred_user = _cred_summary(cred_path)
            targets.append(
                TargetInfo(
                    name=conf.stem,
                    dest_ip=kv.get("DEST_IP", "-"),
                    cred_file=cred_path,
                    cred_configured=cred_ok,
                    cred_username=cred_user,
                )
            )
    return targets


def _active_backup_services() -> set[str]:
    try:
        res = subprocess.run(
            [
                "systemctl",
                "list-units",
                "--type=service",
                "--state=activating,active",
                "--no-legend",
                "--plain",
                "backup-target@*.service",
                "backup-job@*.service",
                "ibs-backup.service",
            ],
            capture_output=True,
            text=True,
            timeout=3,
        )
    except (OSError, subprocess.SubprocessError):
        return set()

    active: set[str] = set()
    for line in res.stdout.splitlines():
        parts = line.split()
        if parts:
            active.add(parts[0])
    return active


def _read_running_state(key: str) -> dict[str, str] | None:
    run_file = RUNNING_DIR / f"{key}.running"
    if not run_file.is_file():
        return None
    kv = _parse_kv_file(run_file)
    try:
        pid = int(kv.get("PID", "0"))
    except ValueError:
        pid = 0
    if pid and not _pid_alive(pid):
        return None
    return kv


def collect_job_statuses(max_age_hours: int = DEFAULT_MAX_AGE_HOURS) -> list[JobStatus]:
    now = int(time.time())
    max_age_secs = max_age_hours * 3600
    targets = discover_targets()
    ibs_cfg = load_ibs_config()
    active_units = _active_backup_services()

    entries: list[tuple[str, str, str, str]] = []
    for t in targets:
        for job in TARGET_JOBS:
            entries.append((f"{t.name}_{job}", t.name, job, t.dest_ip))
    entries.append(("ibs", "ibs", "ibs", f"{ibs_cfg.get('PG_HOST', '-')}:{ibs_cfg.get('PG_PORT', '5432')}"))

    results: list[JobStatus] = []
    for key, target, job, dest in entries:
        status_kv = _parse_kv_file(STATE_DIR / f"{key}.status")
        running_kv = _read_running_state(key)

        if key == "ibs":
            unit_candidates = ["ibs-backup.service", "backup-job@ibs.service"]
        else:
            unit_candidates = [f"backup-job@{key}.service", f"backup-target@{target}.service"]
        active_unit = next((u for u in unit_candidates if u in active_units), "")

        raw_status = status_kv.get("STATUS", "")
        ts = status_kv.get("TIMESTAMP", "-")
        try:
            epoch = int(status_kv.get("EPOCH", "0"))
        except ValueError:
            epoch = 0
        try:
            duration = int(status_kv.get("DURATION", "0"))
        except ValueError:
            duration = 0
        archive = status_kv.get("ARCHIVE", "-")
        size = status_kv.get("SIZE", "-")
        message = status_kv.get("MESSAGE", "No runs recorded yet")
        log_path = status_kv.get("LOG", "")

        is_running = False
        running_pid = 0
        running_phase = ""
        running_log = ""

        if running_kv is not None:
            is_running = True
            try:
                running_pid = int(running_kv.get("PID", "0"))
            except ValueError:
                running_pid = 0
            try:
                start_epoch = int(running_kv.get("START_EPOCH", str(now)))
            except ValueError:
                start_epoch = now
            duration = max(0, now - start_epoch)
            ts = running_kv.get("TIMESTAMP", ts)
            running_phase = running_kv.get("PHASE", "Running...")
            running_log = running_kv.get("LOG", "")
            if running_log:
                log_path = running_log
            disp_status = "RUNNING"
            message = running_phase
            if not active_unit:
                active_unit = "ibs-backup.service" if key == "ibs" else f"backup-job@{key}.service"
        elif active_unit and (
            active_unit == "ibs-backup.service" or active_unit == f"backup-job@{key}.service"
        ):
            is_running = True
            disp_status = "RUNNING"
            running_phase = "Starting service..."
            message = running_phase
            duration = 0
        elif not raw_status:
            disp_status = "NEVER"
        elif raw_status != "OK":
            disp_status = raw_status
        elif epoch > 0 and (now - epoch) > max_age_secs:
            disp_status = "STALE"
        else:
            disp_status = "OK"

        results.append(
            JobStatus(
                key=key,
                target=target,
                job=job,
                status=disp_status,
                last_run=ts,
                epoch=epoch,
                duration=duration,
                duration_fmt=format_duration(duration) if disp_status != "NEVER" else "-",
                archive=archive,
                size=size,
                message=message,
                log_path=log_path,
                is_running=is_running,
                running_pid=running_pid,
                running_phase=running_phase,
                running_log=running_log,
                active_unit=active_unit,
                dest_display=dest,
            )
        )

    return results


def _parse_timer_file(timer_path: Path) -> tuple[str, str]:
    on_cal = "-"
    desc = ""
    if not timer_path.is_file():
        return on_cal, desc
    try:
        for line in timer_path.read_text(encoding="utf-8", errors="replace").splitlines():
            s = line.strip()
            if s.startswith("OnCalendar="):
                on_cal = s.split("=", 1)[1].strip()
            elif s.startswith("Description="):
                desc = s.split("=", 1)[1].strip()
    except OSError:
        pass
    return on_cal, desc


def _format_usec_timestamp(usec: int | None) -> str:
    if not usec or usec <= 0:
        return "-"
    try:
        return datetime.fromtimestamp(usec / 1_000_000).strftime("%Y-%m-%d %H:%M:%S")
    except (OSError, ValueError, OverflowError):
        return "-"


def _format_time_delta(target_usec: int | None) -> str:
    if not target_usec or target_usec <= 0:
        return "-"
    diff = int(target_usec / 1_000_000 - time.time())
    if diff <= 0:
        return "now"
    days, rem = divmod(diff, 86400)
    hours, rem = divmod(rem, 3600)
    mins, secs = divmod(rem, 60)
    if days > 0:
        return f"{days}d {hours}h"
    if hours > 0:
        return f"{hours}h {mins}m"
    if mins > 0:
        return f"{mins}m {secs}s"
    return f"{secs}s"


def collect_timers() -> list[TimerInfo]:
    timer_units: list[str] = []
    if SYSTEMD_DIR.is_dir():
        for p in sorted(SYSTEMD_DIR.glob("backup-target-*.timer")):
            timer_units.append(p.name)
        if (SYSTEMD_DIR / "ibs-backup.timer").is_file():
            timer_units.append("ibs-backup.timer")

    live_map: dict[str, dict[str, Any]] = {}
    try:
        res = subprocess.run(
            [
                "systemctl",
                "list-timers",
                "--all",
                "--output=json",
                "backup-target-*.timer",
                "ibs-backup.timer",
            ],
            capture_output=True,
            text=True,
            timeout=4,
        )
        if res.returncode == 0 and res.stdout.strip().startswith("["):
            for item in json.loads(res.stdout):
                unit = item.get("unit", "")
                if unit:
                    live_map[unit] = item
                    if unit not in timer_units:
                        timer_units.append(unit)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        pass

    states_map: dict[str, tuple[str, str]] = {}
    if timer_units:
        try:
            res = subprocess.run(
                [
                    "systemctl",
                    "show",
                    *timer_units,
                    "--property=Id,UnitFileState,ActiveState",
                ],
                capture_output=True,
                text=True,
                timeout=3,
            )
            if res.returncode == 0:
                for block in res.stdout.strip().split("\n\n"):
                    props: dict[str, str] = {}
                    for line in block.splitlines():
                        if "=" in line:
                            k, v = line.split("=", 1)
                            props[k.strip()] = v.strip()
                    uid = props.get("Id", "")
                    if uid:
                        states_map[uid] = (
                            props.get("UnitFileState", "disabled") or "disabled",
                            props.get("ActiveState", "inactive") or "inactive",
                        )
        except (OSError, subprocess.SubprocessError):
            pass

    timers: list[TimerInfo] = []
    for unit in timer_units:
        on_cal, desc = _parse_timer_file(SYSTEMD_DIR / unit)
        target = "ibs" if unit == "ibs-backup.timer" else unit.removeprefix("backup-target-").removesuffix(".timer")
        enabled, active = states_map.get(unit, ("unknown", "unknown"))

        live = live_map.get(unit, {})
        next_usec = live.get("next")
        last_usec = live.get("last")

        timers.append(
            TimerInfo(
                unit=unit,
                target=target,
                enabled=enabled,
                active=active,
                on_calendar=on_cal,
                next_run=_format_usec_timestamp(next_usec),
                left=_format_time_delta(next_usec),
                last_run=_format_usec_timestamp(last_usec),
                description=desc,
            )
        )

    return timers


def _mounted_paths() -> set[str]:
    mounts: set[str] = set()
    try:
        for line in Path("/proc/mounts").read_text(encoding="utf-8", errors="replace").splitlines():
            parts = line.split()
            if len(parts) >= 2:
                mounts.add(parts[1].replace("\\040", " "))
    except OSError:
        pass
    return mounts


def run_ctl(args: list[str], stdin_data: str | None = None, timeout: int = 25) -> tuple[bool, str]:
    if not CTL_SCRIPT.is_file():
        return False, f"Control helper not installed: {CTL_SCRIPT} (run sudo bash backups/install.sh)"

    cmd = [str(CTL_SCRIPT), *args] if os.geteuid() == 0 else ["sudo", "-n", str(CTL_SCRIPT), *args]
    try:
        res = subprocess.run(cmd, input=stdin_data, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError as exc:
        return False, f"Command not found: {exc}"
    except subprocess.TimeoutExpired:
        return False, f"Timed out running: {' '.join(args)}"
    except OSError as exc:
        return False, str(exc)

    out = (res.stdout.strip() + ("\n" + res.stderr.strip() if res.stderr.strip() else "")).strip()
    if res.returncode != 0:
        if "password is required" in out.lower():
            return False, "Passwordless control not configured yet. Run: sudo bash backups/install.sh"
        return False, out or f"Command exited with status {res.returncode}"
    return True, out or "OK"


def collect_system_health(check_ctl: bool = False) -> SystemHealth:
    cfg = load_global_config()
    mounted = _mounted_paths()
    mounts: list[MountInfo] = []
    for label, key in (("FAST", "FAST_SRC"), ("SYS3", "SYSTEM3_SRC"), ("SQL", "SQL_SRC")):
        p = cfg.get(key, "").rstrip("/")
        is_mnt = bool(p) and (p in mounted)
        exists = is_mnt or (bool(p) and os.path.isdir(p))
        mounts.append(MountInfo(name=label, path=p, exists=exists, is_mount=is_mnt))

    staging_free = "-"
    staging_total = "-"
    staging_pct = 0.0
    try:
        usage = shutil.disk_usage(STAGING_DIR if STAGING_DIR.exists() else "/")
        staging_free = format_bytes(usage.free)
        staging_total = format_bytes(usage.total)
        staging_pct = (usage.used / usage.total * 100.0) if usage.total else 0.0
    except OSError:
        pass

    failures_file = LOG_DIR / "failures.log"
    failure_count = 0
    if failures_file.is_file():
        try:
            failure_count = sum(1 for ln in failures_file.read_text(encoding="utf-8", errors="replace").splitlines() if ln.strip())
        except OSError:
            pass

    ctl_ok, ctl_msg = run_ctl(["health"], timeout=5) if check_ctl else (True, "OK")
    return SystemHealth(
        mounts=mounts,
        staging_path=str(STAGING_DIR),
        staging_free=staging_free,
        staging_total=staging_total,
        staging_used_pct=staging_pct,
        pigz_available=shutil.which("pigz") is not None,
        ctl_ok=ctl_ok,
        ctl_message=ctl_msg,
        failure_count=failure_count,
    )


def _aggregate_status(jobs: list[JobStatus]) -> str:
    statuses = {j.status for j in jobs}
    if "RUNNING" in statuses:
        return "RUNNING"
    if "FAIL" in statuses:
        return "FAIL"
    if "STALE" in statuses:
        return "STALE"
    if statuses == {"OK"}:
        return "OK"
    if "OK" in statuses:
        return "PARTIAL"
    return "NEVER"


def collect_full_snapshot(max_age_hours: int = DEFAULT_MAX_AGE_HOURS) -> dict[str, Any]:
    """Build grouped target-tile snapshot for SystemMonitor web UI and CLI --json."""
    targets_meta = {t.name: t for t in discover_targets()}
    ibs_cfg = load_ibs_config()
    jobs = collect_job_statuses(max_age_hours=max_age_hours)
    timers = collect_timers()
    timers_by_target = {t.target: t for t in timers}
    health = collect_system_health(check_ctl=False)
    failures = read_failures_tail(20)

    grouped: dict[str, list[JobStatus]] = {}
    for j in jobs:
        grouped.setdefault(j.target, []).append(j)

    target_tiles: list[dict[str, Any]] = []
    for name in sorted(targets_meta.keys()):
        meta = targets_meta[name]
        t_jobs = grouped.get(name, [])
        t_timer = timers_by_target.get(name)
        running_job = next((j for j in t_jobs if j.is_running), None)
        last_epoch = max((j.epoch for j in t_jobs), default=0)
        last_run = max((j.last_run for j in t_jobs if j.last_run != "-"), default="-")
        target_tiles.append(
            {
                "name": name,
                "kind": "cifs",
                "dest_ip": meta.dest_ip,
                "cred_configured": meta.cred_configured,
                "cred_username": meta.cred_username,
                "status": _aggregate_status(t_jobs),
                "is_running": running_job is not None,
                "active_phase": running_job.running_phase if running_job else "",
                "last_run": last_run,
                "last_epoch": last_epoch,
                "jobs": [j.to_dict() for j in t_jobs],
                "timer": t_timer.to_dict() if t_timer else None,
            }
        )

    # Always include IBS tile
    ibs_jobs = grouped.get("ibs", [])
    ibs_timer = timers_by_target.get("ibs")
    ibs_running = next((j for j in ibs_jobs if j.is_running), None)
    target_tiles.append(
        {
            "name": "ibs",
            "kind": "ibs",
            "dest_ip": f"{ibs_cfg.get('PG_HOST', '-')}:{ibs_cfg.get('PG_PORT', '5432')}",
            "cred_configured": Path(ibs_cfg.get("PGPASS_FILE", "")).is_file() if os.geteuid() == 0 else True,
            "cred_username": ibs_cfg.get("PG_USER", "postgres"),
            "status": _aggregate_status(ibs_jobs),
            "is_running": ibs_running is not None,
            "active_phase": ibs_running.running_phase if ibs_running else "",
            "last_run": ibs_jobs[0].last_run if ibs_jobs else "-",
            "last_epoch": ibs_jobs[0].epoch if ibs_jobs else 0,
            "jobs": [j.to_dict() for j in ibs_jobs],
            "timer": ibs_timer.to_dict() if ibs_timer else None,
        }
    )

    overall_healthy = not any(j.status in ("FAIL", "STALE") for j in jobs)
    return {
        "healthy": overall_healthy,
        "max_age_hours": max_age_hours,
        "targets": target_tiles,
        "jobs": [j.to_dict() for j in jobs],
        "timers": [t.to_dict() for t in timers],
        "health": health.to_dict(),
        "recent_failures": failures,
    }


def _tcp_probe(host: str, port: int, timeout: float = 1.5) -> tuple[bool, str]:
    start = time.monotonic()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            ms = int((time.monotonic() - start) * 1000)
            return True, f"Reachable ({ms}ms)"
    except OSError as exc:
        return False, f"Unreachable ({exc.__class__.__name__}: {exc})"


def run_preflight_checks() -> list[PreflightItem]:
    items: list[PreflightItem] = []
    cfg = load_global_config()
    ibs = load_ibs_config()
    mounted = _mounted_paths()

    for label, key, require_mount in (
        ("FAST source", "FAST_SRC", False),
        ("System3 source", "SYSTEM3_SRC", True),
        ("SQL source", "SQL_SRC", True),
    ):
        p = cfg.get(key, "").rstrip("/")
        is_mnt = bool(p) and (p in mounted)
        exists = is_mnt or (bool(p) and os.path.isdir(p))
        ok = is_mnt if require_mount else exists
        detail = f"{p} (mounted)" if is_mnt else (f"{p} (directory exists, not mounted)" if exists else f"{p} (missing)")
        items.append(PreflightItem("Mounts", label, ok, detail))

    try:
        usage = shutil.disk_usage(STAGING_DIR if STAGING_DIR.exists() else "/")
        free_gb = usage.free / (1024**3)
        items.append(
            PreflightItem(
                "Storage",
                "Staging disk",
                free_gb >= 1.0,
                f"{format_bytes(usage.free)} free / {format_bytes(usage.total)} ({STAGING_DIR})",
            )
        )
    except OSError as exc:
        items.append(PreflightItem("Storage", "Staging disk", False, str(exc)))

    for tool, required in (
        ("tar", True),
        ("pigz", False),
        ("mount.cifs", True),
        ("pg_dump", True),
        ("flock", True),
        ("curl", False),
    ):
        path = shutil.which(tool) or (f"/sbin/{tool}" if Path(f"/sbin/{tool}").exists() else None)
        if not path and Path(f"/usr/sbin/{tool}").exists():
            path = f"/usr/sbin/{tool}"
        ok = path is not None
        note = path if path else ("MISSING (required)" if required else "not installed (optional)")
        items.append(PreflightItem("Tools", tool, ok or not required, note))

    mailer = shutil.which("msmtp") or shutil.which("mail")
    items.append(PreflightItem("Tools", "Email sender", mailer is not None, mailer or "Neither msmtp nor mail installed"))

    ctl_ok, ctl_msg = run_ctl(["health"], timeout=5)
    items.append(PreflightItem("Control", "backup-ctl helper", ctl_ok, ctl_msg))

    for t in discover_targets():
        ok, detail = _tcp_probe(t.dest_ip, 445)
        items.append(PreflightItem("Network", f"{t.name} SMB ({t.dest_ip}:445)", ok, detail))

    pg_host = ibs.get("PG_HOST", "")
    try:
        pg_port = int(ibs.get("PG_PORT", "5432"))
    except ValueError:
        pg_port = 5432
    if pg_host:
        ok, detail = _tcp_probe(pg_host, pg_port)
        items.append(PreflightItem("Network", f"IBS Postgres ({pg_host}:{pg_port})", ok, detail))

    return items


# ---- Control Actions ----

def start_job(key: str) -> tuple[bool, str]:
    return run_ctl(["run-job", key])


def start_target(target: str) -> tuple[bool, str]:
    return run_ctl(["run-target", target])


def start_all(include_ibs: bool = True) -> tuple[bool, str]:
    return run_ctl(["run-all", "1" if include_ibs else "0"])


def stop_unit(unit: str) -> tuple[bool, str]:
    return run_ctl(["stop-unit", unit])


def set_timer_enabled(timer: str, enabled: bool) -> tuple[bool, str]:
    return run_ctl(["timer-enable" if enabled else "timer-disable", timer])


def validate_calendar(expr: str) -> tuple[bool, str]:
    expr = expr.strip()
    if not expr:
        return False, "Schedule cannot be empty"
    if not shutil.which("systemd-analyze"):
        return True, "systemd-analyze unavailable; skipping preview"
    try:
        res = subprocess.run(["systemd-analyze", "calendar", expr], capture_output=True, text=True, timeout=3)
        out = (res.stdout or res.stderr).strip()
        if res.returncode != 0:
            return False, out or "Invalid calendar expression"
        for line in out.splitlines():
            if "Next elapse:" in line:
                return True, line.strip()
        return True, "Valid schedule"
    except (OSError, subprocess.SubprocessError) as exc:
        return False, str(exc)


def update_timer_schedule(timer: str, schedule: str) -> tuple[bool, str]:
    return run_ctl(["timer-schedule", timer, schedule.strip()])


def register_target(
    name: str,
    dest_ip: str,
    schedule: str,
    enabled: bool = True,
    username: str = "",
    password: str = "",
    domain: str = "",
    keep_cred: bool = False,
) -> tuple[bool, str]:
    lines = [f"username={username}", f"password={password}"]
    if domain:
        lines.append(f"domain={domain}")
    stdin_payload = "\n".join(lines) + "\n"
    return run_ctl(
        [
            "register-target",
            name.strip().lower(),
            dest_ip.strip(),
            schedule.strip(),
            "1" if enabled else "0",
            "1" if keep_cred else "0",
        ],
        stdin_data=stdin_payload,
    )


def delete_target(name: str) -> tuple[bool, str]:
    return run_ctl(["delete-target", name.strip().lower()])


def send_test_notify(target: str = "systemmonitor") -> tuple[bool, str]:
    return run_ctl(["test-notify", target], timeout=25)


def clear_failures() -> tuple[bool, str]:
    return run_ctl(["clear-failures"])


def rebuild_manifest() -> tuple[bool, str]:
    return run_ctl(["rebuild-manifest"])


# ---- Non-credential Configs ----

def list_global_configs() -> list[dict[str, str]]:
    items = [
        ("backup", "Global Settings (backup.conf)", BACKUP_ETC / "backup.conf"),
        ("ibs", "IBS PostgreSQL (ibs.conf)", BACKUP_ETC / "ibs.conf"),
        ("notify", "Notifications (notify.conf)", BACKUP_ETC / "notify.conf"),
    ]
    out: list[dict[str, str]] = []
    for cid, label, path in items:
        content = ""
        if path.is_file():
            try:
                content = path.read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                content = f"# Cannot read {path}: {exc}\n"
        out.append({"id": cid, "label": label, "path": str(path), "content": content})
    return out


def save_global_config(cfg_id: str, content: str) -> tuple[bool, str]:
    if not content.endswith("\n"):
        content += "\n"
    return run_ctl(["set-config", cfg_id], stdin_data=content)


# ---- Logs & journald ----

def list_log_files(limit: int = 80) -> list[dict[str, Any]]:
    if not LOG_DIR.is_dir():
        return []
    files: list[Path] = []
    try:
        for p in LOG_DIR.iterdir():
            if p.is_file() and p.suffix == ".log":
                files.append(p)
    except OSError:
        return []
    files.sort(key=lambda p: (p.name != "failures.log", -p.stat().st_mtime if p.exists() else 0))
    out: list[dict[str, Any]] = []
    for p in files[:limit]:
        try:
            st = p.stat()
            out.append(
                {
                    "name": p.name,
                    "path": str(p),
                    "size": format_bytes(st.st_size),
                    "mtime": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
                }
            )
        except OSError:
            continue
    return out


def read_log_tail(path: str | Path, max_lines: int = 400) -> str:
    p = Path(path)
    if not str(p):
        return "(No log file path provided)"
    # Security: only allow reading files inside LOG_DIR
    try:
        resolved = p.resolve()
        log_root = LOG_DIR.resolve()
        if resolved != log_root and log_root not in resolved.parents:
            return "(Access denied: log path outside backup log directory)"
    except OSError:
        return f"(Log file not found: {p})"
    if not resolved.is_file():
        return f"(Log file not found: {p.name})"
    try:
        lines = resolved.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError as exc:
        return f"(Cannot read {p.name}: {exc})"
    if not lines:
        return f"(Log file is empty: {p.name})"
    return "\n".join(lines[-max_lines:])


def read_failures_tail(max_lines: int = 15) -> list[str]:
    p = LOG_DIR / "failures.log"
    if not p.is_file():
        return []
    try:
        lines = [ln for ln in p.read_text(encoding="utf-8", errors="replace").splitlines() if ln.strip()]
    except OSError:
        return []
    return lines[-max_lines:]


def read_journal(unit: str | None = None, lines: int = 200) -> str:
    cmd = ["journalctl", "-n", str(lines), "--no-pager"]
    if unit:
        cmd.extend(["-u", unit])
    else:
        cmd.extend(["-u", "backup-target@*", "-u", "backup-job@*", "-u", "ibs-backup"])
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        out = res.stdout.strip()
        if not out:
            return res.stderr.strip() or "(No journald entries found)"
        return out
    except (OSError, subprocess.SubprocessError) as exc:
        return f"(journalctl error: {exc})"
