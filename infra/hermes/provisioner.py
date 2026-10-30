#!/usr/bin/env python3
"""Unibots Hermes profile provisioner.

The Hermes gateway multiplexes profiles under /p/<profile>/. Unibots gives every
bot its own profile so MEMORY.md, USER.md, SOUL.md, skills, sessions and state.db
evolve per bot instead of leaking across tenants.

This service is intentionally small and internal-only:
  POST /profiles  {"name": "bot-..."}  -> {"profile": "...", "api_key": "..."}
  GET  /health

The API key is derived with HMAC-SHA256 from UNIBOTS_HERMES_PROFILE_SECRET, so a
restart returns the same key without storing plaintext secrets on disk. The key is
also written to the profile's .env as API_SERVER_KEY, which is what the shared
gateway listener expects for /p/<profile>/v1/... requests.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import shutil
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERMES_HOME = Path(os.environ.get("HERMES_HOME", "/opt/data"))
PORT = int(os.environ.get("UNIBOTS_HERMES_PROVISION_PORT", "8650"))
ADMIN_SECRET = os.environ.get("UNIBOTS_HERMES_PROVISION_SECRET", "").strip()
PROFILE_SECRET = os.environ.get("UNIBOTS_HERMES_PROFILE_SECRET", "").strip()
UID = int(os.environ.get("HERMES_UID", "10000"))
GID = int(os.environ.get("HERMES_GID", "10000"))
NAME_RE = re.compile(r"^bot-[a-z0-9][a-z0-9-]{0,62}$")
MAX_BODY = 4096


def log(message: str) -> None:
    print(f"[unibots-hermes-provisioner] {message}", flush=True)


def derived_key(name: str) -> str:
    return hmac.new(PROFILE_SECRET.encode("utf-8"), name.encode("utf-8"), hashlib.sha256).hexdigest()


def profile_dir(name: str) -> Path:
    return HERMES_HOME / "profiles" / name


def chown_tree(root: Path) -> None:
    try:
        os.chown(root, UID, GID)
        for path in root.rglob("*"):
            os.chown(path, UID, GID)
    except PermissionError as error:
        log(f"warning: could not chown {root}: {error}")


def ensure_env(name: str, key: str) -> None:
    env_path = profile_dir(name) / ".env"
    env_path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8").splitlines()
    managed = {
        "API_SERVER_ENABLED": "true",
        "API_SERVER_HOST": "0.0.0.0",
        "API_SERVER_PORT": "8642",
        "API_SERVER_KEY": key,
    }
    output: list[str] = []
    seen: set[str] = set()
    for line in lines:
        stripped = line.strip()
        if "=" in stripped and not stripped.startswith("#"):
            variable = stripped.split("=", 1)[0].strip()
            if variable in managed:
                output.append(f"{variable}={managed[variable]}")
                seen.add(variable)
                continue
        output.append(line)
    for variable, value in managed.items():
        if variable not in seen:
            output.append(f"{variable}={value}")
    env_path.write_text("\n".join(output).rstrip() + "\n", encoding="utf-8")
    os.chmod(env_path, 0o600)


def create_profile(name: str) -> None:
    directory = profile_dir(name)
    if directory.exists():
        return
    hermes = shutil.which("hermes")
    if not hermes:
        raise RuntimeError("the hermes CLI is not on PATH inside the sidecar image")
    environment = dict(os.environ)
    environment.setdefault("HERMES_HOME", str(HERMES_HOME))
    environment.setdefault("HOME", str(HERMES_HOME))
    # Clone the root profile's config, .env, SOUL.md and skills when the operator
    # has completed `hermes setup`; otherwise create a clean profile.
    commands = [
        [hermes, "profile", "create", name, "--clone", "--no-alias"],
        [hermes, "profile", "create", name, "--no-alias"],
    ]
    last_error = ""
    for command in commands:
        result = subprocess.run(
            command,
            env=environment,
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
        if result.returncode == 0:
            log(f"created Hermes profile {name}")
            return
        last_error = (result.stderr or result.stdout or "").strip()[-500:]
        if directory.exists():
            # A partially-created profile is not safe to reuse.
            shutil.rmtree(directory, ignore_errors=True)
    raise RuntimeError(f"could not create Hermes profile {name}: {last_error}")


def provision(name: str) -> dict[str, str]:
    if not NAME_RE.fullmatch(name):
        raise ValueError("invalid profile name")
    create_profile(name)
    key = derived_key(name)
    ensure_env(name, key)
    chown_tree(profile_dir(name))
    return {"profile": name, "api_key": key}


class Handler(BaseHTTPRequestHandler):
    server_version = "UnibotsHermesProvisioner/1.0"

    def log_message(self, format: str, *args: object) -> None:
        log(format % args)

    def write_json(self, status: int, body: dict[str, object]) -> None:
        data = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def authorized(self) -> bool:
        header = self.headers.get("authorization", "")
        prefix = "Bearer "
        if not header.startswith(prefix):
            return False
        return hmac.compare_digest(header[len(prefix) :].strip(), ADMIN_SECRET)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self.write_json(200, {"ok": True, "service": "unibots-hermes-provisioner"})
            return
        self.write_json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/profiles":
            self.write_json(404, {"error": "not found"})
            return
        if not self.authorized():
            self.write_json(401, {"error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError:
            self.write_json(400, {"error": "invalid content length"})
            return
        if length <= 0 or length > MAX_BODY:
            self.write_json(413, {"error": "invalid body size"})
            return
        try:
            payload = json.loads(self.rfile.read(length))
            name = payload["name"]
            if not isinstance(name, str):
                raise ValueError("name must be a string")
            result = provision(name)
        except ValueError as error:
            self.write_json(400, {"error": str(error)})
            return
        except Exception as error:  # noqa: BLE001 - return a safe diagnostic to the app
            log(f"provision failed: {error}")
            self.write_json(500, {"error": "profile provisioning failed"})
            return
        self.write_json(200, result)


def main() -> None:
    if not ADMIN_SECRET or not PROFILE_SECRET:
        log("UNIBOTS_HERMES_PROVISION_SECRET and UNIBOTS_HERMES_PROFILE_SECRET are required")
        sys.exit(1)
    if len(PROFILE_SECRET) < 32:
        log("UNIBOTS_HERMES_PROFILE_SECRET must be at least 32 characters")
        sys.exit(1)
    HERMES_HOME.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    log(f"listening on 0.0.0.0:{PORT} with HERMES_HOME={HERMES_HOME}")
    server.serve_forever()


if __name__ == "__main__":
    main()
