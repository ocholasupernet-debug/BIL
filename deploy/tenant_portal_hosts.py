#!/usr/bin/env python3
"""Select safe, active custom Hotspot hostnames for HTTPS provisioning."""

import ipaddress
import json
import re
import sys
from pathlib import Path
from typing import Any

LABEL_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")


def _record_id(value: Any) -> str | None:
    try:
        return str(int(value))
    except (TypeError, ValueError, OverflowError):
        return None


def _valid_hostname(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    hostname = value.strip().lower()
    if not hostname or len(hostname) > 253 or hostname.endswith("."):
        return None
    labels = hostname.split(".")
    if len(labels) < 2 or any(not LABEL_PATTERN.fullmatch(label) for label in labels):
        return None
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        return hostname
    return None


def custom_portal_hosts(payload: dict[str, Any], base_domain: str) -> list[str]:
    base = base_domain.strip().lower().strip(".")
    active_admin_ids = {
        record_id
        for row in payload.get("admins", [])
        if isinstance(row, dict)
        if (record_id := _record_id(row.get("id"))) is not None
    }

    owners_by_host: dict[str, set[str]] = {}
    for row in payload.get("branding", []):
        if not isinstance(row, dict):
            continue
        admin_id = _record_id(row.get("admin_id"))
        hostname = _valid_hostname(row.get("portal_hostname"))
        if admin_id not in active_admin_ids or not hostname:
            continue
        # The base and its first-level hosts are handled by the existing
        # apex, wildcard, and tenant-subdomain certificate paths.
        labels_before_base = hostname[: -(len(base) + 1)] if hostname.endswith(f".{base}") else None
        if hostname == base or (labels_before_base is not None and "." not in labels_before_base):
            continue
        owners_by_host.setdefault(hostname, set()).add(admin_id)

    hosts: list[str] = []
    for hostname, owners in sorted(owners_by_host.items()):
        if len(owners) != 1:
            print(
                f"Skipping custom portal hostname {hostname}: it is assigned to multiple active tenants.",
                file=sys.stderr,
            )
            continue
        hosts.append(hostname)
    return hosts


def main() -> int:
    if len(sys.argv) != 3:
        print(f"Usage: {Path(sys.argv[0]).name} ADMIN_JSON BASE_DOMAIN", file=sys.stderr)
        return 2
    with open(sys.argv[1], encoding="utf-8") as source:
        payload = json.load(source)
    for hostname in custom_portal_hosts(payload, sys.argv[2]):
        print(hostname)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())