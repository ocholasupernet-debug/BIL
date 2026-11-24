#!/usr/bin/env bash
#
# Staged cutover of the isolated RouterOS-management VPN endpoint from the
# .org hostname to vpn.isplatty.com. This does not touch customer VPN services,
# Nginx, application source, databases, or router configurations.
set -Eeuo pipefail

PROJECT_DIR="/var/www/ocholasupernet"
ENV_FILE="${PROJECT_DIR}/.env"
OPENVPN_DIR="/etc/openvpn"
SERVER_DIR="${OPENVPN_DIR}/server"
STATE_DIR="/var/lib/openvpn/ochola-router-management"
WEBROOT="/var/www/letsencrypt"
HOST_ORG="vpn.isplatty.org"
HOST_COM="vpn.isplatty.com"
CERT_NAME="router-management-vpn-dual"
CERT_DIR="/etc/letsencrypt/live/${CERT_NAME}"
BACKUP_ROOT="/var/backups/ocholasupernet/router-management-vpn-hostname"
LOCK_FILE="/var/lock/ochola-vpn-host-cutover.lock"
BOOTSTRAP_SCRIPT="${VPN_BOOTSTRAP_SCRIPT:-${PROJECT_DIR}/deploy/bootstrap-router-management-vpn.sh}"
VERIFY_SCRIPT="${VPN_VERIFY_SCRIPT:-${PROJECT_DIR}/deploy/verify-router-management-vps.sh}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

if [ "$(id -u)" -ne 0 ]; then
  fail "this staged cutover must run as root."
fi
if [ "${CONFIRM_VPN_MANAGEMENT_HOST:-}" != "$HOST_COM" ]; then
  fail "type vpn.isplatty.com in the manual workflow confirmation."
fi
if [ ! -d "$PROJECT_DIR" ] || [ ! -f "${PROJECT_DIR}/ecosystem.config.cjs" ]; then
  fail "the expected BIL VPS application directory was not found."
fi
if [ ! -f "$ENV_FILE" ] || [ -L "$ENV_FILE" ]; then
  fail "the existing regular VPS .env is unavailable; refusing to create or replace it."
fi
if [ ! -x "$BOOTSTRAP_SCRIPT" ] && [ ! -f "$BOOTSTRAP_SCRIPT" ]; then
  fail "the scoped router-management bootstrap helper is unavailable."
fi
if [ ! -x "$VERIFY_SCRIPT" ] && [ ! -f "$VERIFY_SCRIPT" ]; then
  fail "the read-only router-management verification helper is unavailable."
fi

install -d -m 0755 "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
flock -n 9 || fail "another router-management VPN change is already running."

for command_name in awk certbot chown chmod cp curl date dirname flock getent grep \
  install ip iptables mkdir mktemp openssl pm2 sha256sum sleep ss stat systemctl \
  tar tr; do
  command -v "$command_name" >/dev/null 2>&1 ||
    fail "required command is unavailable: ${command_name}."
done

if [ "$(stat -c '%u' "$ENV_FILE")" -ne 0 ]; then
  fail "the VPS .env is not owned by root; refusing to change it."
