#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="${ROOT}/.github/workflows/deploy.yml"
BOOTSTRAP="${ROOT}/deploy/bootstrap-router-management-vpn.sh"
ACTIVATE="${ROOT}/deploy/activate-router-management-vpn-com.sh"
ECOSYSTEM="${ROOT}/ecosystem.config.cjs"

bash -n "$BOOTSTRAP"
bash -n "$ACTIVATE"
bash -n "${ROOT}/deploy/verify-router-management-vps.sh"

grep -Fq 'vpn_management_host_cutover:' "$WORKFLOW"
grep -Fq "github.event_name == 'workflow_dispatch' && inputs.vpn_management_host_cutover == true" "$WORKFLOW"
grep -Fq 'refs/heads/deploy/vpn-management-host-cutover-*' "$WORKFLOW"
grep -Fq 'CONFIRM_HOST" != "vpn.isplatty.com"' "$WORKFLOW"
grep -Fq "inputs.vpn_management_host_cutover == true" "$WORKFLOW"
grep -Fq 'fingerprint: "SHA256:XlSA4l6O/lK6axMYwcViSVdoy2Z8i3DPDjJtQtQrtFc"' "$WORKFLOW"
grep -Fq 'upsert_env "ROUTER_OPENVPN_ENDPOINT"  "vpn.isplatty.com"' "$WORKFLOW"
grep -Fq 'upsert_env "VPS_HOST"                 "vpn.isplatty.org"' "$WORKFLOW"
grep -Fq 'process.env.ROUTER_OPENVPN_ENDPOINT || "vpn.isplatty.com"' "$ECOSYSTEM"

if grep -Eqi 'deploy/deploy\.sh|configure-nginx\.sh|supabase|router.*oneshot|mikrotik' "$ACTIVATE"; then
  echo "FAIL: activation script references an excluded app, database, Nginx, or router action." >&2
  exit 1
fi
if grep -Eqi 'deploy/deploy\.sh|configure-nginx\.sh|supabase|pm2|migration|mikrotik' \
  <(sed -n '/^  vpn-management-host-cutover:/,/^  deploy:/p' "$WORKFLOW"); then
  echo "FAIL: scoped workflow job references an excluded deployment or router action." >&2
  exit 1
fi

grep -Fq 'VPN_SKIP_PACKAGE_INSTALL=true' "$ACTIVATE"
grep -Fq 'VPN_SKIP_FIREWALL_CHANGES=true' "$ACTIVATE"
grep -Fq 'VPN_RESTART_ACTIVE_MANAGEMENT=true' "$ACTIVATE"
grep -Fq 'ROUTER_OPENVPN_ENDPOINT' "$ACTIVATE"
grep -Fq 'vpn.isplatty.org' "$ACTIVATE"
grep -Fq 'vpn.isplatty.com' "$ACTIVATE"

echo "PASS: VPN hostname cutover is separately guarded, endpoint-specific, and excludes unrelated deployment actions."
