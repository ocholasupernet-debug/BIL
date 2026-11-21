#!/usr/bin/env bash

find_postgresql17_tool() {
  local tool="$1" override_name override candidate version
  case "$tool" in
    pg_dump) override_name="BIL_PG_DUMP_BIN" ;;
    pg_restore) override_name="BIL_PG_RESTORE_BIN" ;;
    *) return 1 ;;
  esac
  override="${!override_name:-}"
  for candidate in \
    "$override" \
    "/usr/lib/postgresql/17/bin/$tool" \
    "${tool}-17" \
    "${tool}17" \
    "$tool"
  do
    [ -n "$candidate" ] || continue
    if [[ "$candidate" == */* ]]; then
      [ -x "$candidate" ] || continue
    else
      command -v "$candidate" >/dev/null 2>&1 || continue
      candidate="$(command -v "$candidate")"
    fi
    version="$("$candidate" --version 2>/dev/null || true)"
    if [[ "$version" =~ \(PostgreSQL\)[[:space:]]+17([.]|$) ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "PostgreSQL 17 client installation requires root or sudo." >&2
    return 1
  fi
}

ensure_postgresql17_client() {
  local pg_dump_path pg_restore_path codename architecture key_file fingerprint source_file

  pg_dump_path="$(find_postgresql17_tool pg_dump || true)"
  pg_restore_path="$(find_postgresql17_tool pg_restore || true)"
  if [ -n "$pg_dump_path" ] && [ -n "$pg_restore_path" ]; then
    echo "      ✓ PostgreSQL 17 client tools available: $("$pg_dump_path" --version)"
    return 0
  fi

  if ! command -v apt-get >/dev/null 2>&1 || ! [ -r /etc/os-release ]; then
    echo "PostgreSQL 17 client tools are required; this host cannot install them through apt." >&2
    return 1
  fi
  # The expected fingerprint is published by the official PostgreSQL Apt
  # Repository instructions. Do not trust an unverified key download.
  . /etc/os-release
  codename="${VERSION_CODENAME:-}"
  architecture="$(dpkg --print-architecture 2>/dev/null || true)"
  if [ -z "$codename" ] || [ -z "$architecture" ] || [[ "${ID:-}" != "ubuntu" && "${ID:-}" != "debian" ]]; then
    echo "PostgreSQL 17 client installation supports only recognized Debian/Ubuntu hosts." >&2
    return 1
  fi

  echo "      ! PostgreSQL 17 client tools are missing; installing the client package."
  run_as_root apt-get update -qq
  run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl gnupg

  key_file="$(mktemp)"
  source_file="$(mktemp)"
  if ! curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o "$key_file"; then
    rm -f "$key_file" "$source_file"
    echo "Could not download the official PostgreSQL Apt signing key." >&2
    return 1
  fi
  fingerprint="$(gpg --show-keys --with-colons "$key_file" 2>/dev/null | awk -F: '$1 == "fpr" { print toupper($10); exit }')"
  if [ "$fingerprint" != "B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8" ]; then
    rm -f "$key_file" "$source_file"
    echo "PostgreSQL Apt signing-key fingerprint did not match the official key." >&2
    return 1
  fi
  if ! run_as_root install -d -m 0755 /usr/share/postgresql-common/pgdg ||
     ! run_as_root install -m 0644 "$key_file" /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc; then
    rm -f "$key_file" "$source_file"
    return 1
  fi
  printf 'Types: deb\nURIs: https://apt.postgresql.org/pub/repos/apt\nSuites: %s-pgdg\nArchitectures: %s\nComponents: main\nSigned-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc\n' \
    "$codename" "$architecture" > "$source_file"
  if ! run_as_root install -m 0644 "$source_file" /etc/apt/sources.list.d/pgdg.sources ||
     ! run_as_root apt-get update -qq ||
     ! run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-client-17; then
    rm -f "$key_file" "$source_file"
    return 1
  fi
  rm -f "$key_file" "$source_file"

  pg_dump_path="$(find_postgresql17_tool pg_dump || true)"
  pg_restore_path="$(find_postgresql17_tool pg_restore || true)"
  if [ -z "$pg_dump_path" ] || [ -z "$pg_restore_path" ]; then
    echo "PostgreSQL 17 client package installed, but matching pg_dump/pg_restore could not be verified." >&2
    return 1
  fi
  echo "      ✓ PostgreSQL 17 client tools installed: $("$pg_dump_path" --version)"
}
