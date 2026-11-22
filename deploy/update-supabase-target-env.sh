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
    const hostRef = database.hostname.match(/^db\.([a-z0-9]{20})\.supabase\.co$/i)?.[1]?.toLowerCase();
    const userRef = username.match(/(?:^|\.)([a-z0-9]{20})$/i)?.[1]?.toLowerCase();
    if (api.protocol !== "https:" || api.hostname !== `${ref}.supabase.co`) process.exit(1);
    if (!["postgres:", "postgresql:"].includes(database.protocol) || (hostRef !== ref && userRef !== ref)) process.exit(1);
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
  printf -v escaped_value '%q' "$value"
  printf '%s=%s\n' "$key" "$escaped_value" >> "$temp_file"
  mv -f "$temp_file" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Updated ${key} in VPS .env."
}

backup_once() {
  local rollback_name="$1" active_name="$2"
  if [ -z "${!rollback_name:-}" ] && [ -n "${!active_name:-}" ]; then
    upsert_env "$rollback_name" "${!active_name}"
  fi
}

backup_once SUPABASE_ROLLBACK_URL VITE_SUPABASE_URL
backup_once SUPABASE_ROLLBACK_SUPABASE_URL SUPABASE_URL
backup_once SUPABASE_ROLLBACK_PUBLISHABLE_KEY VITE_SUPABASE_KEY
backup_once SUPABASE_ROLLBACK_SERVICE_ROLE_KEY SUPABASE_SERVICE_ROLE_KEY
backup_once SUPABASE_ROLLBACK_SERVICE_KEY SUPABASE_SERVICE_KEY
backup_once SUPABASE_ROLLBACK_DB_URL SUPABASE_DB_URL
backup_once SUPABASE_ROLLBACK_DATABASE_URL SUPABASE_DATABASE_URL

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
