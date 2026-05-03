from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from . import __version__
from .manifest import validate_manifest


def _run_doctor() -> int:
    akai = shutil.which("akai")
    if not akai:
        print("akai CLI not found on PATH", file=sys.stderr)
        print("install @aurekai/runtime to enable doctor bridging", file=sys.stderr)
        return 1

    completed = subprocess.run([akai, "doctor", "--deep"], check=False)
    return completed.returncode


def _print_manifest(path: str) -> int:
    manifest = validate_manifest(path)
    print(json.dumps(manifest, indent=2, sort_keys=True))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="aurekai")
    parser.add_argument("--version", action="store_true", help="print package version")

    subparsers = parser.add_subparsers(dest="command")
    subparsers.add_parser("doctor", help="run akai doctor --deep")

    manifest_parser = subparsers.add_parser("manifest", help="validate and print a manifest")
    manifest_parser.add_argument("path", type=Path, help="path to aurekai.manifest.json")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.version:
        print(__version__)
        return 0

    if args.command == "doctor":
        return _run_doctor()

    if args.command == "manifest":
        return _print_manifest(str(args.path))

    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())