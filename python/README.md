<p align="center">
  <img src="https://raw.githubusercontent.com/aurekai/aurekai/main/assets/aurekai-logo.svg" alt="Aurekai" width="520" />
</p>

# aurekai

Thin Python bridge for Aurekai, the operating fabric for intelligent work.

## Install

```bash
python3 -m pip install aurekai
python3 -m aurekai --version
```

## Commands

```bash
python3 -m aurekai --version
python3 -m aurekai doctor
python3 -m aurekai manifest ./aurekai.manifest.json
```

## Python API

```python
from aurekai import artifact_uri, validate_manifest

manifest = validate_manifest("./aurekai.manifest.json")
print(manifest["schema_version"])
print(artifact_uri("sha256:deadbeef"))
```

The package validates Aurekai deployment manifests and can shell out to the
installed `akai` CLI for runtime health checks.