#!/usr/bin/env bash
set -euo pipefail
umask 077

# This script is called only by the guarded app-only activation release.
cd /var/www/ocholasupernet
[[ "$(id -u)" == 0 && -s .env && ! -L .env ]]
state=/var/lib/ocholasupernet
marker="$state/employee-portal.enabled"
host=employee1088.isplatty.com

status_is() {
  curl --fail --silent --show-error --max-time 8 -H "Host: $host" \
    http://127.0.0.1:8080/api/employee/status |
    node -e 'try { const r=JSON.parse(require("fs").readFileSync(0,"utf8")); if(r.ok!==true || r.portal!=="admin" || r.enabled!==(process.argv[1]==="true")) process.exit(1); } catch {process.exit(1);}' "$1"
}

[[ ! -L "$state" && ! -e "$marker" && ! -L "$marker" ]] || {
  echo "Portal activation expects a regular state directory and no existing marker." >&2
  exit 1
}
status_is false || { echo "Portal was not in its expected disabled state." >&2; exit 1; }
(
  set -a
  source .env
  set +a
  node --input-type=module <<'NODE'
import { verifySupabaseRuntimeTarget } from "./deploy/verify-supabase-runtime-target.mjs";
const target = await verifySupabaseRuntimeTarget();
if (!target.ok) {
  console.error(`Portal activation: database preflight failed (${target.category})`);
  process.exit(1);
}
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SERVICE_KEY?.trim();
if (!key) { console.error("Portal activation: API service role is not configured."); process.exit(1); }
const url = new URL("/rest/v1/rpc/employee_admin_summary", process.env.VITE_SUPABASE_URL);
try {
  const reply = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!reply.ok) { console.error(`Portal activation: summary unavailable (HTTP ${reply.status}).`); process.exit(1); }
  const summary = await reply.json();
  if (!summary || typeof summary.employee_count !== "number") throw new Error("unexpected summary shape");
} catch {
  console.error("Portal activation: employee summary verification failed.");
  process.exit(1);
}
NODE
)

install -d -m 0755 -o root -g root "$state"
pending="$(mktemp "$state/.employee-portal.XXXXXX")"
activated=false
cleanup() {
  rm -f -- "$pending"
  if [[ "$activated" != true ]]; then rm -f -- "$marker"; fi
}
trap cleanup EXIT
printf 'enabled\n' >"$pending"
chmod 0644 "$pending"
mv -T -- "$pending" "$marker"

status_is true || { echo "Portal status did not change; reverting activation." >&2; exit 1; }
auth_status="$(curl --silent --show-error --max-time 8 -o /dev/null -w '%{http_code}' -H "Host: $host" \
  http://127.0.0.1:8080/api/employee/admin/summary)"
[[ "$auth_status" == 401 ]] || { echo "Portal authentication check failed; reverting activation." >&2; exit 1; }
activated=true
echo "Employee portal enabled; admin authentication remains required."
