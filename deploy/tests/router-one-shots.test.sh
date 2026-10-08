#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REAL_NODE="$(command -v node)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
CALL_LOG="$TEMP_DIR/node-calls.log"
BIN_DIR="$TEMP_DIR/bin"
mkdir -p "$BIN_DIR"
export CALL_LOG

cat > "$BIN_DIR/node" <<'NODE'
#!/bin/bash
printf '%s\n' "$*" >> "$CALL_LOG"
NODE
chmod +x "$BIN_DIR/node"
export PATH="$BIN_DIR:$PATH"

test "$(grep -Fc 'portalFileReplacementConsent: true' "$SCRIPT_DIR/refresh-hotspot-portals-once.mjs")" -eq 2
grep -Fq '"adminId": 33' "$SCRIPT_DIR/portal-refresh-once.json"
grep -Fq '"authVersion": 2' "$SCRIPT_DIR/portal-refresh-once.json"
grep -Fq '"tenantSubdomain": "ocholasupernet"' "$SCRIPT_DIR/portal-refresh-once.json"
grep -Fq '"ispBridgeRouterName": "ocholasupernet2"' "$SCRIPT_DIR/portal-refresh-once.json"
grep -Fq '"ispBridgeName": "hotspot-bridge"' "$SCRIPT_DIR/portal-refresh-once.json"
grep -Fq 'createAdminSessionToken' "$SCRIPT_DIR/refresh-hotspot-portals-once.mjs"
! grep -Fq '"ispBridgeRouterId"' "$SCRIPT_DIR/portal-refresh-once.json"
grep -Fq 'resolveTenantRouterTargets(await listTenantRouters())' "$SCRIPT_DIR/refresh-hotspot-portals-once.mjs"
grep -Fq 'for (const target of targets)' "$SCRIPT_DIR/refresh-hotspot-portals-once.mjs"
grep -Fq 'resolvePortalBridgeSelection(routerName, ispBridgeName)' "$SCRIPT_DIR/refresh-hotspot-portals-once.mjs"
grep -Fq 'return { autoSelectBridgeServer: true, expectedRouterName }' "$SCRIPT_DIR/portal-refresh-target.mjs"
grep -Fq '...selection' "$SCRIPT_DIR/refresh-hotspot-portals-once.mjs"
"$REAL_NODE" --test \
  "$SCRIPT_DIR/tests/portal-refresh-target.test.mjs" \
  "$SCRIPT_DIR/tests/portal-refresh-token.test.mjs"

make_project() {
  local project_dir="$1"
  mkdir -p "$project_dir/deploy"
  touch \
    "$project_dir/deploy/portal-refresh-once.json" \
    "$project_dir/deploy/vlan-200-inspection-once.json" \
    "$project_dir/deploy/vlan-200-provisioning-retry-once.json"
}

PORTAL_PROJECT="$TEMP_DIR/portal-only"
make_project "$PORTAL_PROJECT"
touch "$PORTAL_PROJECT/deploy/skip-live-router-oneshots-once"
bash "$SCRIPT_DIR/run-router-one-shots.sh" "$PORTAL_PROJECT" 1
test "$(wc -l < "$CALL_LOG")" -eq 1
grep -Fq "$PORTAL_PROJECT/deploy/refresh-hotspot-portals-once.mjs" "$CALL_LOG"
if grep -Eq 'inspect-vlan-200|retry-vlan-200' "$CALL_LOG"; then
  echo "Portal-only mode invoked an unrelated VLAN action." >&2
  exit 1
fi
test -f "$PORTAL_PROJECT/deploy/skip-live-router-oneshots-once"

MISSING_PROJECT="$TEMP_DIR/missing-portal"
mkdir -p "$MISSING_PROJECT/deploy"
if bash "$SCRIPT_DIR/run-router-one-shots.sh" "$MISSING_PROJECT" 1; then
  echo "Portal-only mode must fail when the portal marker is missing." >&2
  exit 1
fi

SKIP_PROJECT="$TEMP_DIR/skip"
make_project "$SKIP_PROJECT"
touch "$SKIP_PROJECT/deploy/skip-live-router-oneshots-once"
bash "$SCRIPT_DIR/run-router-one-shots.sh" "$SKIP_PROJECT" 0
test "$(wc -l < "$CALL_LOG")" -eq 1
test ! -f "$SKIP_PROJECT/deploy/skip-live-router-oneshots-once"

NORMAL_PROJECT="$TEMP_DIR/normal"
make_project "$NORMAL_PROJECT"
bash "$SCRIPT_DIR/run-router-one-shots.sh" "$NORMAL_PROJECT" 0
test "$(wc -l < "$CALL_LOG")" -eq 4
grep -Fq "$NORMAL_PROJECT/deploy/refresh-hotspot-portals-once.mjs" "$CALL_LOG"
grep -Fq "$NORMAL_PROJECT/deploy/inspect-vlan-200-once.mjs" "$CALL_LOG"
grep -Fq "$NORMAL_PROJECT/deploy/retry-vlan-200-provisioning-once.mjs" "$CALL_LOG"

echo "PASS: portal-only, missing marker, broad skip, and normal one-time action paths"