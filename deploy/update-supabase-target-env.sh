#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${SUPABASE_ENV_FILE:-$PROJECT_DIR/.env}"
cd "$PROJECT_DIR"

if [ ! -s "$ENV_FILE" ] || [ -L "$ENV_FILE" ]; then
  echo "Supabase target update requires an existing regular VPS .env file." >&2
  exit 1
fi

for name in SUPABASE_DEST_URL SUPABASE_DEST_PUBLISHABLE_KEY SUPABASE_DEST_SERVICE_ROLE_KEY SUPABASE_DEST_DB_URL; do
  if [ -z "${!name:-}" ]; then
    echo "Supabase target update is missing required configuration." >&2
    exit 1
  fi
done

if ! node -e '
  try {
    const api = new URL(process.env.SUPABASE_DEST_URL);
    const database = new URL(process.env.SUPABASE_DEST_DB_URL);
    const ref = "vuvyweofsutgqdtbjckj";
    const username = decodeURIComponent(database.username);
    const databaseHost = database.hostname.toLowerCase();
    const hostRef = databaseHost.match(/^db\.([a-z0-9]{20})\.supabase\.co$/)?.[1];
    const userRef = username.match(/(?:^|\.)([a-z0-9]{20})$/i)?.[1]?.toLowerCase();
    if (api.protocol !== "https:" || api.hostname !== `${ref}.supabase.co` || !["", "/"].includes(api.pathname) || api.search || api.hash) process.exit(1);
    if (!["postgres:", "postgresql:"].includes(database.protocol)) process.exit(1);
    if (hostRef !== ref && !(databaseHost.endsWith(".pooler.supabase.com") && userRef === ref)) process.exit(1);
  } catch {
    process.exit(1);
  }
'; then
  echo "Supabase destination identity or database URL validation failed." >&2
  exit 1
fi

destination_url="$SUPABASE_DEST_URL"
destination_publishable_key="$SUPABASE_DEST_PUBLISHABLE_KEY"
destination_service_role_key="$SUPABASE_DEST_SERVICE_ROLE_KEY"
destination_database_url="$SUPABASE_DEST_DB_URL"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
SUPABASE_DEST_URL="$destination_url"
SUPABASE_DEST_PUBLISHABLE_KEY="$destination_publishable_key"
SUPABASE_DEST_SERVICE_ROLE_KEY="$destination_service_role_key"
SUPABASE_DEST_DB_URL="$destination_database_url"

active_url_found=false
for active_url in "${VITE_SUPABASE_URL:-}" "${SUPABASE_URL:-}"; do
  [ -n "$active_url" ] || continue
  active_url_found=true
done
if [ "$active_url_found" != "true" ]; then
  echo "Current Supabase target is missing; refusing to replace an unknown configuration." >&2
  exit 1
fi
if ! node -e '
    const expected = ["qfsxsbzaqwmyuxhramyw", "vuvyweofsutgqdtbjckj"];
  const values = [process.env.VITE_SUPABASE_URL, process.env.SUPABASE_URL].filter(Boolean);
  try {
    if (!values.length || values.some((raw) => {
      const parsed = new URL(raw);
      return parsed.protocol !== "https:" ||
        !expected.some((ref) => parsed.hostname === `${ref}.supabase.co`) ||
        !["", "/"].includes(parsed.pathname) || parsed.search || parsed.hash;
    })) process.exit(1);
  } catch {
    process.exit(1);
  }
'; then
  echo "Current Supabase target is not the expected BIL source or destination; refusing to switch." >&2
  exit 1
fi

rollback_file="$PROJECT_DIR/.env.supabase-rollback"
if [ -L "$rollback_file" ]; then
  echo "Rollback environment file must not be a symbolic link." >&2
  exit 1
