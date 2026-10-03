#!/bin/bash
set -e

PROJECT_DIR="${1:?Project directory is required}"
PORTAL_REFRESH_ONLY="${2:-0}"

ROUTER_ONESHOT_SKIP_MARKER="$PROJECT_DIR/deploy/skip-live-router-oneshots-once"
PORTAL_REFRESH_MARKER="$PROJECT_DIR/deploy/portal-refresh-once.json"
VLAN_INSPECTION_MARKER="$PROJECT_DIR/deploy/vlan-200-inspection-once.json"
VLAN_PROVISION_RETRY_MARKER="$PROJECT_DIR/deploy/vlan-200-provisioning-retry-once.json"

if [ "$PORTAL_REFRESH_ONLY" = "1" ]; then
  if [ ! -f "$PORTAL_REFRESH_MARKER" ]; then
    echo "ERROR: Portal-only deployment requested, but its portal refresh marker is missing." >&2
    exit 1
  fi
  echo "Running only the requested Hotspot portal refresh; leaving all other one-time RouterOS actions untouched."
  node "$PROJECT_DIR/deploy/refresh-hotspot-portals-once.mjs" "$PORTAL_REFRESH_MARKER"
  exit 0
fi

if [ -f "$ROUTER_ONESHOT_SKIP_MARKER" ]; then
  rm -f "$ROUTER_ONESHOT_SKIP_MARKER"
  echo "Skipping optional one-time RouterOS operations for this deployment."
  exit 0
fi

if [ -f "$PORTAL_REFRESH_MARKER" ]; then
  echo "[12/12] Applying the requested one-time Hotspot portal refresh..."
  node "$PROJECT_DIR/deploy/refresh-hotspot-portals-once.mjs" "$PORTAL_REFRESH_MARKER"
fi

if [ -f "$VLAN_INSPECTION_MARKER" ]; then
  echo "[13/13] Checking the requested VLAN tag through the production read-only API..."
  node "$PROJECT_DIR/deploy/inspect-vlan-200-once.mjs" "$VLAN_INSPECTION_MARKER"
fi

if [ -f "$VLAN_PROVISION_RETRY_MARKER" ]; then
  echo "[14/14] Retrying the authorized VLAN 200 service provisioning..."
  node "$PROJECT_DIR/deploy/retry-vlan-200-provisioning-once.mjs" "$VLAN_PROVISION_RETRY_MARKER"
fi