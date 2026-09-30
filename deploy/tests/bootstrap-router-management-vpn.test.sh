#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BOOTSTRAP="${REPO_ROOT}/deploy/bootstrap-router-management-vpn.sh"
WORK_DIR="$(mktemp -d)"
MOCK_BIN="${WORK_DIR}/mock-bin"
mkdir -p "$MOCK_BIN"
trap 'rm -rf "$WORK_DIR"' EXIT

cat > "${MOCK_BIN}/mock-command" <<'MOCKEOF'
#!/usr/bin/env bash
set -euo pipefail

name="${0##*/}"
if [ "$name" = "mock-command" ]; then
  name="${1:?mock command name required}"
  shift
fi

log_call() {
  printf '%s' "$name" >> "$VPN_TEST_LOG"
  printf ' <%s>' "$@" >> "$VPN_TEST_LOG"
  printf '\n' >> "$VPN_TEST_LOG"
}

case "$name" in
  sudo)
    while [ "${1:-}" = "-n" ]; do shift; done
    exec "$@"
    ;;
  id)
    echo 1000
    ;;
  systemctl)
    log_call "$@"
    if [ "${1:-}" = "start" ]; then
      printf '%s\n' "${2:?unit required}" >> "$VPN_TEST_STATE_FILE"
    fi
    if [ "${1:-}" = "show" ]; then
      if [ "${2:-}" = "--property=ActiveState" ]; then
        unit="${!#}"
        if grep -Fxq "$unit" "$VPN_TEST_STATE_FILE"; then
          echo active
        else
          case "${VPN_TEST_SCENARIO}:${unit}" in
          compatibility:openvpn@ochola-router|both-active:openvpn-server@ochola-router|both-active:openvpn@ochola-router)
            echo active
            ;;
          legacy-mismatch:openvpn@ochola-router)
            echo active
            ;;
          *)
            echo inactive
            ;;
          esac
        fi
      elif [ "${2:-}" = "--property=ExecMainStartTimestamp" ]; then
        echo "${VPN_TEST_START_TIMESTAMP:-2100-01-01 00:00:00 UTC}"
      fi
    fi
    ;;
  ip)
    log_call "$@"
    if [ "${1:-}" = "link" ] && [ "${2:-}" = "show" ]; then
      if [ "${4:-}" = "tun-router" ] &&
         [ "$VPN_TEST_SCENARIO" = "unknown-owner" ]
      then
        exit 0
      fi
      exit 1
    fi
    if [ "${1:-}" = "-4" ] && [ "${2:-}" = "addr" ]; then
      case "${5:-}" in
        tun-router)
          if [ "$VPN_TEST_SCENARIO" = "wrong-primary-address" ]; then
            echo "inet 10.8.5.9/24 scope global tun-router"
          else
            echo "inet 10.8.5.1/24 scope global tun-router"
          fi
          ;;
        tun-router-bkp) echo "inet 10.8.6.1/24 scope global tun-router-bkp" ;;
      esac
    fi
    ;;
  ss)
    log_call "$@"
    if [ "${1:-}" = "-H" ] && [ "${2:-}" = "-lnt" ]; then
      if [ "$VPN_TEST_SCENARIO" = "missing-primary-listener" ]; then
        echo 'LISTEN 0 128 0.0.0.0:1197 0.0.0.0:*'
      else
        printf '%s\n' \
          'LISTEN 0 128 0.0.0.0:1196 0.0.0.0:*' \
          'LISTEN 0 128 0.0.0.0:1197 0.0.0.0:*'
      fi
    fi
    ;;
  apt-get|iptables-save|journalctl|fuser|iptables|sleep)
    log_call "$@"
    if [ "$name" = "iptables" ] && [ "${1:-}" = "-C" ]; then
      exit 1
    fi
    ;;
  openssl)
    log_call "$@"
    echo "X509v3 Subject Alternative Name: DNS:vpn.isplatty.org"
    ;;
  *)
    echo "Unexpected unmocked command: ${name}" >&2
    exit 90
    ;;