fi
if [ ! -e "$rollback_file" ]; then
  rollback_temp="$(mktemp "$PROJECT_DIR/.env.supabase-rollback.XXXXXX")"
  chmod 600 "$rollback_temp"
  rollback_env_value() {
    local rollback_name="$1" active_name="$2" value="" escaped
    value="${!active_name:-}"
    [ -n "$value" ] || return 0
    case "$value" in
      *$'\n'*|*$'\r'*)
        echo "Existing rollback values must be single-line values." >&2
        return 1
        ;;
    esac
    escaped="${value//\\/\\\\}"
    escaped="${escaped//\"/\\\"}"
    escaped="${escaped//\$/\\$}"
    escaped="${escaped//\`/\\\`}"
    printf '%s="%s"\n' "$rollback_name" "$escaped" >> "$rollback_temp"
  }
  rollback_env_value SUPABASE_ROLLBACK_VITE_SUPABASE_URL VITE_SUPABASE_URL
  rollback_env_value SUPABASE_ROLLBACK_SUPABASE_URL SUPABASE_URL
  rollback_env_value SUPABASE_ROLLBACK_VITE_SUPABASE_KEY VITE_SUPABASE_KEY
  rollback_env_value SUPABASE_ROLLBACK_SERVICE_ROLE_KEY SUPABASE_SERVICE_ROLE_KEY
  rollback_env_value SUPABASE_ROLLBACK_SERVICE_KEY SUPABASE_SERVICE_KEY
  rollback_env_value SUPABASE_ROLLBACK_DB_URL SUPABASE_DB_URL
  rollback_env_value SUPABASE_ROLLBACK_DATABASE_URL SUPABASE_DATABASE_URL
  mv -f "$rollback_temp" "$rollback_file"
  chmod 600 "$rollback_file"
elif [ ! -f "$rollback_file" ]; then
  echo "Rollback environment path exists but is not a regular file." >&2
  exit 1
fi

upsert_env() {
  local key="$1" value="$2"
  case "$value" in
    *$'\n'*|*$'\r'*)
      echo "Supabase target value for ${key} must be a single line." >&2
      return 1
      ;;
  esac
  local temp_file
  temp_file="$(mktemp "$PROJECT_DIR/.env.XXXXXX")"
  chmod 600 "$temp_file"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "${key}="*|"export ${key}="*) continue ;;
    esac
    printf '%s\n' "$line" >> "$temp_file"
  done < "$ENV_FILE"
  local escaped_value
  escaped_value="${value//\\/\\\\}"
  escaped_value="${escaped_value//\"/\\\"}"
  escaped_value="${escaped_value//\$/\\$}"
  escaped_value="${escaped_value//\`/\\\`}"
  printf '%s="%s"\n' "$key" "$escaped_value" >> "$temp_file"
  mv -f "$temp_file" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Updated ${key} in VPS .env."
}

upsert_env "VITE_SUPABASE_URL" "$SUPABASE_DEST_URL"
upsert_env "SUPABASE_URL" "$SUPABASE_DEST_URL"
upsert_env "VITE_SUPABASE_KEY" "$SUPABASE_DEST_PUBLISHABLE_KEY"
upsert_env "SUPABASE_SERVICE_ROLE_KEY" "$SUPABASE_DEST_SERVICE_ROLE_KEY"
upsert_env "SUPABASE_SERVICE_KEY" "$SUPABASE_DEST_SERVICE_ROLE_KEY"
upsert_env "SUPABASE_DB_URL" "$SUPABASE_DEST_DB_URL"
upsert_env "SUPABASE_DATABASE_URL" "$SUPABASE_DEST_DB_URL"
upsert_env "SUPABASE_DEST_URL" "$SUPABASE_DEST_URL"
upsert_env "SUPABASE_DEST_PUBLISHABLE_KEY" "$SUPABASE_DEST_PUBLISHABLE_KEY"
upsert_env "SUPABASE_DEST_SERVICE_ROLE_KEY" "$SUPABASE_DEST_SERVICE_ROLE_KEY"
upsert_env "SUPABASE_DEST_DB_URL" "$SUPABASE_DEST_DB_URL"
