#!/usr/bin/env python3
"""Fast zero-dependency CLI for SystemBackups (backup-status)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

import backup_engine as eng


def _print_plain(max_age_hours: int) -> int:
    jobs = eng.collect_job_statuses(max_age_hours=max_age_hours)
    print(f"{'JOB':<14} {'STATUS':<8} {'LAST RUN':<19} {'TIME':<9} {'SIZE':<8} {'ARCHIVE':<32} NOTE")
    print(f"{'-'*14} {'-'*8} {'-'*19} {'-'*9} {'-'*8} {'-'*32} {'-'*20}")

    overall = 0
    for j in jobs:
        if j.status in ("FAIL", "STALE"):
            overall = 1
        print(
            f"{j.key:<14} {j.status:<8} {j.last_run:<19} {j.duration_fmt:<9} {j.size:<8} {j.archive:<32} {j.message}"
        )

    failures = eng.read_failures_tail(5)
    if failures:
        print(f"\nRecent failures ({eng.LOG_DIR / 'failures.log'}):")
        for line in failures:
            print(f"  {line}")

    timers = eng.collect_timers()
    if timers:
        print("\nActive backup timers:")
        print(f"{'TIMER':<28} {'ENABLED':<10} {'ACTIVE':<10} {'NEXT RUN':<19} {'LEFT':<10} SCHEDULE")
        for t in timers:
            print(f"{t.unit:<28} {t.enabled:<10} {t.active:<10} {t.next_run:<19} {t.left:<10} {t.on_calendar}")

    return overall


def _print_json(max_age_hours: int) -> int:
    snap = eng.collect_full_snapshot(max_age_hours=max_age_hours)
    print(json.dumps(snap, indent=2))
    return 0 if snap["healthy"] else 1


def _cmd_run(spec: str) -> int:
    spec = spec.strip()
    if spec == "all":
        ok, msg = eng.start_all(include_ibs=True)
    elif spec == "ibs":
        ok, msg = eng.start_job("ibs")
    elif "_" in spec:
        ok, msg = eng.start_job(spec)
    else:
        ok, msg = eng.start_target(spec)
    print(msg, file=sys.stdout if ok else sys.stderr)
    return 0 if ok else 1


def _cmd_stop(unit: str) -> int:
    ok, msg = eng.stop_unit(unit)
    print(msg, file=sys.stdout if ok else sys.stderr)
    return 0 if ok else 1


def _cmd_preflight() -> int:
    items = eng.run_preflight_checks()
    overall = 0
    print(f"{'CATEGORY':<10} {'CHECK':<32} {'STATE':<6} DETAIL")
    print(f"{'-'*10} {'-'*32} {'-'*6} {'-'*30}")
    for item in items:
        state = "OK" if item.ok else "FAIL"
        if not item.ok:
            overall = 1
        print(f"{item.category:<10} {item.name:<32} {state:<6} {item.detail}")
    return overall


def main(argv: list[str] | None = None) -> int:
    args_in = list(sys.argv[1:] if argv is None else argv)
    if len(args_in) == 1 and args_in[0].isdigit():
        return _print_plain(int(args_in[0]))

    parser = argparse.ArgumentParser(
        prog="backup-status",
        description="SystemBackups CLI status & on-demand runner (web UI in SystemMonitor).",
    )
    parser.add_argument("--plain", "-p", action="store_true", help="Print status table (default).")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON snapshot.")
    parser.add_argument(
        "--max-age",
        type=int,
        default=eng.DEFAULT_MAX_AGE_HOURS,
        metavar="HOURS",
        help=f"Hours before a job is marked STALE (default: {eng.DEFAULT_MAX_AGE_HOURS}).",
    )

    sub = parser.add_subparsers(dest="command")
    p_run = sub.add_parser("run", help="Trigger an on-demand backup (target, target_job, ibs, or all)")
    p_run.add_argument("spec", help="e.g. roi, roi_sql, dan_fast, ibs, or all")

    p_stop = sub.add_parser("stop", help="Stop an active backup systemd service")
    p_stop.add_argument("unit", help="e.g. backup-target@roi.service or backup-job@roi_sql.service")

    sub.add_parser("preflight", help="Run mount, storage, tool, and network connectivity checks")

    ns = parser.parse_args(args_in)
    if ns.command == "run":
        return _cmd_run(ns.spec)
    if ns.command == "stop":
        return _cmd_stop(ns.unit)
    if ns.command == "preflight":
        return _cmd_preflight()
    if ns.json:
        return _print_json(ns.max_age)
    return _print_plain(ns.max_age)


if __name__ == "__main__":
    raise SystemExit(main())