esac
MOCKEOF
chmod +x "${MOCK_BIN}/mock-command"

for command_name in sudo id systemctl ip ss apt-get iptables-save journalctl fuser iptables sleep openssl; do
  ln -s mock-command "${MOCK_BIN}/${command_name}"
done

assert_contains() {
  local file="$1"
  local text="$2"
  if ! grep -Fq "$text" "$file"; then
    echo "FAIL: expected '${text}' in ${file}" >&2
    cat "$file" >&2
    exit 1
  fi
}

assert_not_contains() {
  local file="$1"
  local text="$2"
  if grep -Fq "$text" "$file"; then
    echo "FAIL: did not expect '${text}' in ${file}" >&2
    cat "$file" >&2
    exit 1
  fi
}

prepare_root() {
  local scenario="$1"
  local root="${WORK_DIR}/${scenario}/root"
  local cert_dir="${root}/etc/letsencrypt/live/isplatty.org-wildcard"
  mkdir -p "$cert_dir" "${root}/etc/openvpn"
  printf 'test certificate\n' > "${cert_dir}/fullchain.pem"
  printf 'test private key\n' > "${cert_dir}/privkey.pem"
  printf 'test chain\n' > "${cert_dir}/chain.pem"
  if [ "$scenario" = "compatibility" ]; then
    cat > "${root}/etc/openvpn/ochola-router.conf" <<'CONFEOF'
port 1196
dev tun-router
server 10.8.5.0 255.255.255.0
CONFEOF
  elif [ "$scenario" = "legacy-mismatch" ]; then
    cat > "${root}/etc/openvpn/ochola-router.conf" <<'CONFEOF'
port 1196
dev tun-router
server 10.8.0.0 255.255.255.0
CONFEOF
  fi
  printf '%s\n' "$root"
}

run_scenario() {
  local scenario="$1"
  local root="$2"
  local output="${WORK_DIR}/${scenario}/output.log"
  local command_log="${WORK_DIR}/${scenario}/commands.log"
  local state_file="${WORK_DIR}/${scenario}/states"
  mkdir -p "${WORK_DIR}/${scenario}"
  [ -e "$state_file" ] || : > "$state_file"
  : > "$command_log"
  if env \
    PATH="${MOCK_BIN}:${PATH}" \
    VPN_BOOTSTRAP_ROOT="$root" \
    VPN_TEST_SCENARIO="$scenario" \
    VPN_TEST_LOG="$command_log" \
    VPN_TEST_STATE_FILE="$state_file" \
    bash "$BOOTSTRAP" > "$output" 2>&1
  then
    SCENARIO_STATUS=0
  else
    SCENARIO_STATUS=$?
  fi
  SCENARIO_OUTPUT="$output"
  SCENARIO_LOG="$command_log"
}

compatibility_root="$(prepare_root compatibility)"
run_scenario compatibility "$compatibility_root"
if [ "$SCENARIO_STATUS" -ne 0 ]; then
  echo "FAIL: healthy compatibility scenario failed" >&2
  cat "$SCENARIO_OUTPUT" >&2
  exit 1
fi
assert_contains "$SCENARIO_OUTPUT" "Preserving active openvpn@ochola-router"
assert_contains "$SCENARIO_LOG" "systemctl <enable> <openvpn-server@ochola-router>"
assert_contains "$SCENARIO_LOG" "systemctl <stop> <openvpn-server@ochola-router>"
assert_contains "$SCENARIO_LOG" "systemctl <disable> <--runtime> <openvpn@ochola-router>"
assert_contains "$SCENARIO_LOG" "systemctl <disable> <openvpn@ochola-router>"
assert_not_contains "$SCENARIO_LOG" "systemctl <restart> <openvpn-server@ochola-router>"
assert_not_contains "$SCENARIO_LOG" "systemctl <stop> <openvpn@ochola-router>"
echo "PASS: healthy compatibility unit is preserved and duplicate modern unit is disabled"

