#!/usr/bin/env python3
"""Certbot DNS-01 hooks for Cloudflare.

The token only needs Zone:DNS:Edit and Zone:Read for isplatty.org. The hook
creates only the temporary ACME TXT records and removes the records it created
after validation.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


API_BASE = "https://api.cloudflare.com/client/v4"
ZONE_NAME = "isplatty.org"
RECORD_NAME = "_acme-challenge.isplatty.org"
STATE_FILE = Path("/var/lib/letsencrypt/isplatty-cloudflare-acme.json")
TOKEN_FILE = Path("/etc/letsencrypt/cloudflare-api-token")


def api_token() -> str:
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    if token:
        return token
    return TOKEN_FILE.read_text(encoding="utf-8").strip()


def api(method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    token = api_token()
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        f"{API_BASE}{path}",
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Cloudflare API HTTP {error.code}: {detail}") from error
    if not result.get("success"):
        messages = result.get("errors") or result.get("messages") or []
        raise RuntimeError(f"Cloudflare API error: {messages}")
    return result.get("result")


def zone_id() -> str:
    configured = os.environ.get("CLOUDFLARE_ZONE_ID", "").strip()
    if configured:
        return configured
    zones = api(
        "GET",
        f"/zones?name={urllib.parse.quote(ZONE_NAME)}&status=active&per_page=1",
    )
    if len(zones) != 1:
        raise RuntimeError(
            f"Could not find an active Cloudflare zone for {ZONE_NAME}; "
            "confirm the domain uses Cloudflare nameservers."
        )
    return zones[0]["id"]


def read_state() -> dict[str, list[str]]:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}


def write_state(state: dict[str, list[str]]) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(
        prefix="isplatty-cloudflare-acme-",
        suffix=".json",
        dir=STATE_FILE.parent,
        text=True,
    )
    try:
        os.chmod(temporary, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(state, output)
        os.replace(temporary, STATE_FILE)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def auth() -> None:
    validation = os.environ["CERTBOT_VALIDATION"]
    record = api(
        "POST",
        f"/zones/{zone_id()}/dns_records",
        {
            "type": "TXT",
            "name": RECORD_NAME,
            "content": validation,
            "ttl": 120,
        },
    )
    state = read_state()
    state.setdefault(validation, []).append(record["id"])
    write_state(state)
    # Give Cloudflare's authoritative DNS a short head start before the ACME
    # server checks the TXT record.
    time.sleep(20)


def cleanup() -> None:
    validation = os.environ.get("CERTBOT_VALIDATION", "")
    state = read_state()
    record_ids = state.pop(validation, [])
    if record_ids:
        for record_id in record_ids:
            api("DELETE", f"/zones/{zone_id()}/dns_records/{record_id}")
    write_state(state)


def verify() -> None:
    """Confirm the configured token can resolve the production zone."""
    zone_id()


if __name__ == "__main__":
    try:
        action = sys.argv[1] if len(sys.argv) > 1 else "cleanup"
        if action == "auth":
            auth()
        elif action == "cleanup":
            cleanup()
        elif action == "verify":
            verify()
        else:
            raise RuntimeError(f"Unsupported Cloudflare DNS hook action: {action}")
    except Exception as error:
        print(f"Cloudflare DNS hook failed: {error}", file=sys.stderr)
        raise