fi
env_mode="$(stat -c '%a' "$ENV_FILE")"
if (( (8#$env_mode & 077) != 0 )); then
  fail "the VPS .env permissions are broader than owner-only; refusing to change it."
fi

resolve_ipv4() {
  getent ahostsv4 "$1" | awk '{print $1}' | sort -u
}

org_addresses="$(resolve_ipv4 "$HOST_ORG")"
com_addresses="$(resolve_ipv4 "$HOST_COM")"
if [ -z "$org_addresses" ] || [ "$org_addresses" != "$com_addresses" ]; then
  fail "public DNS for the two VPN hostnames does not yet resolve to the same IPv4 address."
fi

for port in 1196 1197; do
  ss -H -lnt | awk -v p=":${port}" '$4 ~ (p "$") { found=1 } END { exit !found }' ||
    fail "the existing management VPN listener on TCP ${port} is not active."
done

select_active_unit() {
  local stem="$1" modern="openvpn-server@$1" legacy="openvpn@$1"
  local modern_active=false legacy_active=false
  systemctl is-active --quiet "$modern" && modern_active=true
  systemctl is-active --quiet "$legacy" && legacy_active=true
  if [ "$modern_active" = true ] && [ "$legacy_active" = true ]; then
    fail "both OpenVPN unit families are active for ${stem}; refusing to disturb the tunnel owner."
  elif [ "$modern_active" = true ]; then
    printf '%s\n' "$modern"
  elif [ "$legacy_active" = true ]; then
    printf '%s\n' "$legacy"
  else
    fail "no active OpenVPN service was found for ${stem}."
  fi
}

PRIMARY_UNIT="$(select_active_unit ochola-router)"
BACKUP_UNIT="$(select_active_unit ochola-router-backup)"

if ! pm2 describe ocholanet-api >/dev/null 2>&1; then
  fail "the existing BIL API process is not available in PM2."
fi
curl --fail --silent --show-error --max-time 8 \
  http://127.0.0.1:8080/api/healthz >/dev/null ||
  fail "the existing BIL API health check did not pass before the change."

verify_dual_certificate() {
  local fullchain="${CERT_DIR}/fullchain.pem"
  local key="${CERT_DIR}/privkey.pem"
  local chain="${CERT_DIR}/chain.pem"
  [ -s "$fullchain" ] && [ -s "$key" ] && [ -s "$chain" ] || return 1
  openssl x509 -in "$fullchain" -noout -checkhost "$HOST_ORG" >/dev/null 2>&1 || return 1
  openssl x509 -in "$fullchain" -noout -checkhost "$HOST_COM" >/dev/null 2>&1 || return 1
  openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt \
    -untrusted "$chain" "$fullchain" >/dev/null 2>&1 || return 1
  if ! cmp -s \
    <(openssl x509 -in "$fullchain" -pubkey -noout | sha256sum | awk '{print $1}') \
    <(openssl pkey -in "$key" -pubout | sha256sum | awk '{print $1}')
  then
    return 1
  fi
}

if [ -e "$CERT_DIR" ]; then
  verify_dual_certificate ||
    fail "the dedicated certificate lineage exists but is invalid; it was not replaced automatically."
else
  challenge_token="$(openssl rand -hex 24)"
  challenge_dir="${WEBROOT}/.well-known/acme-challenge"
  challenge_file="${challenge_dir}/${challenge_token}"
  install -d -m 0755 "$challenge_dir"
  printf '%s' "$challenge_token" > "$challenge_file"
  chmod 0644 "$challenge_file"
  trap 'rm -f "${challenge_file:-}"' EXIT
  served_token="$(
    curl --fail --silent --show-error --max-time 10 \
      --resolve "${HOST_COM}:80:127.0.0.1" \
      "http://${HOST_COM}/.well-known/acme-challenge/${challenge_token}"
  )" || fail "the local HTTP-01 challenge route did not serve from the expected webroot."
  [ "$served_token" = "$challenge_token" ] ||
    fail "the local HTTP-01 challenge response did not match the staged test file."
  rm -f "$challenge_file"
  trap - EXIT
  certbot certonly \
    --webroot \
    --webroot-path "$WEBROOT" \
    --non-interactive \
    --agree-tos \
    --email "${CERTBOT_EMAIL:-admin@isplatty.org}" \
    --preferred-challenges http \
    --cert-name "$CERT_NAME" \
    -d "$HOST_ORG" \
    -d "$HOST_COM"
  verify_dual_certificate ||
    fail "the issued certificate did not pass hostname, chain, and key-pair validation."
fi

echo "PASS: dual-host certificate is valid for vpn.isplatty.org and vpn.isplatty.com."

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${BACKUP_ROOT}/${stamp}"
install -d -m 0700 "$BACKUP_DIR"
cp -a "$ENV_FILE" "${BACKUP_DIR}/.env"
chmod 0600 "${BACKUP_DIR}/.env"

CONFIG_PATHS=(
  "${SERVER_DIR}/ochola-router.conf"
  "${SERVER_DIR}/ochola-router-backup.conf"
  "${OPENVPN_DIR}/ochola-router.conf"
  "${OPENVPN_DIR}/ochola-router-backup.conf"
)
for config_path in "${CONFIG_PATHS[@]}"; do
  marker="${BACKUP_DIR}/$(printf '%s' "$config_path" | tr '/' '_').missing"
  if [ -e "$config_path" ]; then
    cp -a --parents "$config_path" "$BACKUP_DIR"
  else
    : > "$marker"
  fi
done
if [ -d "$STATE_DIR" ]; then
  cp -a "$STATE_DIR" "${BACKUP_DIR}/management-state"
else
  : > "${BACKUP_DIR}/management-state.missing"
fi
chmod -R go-rwx "$BACKUP_DIR"

restore_configuration() {
  local config_path marker saved
  cp -a "${BACKUP_DIR}/.env" "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
  for config_path in "${CONFIG_PATHS[@]}"; do
    marker="${BACKUP_DIR}/$(printf '%s' "$config_path" | tr '/' '_').missing"
    saved="${BACKUP_DIR}${config_path}"
    if [ -f "$marker" ]; then
      rm -f "$config_path"
    elif [ -e "$saved" ]; then
      install -d -m 0700 "$(dirname "$config_path")"
      cp -a "$saved" "$config_path"
    fi
  done
  if [ -f "${BACKUP_DIR}/management-state.missing" ]; then
    rm -rf "$STATE_DIR"
  elif [ -d "${BACKUP_DIR}/management-state" ]; then
    rm -rf "$STATE_DIR"
    cp -a "${BACKUP_DIR}/management-state" "$STATE_DIR"
  fi
  systemctl restart "$PRIMARY_UNIT" || echo "WARNING: primary management service restart needs inspection." >&2
  systemctl restart "$BACKUP_UNIT" || echo "WARNING: backup management service restart needs inspection." >&2
  (
    cd "$PROJECT_DIR"
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
    pm2 reload ecosystem.config.cjs --env standalone --update-env
  ) || echo "WARNING: PM2 environment rollback needs inspection." >&2
}

rollback_on_failure() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ -n "${BACKUP_DIR:-}" ] && [ -d "$BACKUP_DIR" ]; then
    echo "Cutover did not complete; restoring the backed-up .env and management VPN configuration." >&2
    restore_configuration
  fi
  exit "$status"
}
trap rollback_on_failure EXIT