both_active_root="$(prepare_root both-active)"
run_scenario both-active "$both_active_root"
if [ "$SCENARIO_STATUS" -eq 0 ]; then
  echo "FAIL: simultaneously active unit families unexpectedly succeeded" >&2
  cat "$SCENARIO_OUTPUT" >&2
  exit 1
fi
assert_contains "$SCENARIO_OUTPUT" "Both openvpn-server@ochola-router and openvpn@ochola-router are active"
assert_not_contains "$SCENARIO_LOG" "systemctl <stop> <openvpn-server@ochola-router>"
assert_not_contains "$SCENARIO_LOG" "systemctl <stop> <openvpn@ochola-router>"
assert_not_contains "$SCENARIO_LOG" "systemctl <restart> <openvpn-server@ochola-router>"
assert_not_contains "$SCENARIO_LOG" "systemctl <restart> <openvpn@ochola-router>"
echo "PASS: simultaneous unit-family conflict fails without stopping either tunnel owner"

mismatch_root="$(prepare_root legacy-mismatch)"
run_scenario legacy-mismatch "$mismatch_root"
if [ "$SCENARIO_STATUS" -eq 0 ]; then
  echo "FAIL: mismatched legacy configuration unexpectedly succeeded" >&2
  cat "$SCENARIO_OUTPUT" >&2
  exit 1
fi
assert_contains "$SCENARIO_OUTPUT" "refusing to start a duplicate"
assert_not_contains "$SCENARIO_LOG" "systemctl <start> <openvpn-server@ochola-router>"
assert_not_contains "$SCENARIO_LOG" "systemctl <restart> <openvpn-server@ochola-router>"
assert_not_contains "$SCENARIO_LOG" "ip <link> <del>"
echo "PASS: mismatched legacy configuration fails without replacing its tunnel"

unknown_root="$(prepare_root unknown-owner)"
run_scenario unknown-owner "$unknown_root"
if [ "$SCENARIO_STATUS" -eq 0 ]; then
  echo "FAIL: unknown TUN owner unexpectedly succeeded" >&2
  cat "$SCENARIO_OUTPUT" >&2
  exit 1
fi
assert_contains "$SCENARIO_OUTPUT" "exists without an active"
assert_contains "$SCENARIO_LOG" "ip <link> <show> <dev> <tun-router>"
assert_not_contains "$SCENARIO_LOG" "systemctl <start> <openvpn-server@ochola-router>"
assert_not_contains "$SCENARIO_LOG" "ip <link> <del>"
echo "PASS: unknown TUN owner fails without starting a replacement or deleting the interface"

clean_root="$(prepare_root clean)"
run_scenario clean "$clean_root"
if [ "$SCENARIO_STATUS" -ne 0 ]; then
  echo "FAIL: clean-host scenario failed" >&2
  cat "$SCENARIO_OUTPUT" >&2
  exit 1
fi
assert_contains "$SCENARIO_LOG" "systemctl <start> <openvpn-server@ochola-router>"
assert_contains "$SCENARIO_LOG" "systemctl <start> <openvpn-server@ochola-router-backup>"
assert_contains "$SCENARIO_LOG" "ip <-4> <addr> <show> <dev> <tun-router>"
assert_contains "$SCENARIO_LOG" "ip <-4> <addr> <show> <dev> <tun-router-bkp>"
assert_contains "$SCENARIO_LOG" "ss <-H> <-lnt>"
assert_contains "$SCENARIO_OUTPUT" "Primary OpenVPN: TCP 1196 on 10.8.5.0/24"
assert_contains "$SCENARIO_OUTPUT" "Backup OpenVPN:  TCP 1197 on 10.8.6.0/24"
assert_contains "${clean_root}/etc/openvpn/server/ochola-router.conf" "auth-user-pass-verify ${clean_root}/etc/openvpn/verify-router-pass.sh via-env"
assert_contains "${clean_root}/etc/openvpn/server/ochola-router-backup.conf" "auth-user-pass-verify ${clean_root}/etc/openvpn/verify-router-backup-pass.sh via-env"
assert_contains "${clean_root}/etc/openvpn/verify-router-pass.sh" "PASSFILE=\"${clean_root}/etc/openvpn/router-passwd\""
assert_contains "${clean_root}/etc/openvpn/verify-router-backup-pass.sh" "PASSFILE=\"${clean_root}/etc/openvpn/router-backup-passwd\""
echo "PASS: clean host starts modern units and verifies both tunnel addresses and listeners"

