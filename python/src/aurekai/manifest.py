from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def validate_manifest(path: str | Path) -> dict[str, Any]:
    manifest_path = Path(path)
    data = json.loads(manifest_path.read_text(encoding="utf-8"))

    if not isinstance(data, dict):
        raise ValueError("manifest must be a JSON object")

    schema_version = str(data.get("schema_version", "")).strip()
    if not schema_version:
        raise ValueError("manifest missing schema_version")

    if not (
        schema_version.startswith("aurekai.")
        or schema_version.startswith("bonfyre.")
    ):
        raise ValueError(f"unsupported schema_version: {schema_version}")

    return data


def artifact_uri(hash_value: str) -> str:
    return f"akh:artifact:{hash_value}"