upsert_endpoint() {
  local temp escaped
  temp="$(mktemp "${PROJECT_DIR}/.env.vpn-cutover.XXXXXX")"
  chmod 0600 "$temp"
  awk '
    /^[[:space:]]*(export[[:space:]]+)?ROUTER_OPENVPN_ENDPOINT=/ { next }
    { print }
  ' "$ENV_FILE" > "$temp"
  printf -v escaped '%q' "$HOST_COM"
  printf 'ROUTER_OPENVPN_ENDPOINT=%s\n' "$escaped" >> "$temp"
  chown --reference="$ENV_FILE" "$temp"
  chmod 0600 "$temp"
  mv -f "$temp" "$ENV_FILE"
}

upsert_endpoint
VPN_SKIP_PACKAGE_INSTALL=true \
VPN_SKIP_FIREWALL_CHANGES=true \
VPN_RESTART_ACTIVE_MANAGEMENT=true \
  bash "$BOOTSTRAP_SCRIPT"

for config_path in \
  "${SERVER_DIR}/ochola-router.conf" \
  "${SERVER_DIR}/ochola-router-backup.conf" \
  "${OPENVPN_DIR}/ochola-router.conf" \
  "${OPENVPN_DIR}/ochola-router-backup.conf"; do
  if [ -f "$config_path" ]; then
    grep -Fqx "ca ${CERT_DIR}/chain.pem" "$config_path" ||
      fail "management VPN CA path was not updated in a managed config."
    grep -Fqx "cert ${CERT_DIR}/fullchain.pem" "$config_path" ||
      fail "management VPN certificate path was not updated in a managed config."
    grep -Fqx "key ${CERT_DIR}/privkey.pem" "$config_path" ||
      fail "management VPN private-key path was not updated in a managed config."
  fi
done

(
  cd "$PROJECT_DIR"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  [ "${ROUTER_OPENVPN_ENDPOINT:-}" = "$HOST_COM" ] ||
    fail "the saved router-management endpoint did not validate."
  pm2 reload ecosystem.config.cjs --env standalone --update-env
)

api_ready=false
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 5 \
    http://127.0.0.1:8080/api/healthz >/dev/null; then
    api_ready=true
    break
  fi
  sleep 2
done
[ "$api_ready" = true ] || fail "the BIL API health check failed after its environment reload."

verification_log="$(mktemp)"
chmod 0600 "$verification_log"
if ! bash "$VERIFY_SCRIPT" > "$verification_log" 2>&1; then
  grep '^FAILED CHECK:' "$verification_log" >&2 || true
  rm -f "$verification_log"
  fail "the isolated management VPN readiness verification failed."
fi
rm -f "$verification_log"

echo "PASS: router-management VPN now advertises ${HOST_COM}."
echo "PASS: old .org DNS and its certificate lineage were preserved for rollback."
echo "PASS: BIL API health is good after the endpoint environment reload."
echo "Backup: ${BACKUP_DIR}"
trap - EXIT