repair_root="$(prepare_root managed-auth-repair)"
run_scenario managed-auth-repair "$repair_root"
if [ "$SCENARIO_STATUS" -ne 0 ]; then
  echo "FAIL: initial managed-auth-repair setup failed" >&2
  cat "$SCENARIO_OUTPUT" >&2
  exit 1
fi
printf '%s\n' 'auth-user-pass-verify /etc/openvpn/verify-router-pass.sh via-env' > \
  "${repair_root}/etc/openvpn/server/ochola-router-backup.conf"
printf '%s\n' '# stale helper' > "${repair_root}/etc/openvpn/verify-router-backup-pass.sh"
run_scenario managed-auth-repair "$repair_root"
if [ "$SCENARIO_STATUS" -ne 0 ]; then
  echo "FAIL: managed authentication repair failed" >&2
  cat "$SCENARIO_OUTPUT" >&2
  exit 1
fi
assert_contains "${repair_root}/etc/openvpn/server/ochola-router-backup.conf" "auth-user-pass-verify ${repair_root}/etc/openvpn/verify-router-backup-pass.sh via-env"
assert_contains "${repair_root}/etc/openvpn/verify-router-backup-pass.sh" "PASSFILE=\"${repair_root}/etc/openvpn/router-backup-passwd\""
assert_not_contains "$SCENARIO_LOG" "systemctl <stop> <openvpn@ochola-router-backup>"
assert_not_contains "$SCENARIO_LOG" "systemctl <restart> <openvpn@ochola-router-backup>"
echo "PASS: managed auth directive and helper are repaired without disturbing legacy ownership"

wrong_address_root="$(prepare_root wrong-primary-address)"
run_scenario wrong-primary-address "$wrong_address_root"
if [ "$SCENARIO_STATUS" -eq 0 ]; then
  echo "FAIL: wrong management address unexpectedly succeeded" >&2
  cat "$SCENARIO_OUTPUT" >&2
  exit 1
fi
assert_contains "$SCENARIO_OUTPUT" "The management tunnel is not ready"
assert_contains "$SCENARIO_LOG" "ip <-4> <addr> <show> <dev> <tun-router>"
assert_contains "$SCENARIO_LOG" "ss <-H> <-lnt>"
echo "PASS: wrong management address fails tunnel readiness"

missing_listener_root="$(prepare_root missing-primary-listener)"
run_scenario missing-primary-listener "$missing_listener_root"
if [ "$SCENARIO_STATUS" -eq 0 ]; then
  echo "FAIL: missing TCP listener unexpectedly succeeded" >&2
  cat "$SCENARIO_OUTPUT" >&2
  exit 1
fi
assert_contains "$SCENARIO_OUTPUT" "The management tunnel is not ready"
assert_contains "$SCENARIO_LOG" "ip <-4> <addr> <show> <dev> <tun-router>"
assert_contains "$SCENARIO_LOG" "ss <-H> <-lnt>"
echo "PASS: missing TCP listener fails tunnel readiness"

unchanged_root="$(prepare_root modern-unchanged)"
run_scenario modern-unchanged "$unchanged_root"
if [ "$SCENARIO_STATUS" -ne 0 ]; then
  echo "FAIL: initial modern unchanged setup failed" >&2
  cat "$SCENARIO_OUTPUT" >&2
  exit 1
