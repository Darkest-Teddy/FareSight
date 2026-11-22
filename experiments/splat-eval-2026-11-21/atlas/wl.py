"""Thin wrapper around the World Labs CLI (vendor/node_modules/.bin/worldlabs).

The Atlas key is read from the repository .env (WLT_ATLAS_API_KEY) and passed only through the
child process environment. Every task submission gets a deterministic idempotency key and its
operation id is recorded before waiting, so a rerun never pays twice for the same step.
"""

import json
import os
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
CLI = HERE / "vendor/node_modules/.bin/worldlabs"
ENV_FILE = HERE.parents[2] / ".env"


def _env():
    match = re.search(r"^WLT_ATLAS_API_KEY=(.+)$", ENV_FILE.read_text(), re.M)
    if not match:
        raise SystemExit("WLT_ATLAS_API_KEY missing from .env")
    return {**os.environ, "WLT_API_KEY": match[1].strip()}


def cli(*args, timeout=None):
    result = subprocess.run([str(CLI), "--json", *map(str, args)], env=_env(), capture_output=True, text=True,
                            timeout=timeout)
    if result.returncode != 0:
        message = (result.stderr or result.stdout).replace(_env()["WLT_API_KEY"], "[redacted]")
        raise RuntimeError(f"worldlabs {args[0]} {args[1] if len(args) > 1 else ''} failed: {message[-1500:]}")
    return json.loads(result.stdout) if result.stdout.strip() else None


def upload(path, cache):
    """Upload once per file; cache maps local path -> asset id."""
    key = str(path)
    if key not in cache:
        cache[key] = _asset_id(cli("assets", "upload", path))
    return cache[key]


def _asset_id(response):
    for k in ("assetId", "id", "name"):
        if isinstance(response, dict) and response.get(k):
            return response[k]
    if isinstance(response, dict) and isinstance(response.get("asset"), dict):
        return _asset_id(response["asset"])
    raise RuntimeError(f"no asset id in upload response: {json.dumps(response)[:300]}")


def run_task(name, request, workdir, idempotency_key, wait_s=3600):
    """Submit (or resume) a task, wait for it, download outputs into workdir. Returns operation.json."""
    workdir.mkdir(parents=True, exist_ok=True)
    (workdir / "request.json").write_text(json.dumps(request, indent=2) + "\n")
    record = workdir / "submission.json"
    if record.exists():
        operation_id = json.loads(record.read_text())["id"]
    else:
        submitted = cli("tasks", "run", name, "--request", workdir / "request.json",
                        "--idempotency-key", idempotency_key)
        record.write_text(json.dumps(submitted, indent=2) + "\n")
        operation_id = submitted["id"]
    print(f"{name}: operation {operation_id}", flush=True)
    done = workdir / "out/operation.json"
    if not done.exists():
        operation = cli("operations", "wait", operation_id, "--timeout", wait_s, timeout=wait_s + 120)
        if operation.get("error"):
            (workdir / "error.json").write_text(json.dumps(operation, indent=2) + "\n")
            raise RuntimeError(f"{name} failed: {json.dumps(operation['error'])[:800]}")
        cli("operations", "download", operation_id, "--out", workdir / "out", timeout=1800)
    return json.loads(done.read_text())
