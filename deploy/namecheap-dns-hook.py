#!/usr/bin/env python3
"""Certbot DNS-01 hooks for Namecheap.

Only the short-lived ACME TXT value is written. All existing Namecheap host
records are read first and sent back unchanged because setHosts is a
replace-all operation.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


API_URL = "https://api.namecheap.com/xml.response"
DOMAIN_SLD = "isplatty"
DOMAIN_TLD = "org"
STATE_FILE = os.path.join(tempfile.gettempdir(), "isplatty-acme-namecheap.json")


def api(command: str, extra: dict[str, str] | None = None) -> ET.Element:
    api_user = os.environ["NAMECHEAP_API_USER"]
    api_key = os.environ["NAMECHEAP_API_KEY"]
    username = os.environ.get("NAMECHEAP_USERNAME", api_user)
    client_ip = os.environ.get("NAMECHEAP_CLIENT_IP", "102.203.116.204")
    params = {
        "ApiUser": api_user,
        "ApiKey": api_key,
        "UserName": username,
        "ClientIP": client_ip,
        "Command": command,
        "SLD": DOMAIN_SLD,
        "TLD": DOMAIN_TLD,
    }
    if extra:
        params.update(extra)
    request = urllib.request.Request(
        API_URL,
        data=urllib.parse.urlencode(params).encode("utf-8"),
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        root = ET.fromstring(response.read())
    errors = root.findall(".//{*}Error")
    if errors:
        raise RuntimeError("; ".join(error.text or "Namecheap API error" for error in errors))
    return root


def current_hosts() -> list[dict[str, str]]:
    root = api("namecheap.domains.dns.getHosts")
    hosts: list[dict[str, str]] = []
    for node in root.findall(".//{*}host"):
        record = {
            "HostName": node.attrib.get("HostName", ""),
            "RecordType": node.attrib.get("Type", ""),
            "Address": node.attrib.get("Address", ""),
            "TTL": node.attrib.get("TTL", "1800"),
        }
        if node.attrib.get("MXPref"):
            record["MXPref"] = node.attrib["MXPref"]
        if record["HostName"] and record["RecordType"] and record["Address"]:
            hosts.append(record)
    return hosts


def set_hosts(hosts: list[dict[str, str]]) -> None:
    params: dict[str, str] = {"EmailType": "NONE"}
    for index, host in enumerate(hosts, start=1):
        params[f"HostName{index}"] = host["HostName"]
        params[f"RecordType{index}"] = host["RecordType"]
        params[f"Address{index}"] = host["Address"]
        params[f"TTL{index}"] = host.get("TTL", "1800")
        if host.get("MXPref"):
            params[f"MXPref{index}"] = host["MXPref"]
    api("namecheap.domains.dns.setHosts", params)


def auth() -> None:
    validation = os.environ["CERTBOT_VALIDATION"]
    hosts = current_hosts()
    hosts = [
        host
        for host in hosts
        if not (
            host["HostName"] == "_acme-challenge"
            and host["RecordType"] == "TXT"
        )
    ]
    hosts.append({
        "HostName": "_acme-challenge",
        "RecordType": "TXT",
        "Address": validation,
        "TTL": "60",
    })
    with open(STATE_FILE, "w", encoding="utf-8") as state:
        json.dump({"validation": validation}, state)
    set_hosts(hosts)


def cleanup() -> None:
    validation = os.environ.get("CERTBOT_VALIDATION")
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, encoding="utf-8") as state:
            validation = json.load(state).get("validation", validation)
    if not validation:
        return
    hosts = current_hosts()
    set_hosts([
        host
        for host in hosts
        if not (
            host["HostName"] == "_acme-challenge"
            and host["RecordType"] == "TXT"
            and host["Address"] == validation
        )
    ])
    try:
        os.unlink(STATE_FILE)
    except FileNotFoundError:
        pass


if __name__ == "__main__":
    try:
        if len(sys.argv) > 1 and sys.argv[1] == "auth":
            auth()
        else:
            cleanup()
    except Exception as error:
        print(f"Namecheap DNS hook failed: {error}", file=sys.stderr)
        raise