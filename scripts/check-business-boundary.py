#!/usr/bin/env python3
"""Check Aurekai business source relocation and engine/business ownership.
No network, credentials, CMS imports, or production deployment required.
"""
from __future__ import annotations
import csv
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
HOST = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$")
TERRITORIES = {"work", "life", "live", "shop"}

def blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()

def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]

def check() -> None:
    with (ROOT / "docs/business-source-migration.tsv").open(encoding="utf-8", newline="") as handle:
        records = list(csv.DictReader(handle, delimiter="\t"))
    assert len(records) == 10, f"unexpected moved-source count: {len(records)}"
    destinations = set()
    for entry in records:
        dest = entry["destination_path"]
        path = Path(dest)
        assert not path.is_absolute() and ".." not in path.parts, f"invalid destination: {dest}"
        assert dest not in destinations, f"duplicate destination: {dest}"
        destinations.add(dest)
        assert entry["source_repository"] == "Nickgonzales76017/bonfyre", "unexpected source repository"
        destination_sha = entry["destination_git_blob_sha"]
        source_sha = entry["source_git_blob_sha"]
        disposition = entry["disposition"]
        assert disposition in (
            "copied_pending_import_and_source_retirement",
            "reconciled_8_newer_work_routes_pending_CMS_cutover",
        ), "false cutover claim"
        if disposition == "reconciled_8_newer_work_routes_pending_CMS_cutover":
            assert dest == "sites/presentation/route-presentation.jsonl"
            assert destination_sha != source_sha, "reconciled destination must be an explicit new blob"
        else:
            assert destination_sha == source_sha, f"unexpected source drift: {dest}"
        payload = (ROOT / dest).read_bytes()
        assert blob_sha(payload) == destination_sha, f"destination source identity drift: {dest}"
        if dest.endswith(".json"):
            json.loads(payload)
        if dest.endswith(".jsonl"):
            assert read_jsonl(ROOT / dest), f"empty JSONL: {dest}"

    hosts: dict[str, tuple[str, str]] = {}
    known_hosts: set[str] = set()
    for line in (ROOT / "deploy/tenant-hosts.tsv").read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        fields = line.split()
        assert len(fields) == 4, "Aurekai deployment must bind an explicit fourth CMS owner"
        territory, public_host, login_host, cms_namespace = fields
        assert cms_namespace == "aurekai", "Aurekai CMS namespace must not inherit root"
        assert territory not in hosts, f"duplicate territory: {territory}"
        assert HOST.fullmatch(public_host) and HOST.fullmatch(login_host), "bad host grammar"
        assert public_host not in known_hosts and login_host not in known_hosts
        assert public_host != login_host
        hosts[territory] = (public_host, login_host, cms_namespace)
        known_hosts.update((public_host, login_host))
    assert set(hosts) == TERRITORIES, f"unknown/missing Aurekai territory: {set(hosts)}"
    assert hosts["work"] == ("aurekai.work", "signin.aurekai.work", "aurekai"), "wrong work origin"
    for territory in ("life", "live", "shop"):
        assert hosts[territory] == (f"aurekai.{territory}", f"auth.aurekai.{territory}", "aurekai"), territory

    fronts = read_jsonl(ROOT / "sites/content/territory-presentations.jsonl")
    routes = read_jsonl(ROOT / "sites/presentation/route-presentation.jsonl")
    assert len(fronts) == 4 and {entry["territory"] for entry in fronts} == TERRITORIES
    assert len(routes) == 95 and all(entry.get("territory") in hosts for entry in routes)
    keys = [(entry.get("territory"), entry.get("route"), entry.get("when_query_key") or "") for entry in routes]
    assert len(keys) == len(set(keys)), "route presentation collisions within Aurekai source"
    for name in ("business/work-samples/work-examples.jsonl",
                 "business/work-samples/work-example-programs.jsonl"):
        assert read_jsonl(ROOT / name), f"missing business records: {name}"

    pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    assert pkg["name"] == "@aurekai/runtime", "legacy package changed without migration"
    assert pkg["bin"]["akai"] and pkg["bin"]["bonfyre"], "compatibility aliases missing"

    readme = (ROOT / "README.md").read_text(encoding="utf-8").lower()
    ownership = (ROOT / "OWNERSHIP.md").read_text(encoding="utf-8").lower()
    assert "operating business" in readme and "bonfÿre" in readme
    assert "separate principals" in ownership and "bonfÿre" in ownership
    assert "aurekai is a native ai operations runtime" not in readme
    print(f"AUREKAI_BUSINESS_SOURCE_PASS files={len(records)} territories=4 routes={len(routes)} legacy_package_preserved=true")

if __name__ == "__main__":
    try:
        check()
    except (OSError, AssertionError, ValueError, KeyError, UnicodeError, json.JSONDecodeError) as exc:
        print(f"AUREKAI_BUSINESS_SOURCE_FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