fi
rm -f \
  "${unchanged_root}/var/lib/openvpn/ochola-router-management/ochola-router.sha256" \
  "${unchanged_root}/var/lib/openvpn/ochola-router-management/ochola-router-backup.sha256"
run_scenario modern-unchanged "$unchanged_root"
if [ "$SCENARIO_STATUS" -ne 0 ]; then
  echo "FAIL: unchanged modern deployment failed" >&2
  cat "$SCENARIO_OUTPUT" >&2
  exit 1
fi
assert_contains "$SCENARIO_OUTPUT" "Adopting healthy openvpn-server@ochola-router;"
assert_contains "$SCENARIO_OUTPUT" "Adopting healthy openvpn-server@ochola-router-backup;"
assert_not_contains "$SCENARIO_LOG" "systemctl <restart> <openvpn-server@ochola-router>"
assert_not_contains "$SCENARIO_LOG" "systemctl <restart> <openvpn-server@ochola-router-backup>"
echo "PASS: healthy modern units are preserved on unchanged deployments"

config_update_root="$(prepare_root modern-config-update)"
run_scenario modern-config-update "$config_update_root"
if [ "$SCENARIO_STATUS" -ne 0 ]; then
  echo "FAIL: initial config-update setup failed" >&2
  cat "$SCENARIO_OUTPUT" >&2
  exit 1
fi
old_cert_dir="${config_update_root}/etc/letsencrypt/live/isplatty.org-wildcard"
new_cert_dir="${config_update_root}/etc/letsencrypt/live/isplatty.org-required-hosts"
mkdir -p "$new_cert_dir"
cp "$old_cert_dir/fullchain.pem" "$new_cert_dir/fullchain.pem"
cp "$old_cert_dir/privkey.pem" "$new_cert_dir/privkey.pem"
cp "$old_cert_dir/chain.pem" "$new_cert_dir/chain.pem"
rm -rf "$old_cert_dir"
run_scenario modern-config-update "$config_update_root"
if [ "$SCENARIO_STATUS" -ne 0 ]; then
  echo "FAIL: config update did not restart and verify modern units" >&2
  cat "$SCENARIO_OUTPUT" >&2
  exit 1
fi
assert_contains "$SCENARIO_LOG" "systemctl <restart> <openvpn-server@ochola-router>"
assert_contains "$SCENARIO_LOG" "systemctl <restart> <openvpn-server@ochola-router-backup>"
assert_contains "${config_update_root}/etc/openvpn/server/ochola-router.conf" "$new_cert_dir/fullchain.pem"
echo "PASS: changed modern config paths are applied by restarting both units"

cert_update_root="$(prepare_root modern-cert-update)"
run_scenario modern-cert-update "$cert_update_root"
if [ "$SCENARIO_STATUS" -ne 0 ]; then
  echo "FAIL: initial certificate-update setup failed" >&2
  cat "$SCENARIO_OUTPUT" >&2
  exit 1
fi
printf 'renewed certificate\n' > "${cert_update_root}/etc/letsencrypt/live/isplatty.org-wildcard/fullchain.pem"
printf 'renewed private key\n' > "${cert_update_root}/etc/letsencrypt/live/isplatty.org-wildcard/privkey.pem"
printf 'renewed chain\n' > "${cert_update_root}/etc/letsencrypt/live/isplatty.org-wildcard/chain.pem"
run_scenario modern-cert-update "$cert_update_root"
if [ "$SCENARIO_STATUS" -ne 0 ]; then
  echo "FAIL: certificate update did not restart and verify modern units" >&2
  cat "$SCENARIO_OUTPUT" >&2
  exit 1
fi
assert_contains "$SCENARIO_LOG" "systemctl <restart> <openvpn-server@ochola-router>"
assert_contains "$SCENARIO_LOG" "systemctl <restart> <openvpn-server@ochola-router-backup>"
echo "PASS: renewed certificate material is applied by restarting both units"

echo "All router-management VPN bootstrap tests passed."
