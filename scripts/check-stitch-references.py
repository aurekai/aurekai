#!/usr/bin/env python3
"""Business-owned Stitch observations: 97 revisions for 91 names.
Six later observations revisit existing names. three.js and shader are excluded.
No observation by itself proves visual parity or deployment.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "sites/design/stitch-fingerprints.jsonl"
INITIAL = "stitch-20261104"
FOLLOW_UP = "stitch-20261104-item-detail"
SOURCE_FIELDS = {
    "fingerprint_id", "template", "reference_source", "reference_name",
    "status", "family", "renderer_affinity", "density", "visual_vector",
    "acceptance_contract", "cannot_infer",
}
BANNED = re.compile(r"<\s*(?:script|style|iframe|html)\b|url\s*\(|expression\s*\(",
                    flags=re.IGNORECASE)


def load_and_verify(path: Path = SOURCE) -> list[dict]:
    observed = []
    for number, line in enumerate(path.read_text(encoding="utf8").splitlines(), start=1):
        if not line.strip():
            continue
        x = json.loads(line)
        if not isinstance(x, dict) or set(x) != SOURCE_FIELDS:
            raise ValueError(f"unrecognized fields or missing contract at line {number}")
        if not all(isinstance(x.get(k), str) and x[k] for k in
                   ("fingerprint_id", "template", "reference_source", "status",
                    "acceptance_contract", "cannot_infer")):
            raise ValueError(f"unidentified contract at line {number}")
        vector = x["visual_vector"]
        if not isinstance(vector, dict) or not {
            "archive", "pattern", "pattern_basis", "tokens", "anatomy", "html_sha256"
        }.issubset(vector):
            raise ValueError(f"missing reproducible reference fingerprint at line {number}")
        if not re.fullmatch("[a-f0-9]{64}", str(vector["html_sha256"])):
            raise ValueError(f"invalid donor digest at line {number}")
        if not isinstance(vector["tokens"], dict) or not isinstance(vector["anatomy"], dict):
            raise ValueError(f"invalid typed presentation shape at line {number}")
        if any(not isinstance(v, int) or isinstance(v, bool) or v < 0
               for v in vector["anatomy"].values()):
            raise ValueError(f"invalid measured structural counts at line {number}")
        for token, value in vector["tokens"].items():
            if not isinstance(token, str) or not isinstance(value, str) or BANNED.search(value):
                raise ValueError(f"executable or invalid style token at line {number}")
        observed.append(x)
    if len(observed) != 97:
        raise ValueError(f"expected 97 reference observations, found {len(observed)}")
    fingerprints = [x["fingerprint_id"] for x in observed]
    if len(set(fingerprints)) != len(fingerprints):
        raise ValueError("repeated fingerprint identity")
    by_source = defaultdict(list)
    by_template = defaultdict(list)
    for x in observed:
        by_source[x["reference_source"]].append(x)
        by_template[x["template"]].append(x)
    if {k: len(v) for k, v in by_source.items()} != {INITIAL: 91, FOLLOW_UP: 6}:
        raise ValueError("original 91 or later six observations changed")
    if len(by_template) != 91:
        raise ValueError(f"reference identity drift: {len(by_template)} unique names")
    original = by_source[INITIAL]
    newer = by_source[FOLLOW_UP]
    if len(set(x["template"] for x in original)) != 91:
        raise ValueError("original reference archive repeats a template")
    if len(set(x["template"] for x in newer)) != 6:
        raise ValueError("later reference archive repeats a template")
    if not {x["template"] for x in newer}.issubset({x["template"] for x in original}):
        raise ValueError("new observations incorrectly presented as new screens")
    original_status = Counter(x["status"] for x in original)
    if original_status != {"reviewed_family": 88, "reviewed_variant": 1,
                           "excluded_reference_folder": 2}:
        raise ValueError(f"review status drift: {dict(original_status)}")
    if {x["template"] for x in original
            if x["status"] == "excluded_reference_folder"} != {"three.js", "shader"}:
        raise ValueError("excluded donor folders must remain excluded")
    if any(x["status"] != "observed_reference" for x in newer):
        raise ValueError("later observations cannot graduate automatically")
    if any("live" in x["status"].lower() or "published" in x["status"].lower()
           for x in observed):
        raise ValueError("observations cannot assert visual or live acceptance")
    return observed


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify or resolve Aurekai-owned Stitch evidence")
    parser.add_argument("--resolve", help="exact reference screen/template name")
    parser.add_argument("--source", choices=[INITIAL, FOLLOW_UP],
                        default=INITIAL,
                        help="exact revision; newer observations never silently promoted")
    args = parser.parse_args()
    try:
        rows = load_and_verify()
        if args.resolve:
            matches = [r for r in rows if r["template"] == args.resolve
                       and r["reference_source"] == args.source]
            if len(matches) != 1 or matches[0]["status"] == "excluded_reference_folder":
                raise ValueError("requested design absent or excluded")
            print(json.dumps(matches[0], sort_keys=True, separators=(",", ":")))
        else:
            print("AUREKAI_STITCH_REFERENCE_PASS observations=97 unique_names=91 "
                  "reviewed_family=88 reviewed_variant=1 excluded=2 "
                  "newer_observations=6 visual_parity=unverified live=unverified")
        return 0
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(f"AUREKAI_STITCH_REFERENCE_REFUSED: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
