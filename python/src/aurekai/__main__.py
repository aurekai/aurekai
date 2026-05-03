# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations
import argparse, json, shutil, subprocess, sys
from pathlib import Path
from . import __version__, OPERATORS
from .manifest import validate_manifest


def _find_akai() -> str | None:
    return shutil.which("akai") or shutil.which("./bin/akai")


def _run_doctor() -> int:
    akai = _find_akai()
    if not akai:
        print("akai not found — install aurekai/native-runtime", file=sys.stderr)
        return 1
    return subprocess.run([akai, "doctor", "--deep"], check=False).returncode


def _print_manifest(path: str) -> int:
    print(json.dumps(validate_manifest(path), indent=2, sort_keys=True))
    return 0


def _list_operators(category: str | None, fmt: str) -> int:
    ops = OPERATORS
    if category:
        ops = {k: v for k, v in ops.items() if v["category"] == category}
    if fmt == "json":
        print(json.dumps(ops, indent=2))
    elif fmt == "names":
        for name in sorted(ops):
            print(name)
    else:
        cats = {}
        for name, info in sorted(ops.items()):
            cats.setdefault(info["category"], []).append((name, info))
        for cat in sorted(cats):
            print(f"\n[{cat}]")
            for name, info in cats[cat]:
                print(f"  {name:<24}  {info['description'][:60]}")
    return 0


def _run_operator(cmd: str, args: list[str]) -> int:
    if cmd not in OPERATORS:
        print(f"unknown operator: {cmd}", file=sys.stderr)
        print(f"run 'aurekai list' to see all operators", file=sys.stderr)
        return 1
    akai = _find_akai()
    if not akai:
        print("akai not found — install aurekai/native-runtime", file=sys.stderr)
        return 1
    return subprocess.run([akai, cmd, *args], check=False).returncode


def _inspect_operator(cmd: str) -> int:
    if cmd not in OPERATORS:
        print(f"unknown operator: {cmd}", file=sys.stderr)
        return 1
    info = OPERATORS[cmd]
    print(json.dumps({"command": cmd, **info}, indent=2))
    akai = _find_akai()
    if akai:
        print()
        subprocess.run([akai, cmd, "--help"], check=False)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="aurekai", description="Aurekai Python SDK")
    p.add_argument("--version", action="store_true")
    sub = p.add_subparsers(dest="command")

    sub.add_parser("doctor", help="run akai doctor --deep")

    mp = sub.add_parser("manifest", help="validate and print a manifest")
    mp.add_argument("path", type=Path)

    lp = sub.add_parser("list", help="list available operators")
    lp.add_argument("--category", "-c", default=None, help="filter by category")
    lp.add_argument("--format", "-f", choices=["table", "json", "names"], default="table")

    rp = sub.add_parser("run", help="run an operator via akai dispatcher")
    rp.add_argument("operator", help="operator name (e.g. embed, fpq, tag)")
    rp.add_argument("args", nargs=argparse.REMAINDER, help="operator arguments")

    ip = sub.add_parser("inspect", help="inspect an operator")
    ip.add_argument("operator")

    return p


def main(argv: list[str] | None = None) -> int:
    p = build_parser()
    args = p.parse_args(argv)
    if args.version:
        print(__version__)
        return 0
    if args.command == "doctor":
        return _run_doctor()
    if args.command == "manifest":
        return _print_manifest(str(args.path))
    if args.command == "list":
        return _list_operators(args.category, args.format)
    if args.command == "run":
        return _run_operator(args.operator, args.args)
    if args.command == "inspect":
        return _inspect_operator(args.operator)
    p.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
