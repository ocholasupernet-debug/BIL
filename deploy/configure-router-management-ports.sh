#!/usr/bin/env bash
set -euo pipefail

# Router profiles use a stable port derived from the router id:
#   public port = 11960 + ((router id - 1) % 1000)
# The OpenVPN management server itself remains on TCP 1196.
PORT_START="${ROUTER_OPENVPN_PUBLIC_PORT_START:-11960}"
PORT_END="${ROUTER_OPENVPN_PUBLIC_PORT_END:-12959}"
LISTENER_PORT="${ROUTER_OPENVPN_LISTENER_PORT:-1196}"
BACKUP_LISTENER_PORT="${ROUTER_OPENVPN_BACKUP_PORT:-1197}"
resolve_ufw() {
  UFW_BIN="$(command -v ufw 2>/dev/null || true)"
  if [ -z "$UFW_BIN" ]; then
    for candidate in /usr/sbin/ufw /usr/bin/ufw /sbin/ufw /bin/ufw; do
      if [ -x "$candidate" ]; then
        UFW_BIN="$candidate"
        break
      fi
    done
  fi
  if [ -z "$UFW_BIN" ]; then
    UFW_BIN="$(sudo sh -c 'command -v ufw' 2>/dev/null || true)"
  fi
}

resolve_ufw

prepare_ufw_ipv6() {
  local ip6tables_bin
  if ! ip -6 route show default 2>/dev/null | grep -q .; then
    if [ -f /etc/default/ufw ]; then
      sudo sed -i -E 's/^IPV6=.*/IPV6=no/' /etc/default/ufw
      grep -q '^IPV6=' /etc/default/ufw ||
        echo 'IPV6=no' | sudo tee -a /etc/default/ufw >/dev/null
    fi
    return
  fi

  ip6tables_bin="$(command -v ip6tables 2>/dev/null || true)"
  if [ -n "$ip6tables_bin" ] && "$ip6tables_bin" -S >/dev/null 2>&1; then
    return
  fi

  if ip -6 route show default 2>/dev/null | grep -q .; then
    echo "ERROR: IPv6 has a default route but ip6tables is unavailable." >&2
    exit 1
  fi

  echo "ERROR: IPv6 has a default route but ip6tables is unavailable." >&2
  exit 1
}

prepare_ufw_ipv6

sudo iptables -t nat -C PREROUTING -p tcp --dport "${PORT_START}:${PORT_END}" \
  -j REDIRECT --to-ports "$LISTENER_PORT" 2>/dev/null ||
  sudo iptables -t nat -A PREROUTING -p tcp --dport "${PORT_START}:${PORT_END}" \
    -j REDIRECT --to-ports "$LISTENER_PORT"

sudo iptables -C INPUT -p tcp --dport "${PORT_START}:${PORT_END}" -j ACCEPT 2>/dev/null ||
  sudo iptables -I INPUT -p tcp --dport "${PORT_START}:${PORT_END}" -j ACCEPT

if [ -z "$UFW_BIN" ]; then
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "ERROR: UFW is unavailable and this VPS has no apt-get package manager." >&2
    exit 1
  fi
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ufw
  resolve_ufw
fi

if [ -z "$UFW_BIN" ] ||
   ! sudo "$UFW_BIN" allow 22/tcp >/dev/null 2>&1 ||
   ! sudo "$UFW_BIN" allow 80/tcp >/dev/null 2>&1 ||
   ! sudo "$UFW_BIN" allow 443/tcp >/dev/null 2>&1 ||
   ! sudo "$UFW_BIN" allow "${LISTENER_PORT}/tcp" >/dev/null 2>&1 ||
   ! sudo "$UFW_BIN" allow "${BACKUP_LISTENER_PORT}/tcp" >/dev/null 2>&1 ||
   ! sudo "$UFW_BIN" allow "${PORT_START}:${PORT_END}/tcp" >/dev/null 2>&1 ||
   ! sudo "$UFW_BIN" --force enable >/dev/null 2>&1
then
  echo "ERROR: Could not activate UFW with the required management rules." >&2
  exit 1
fi

# UFW may reload/replace the filter tables when it is enabled. Reapply the
# isolated router-management forwarding rules after that reload so the
# verification gate and the live tunnels see the same policy. These rules are
# deliberately limited to the two dedicated management interfaces/subnets.
for interface in tun-router tun-router-bkp; do
  sudo iptables -C FORWARD -i "$interface" -j ACCEPT 2>/dev/null ||
    sudo iptables -I FORWARD -i "$interface" -j ACCEPT
  sudo iptables -C FORWARD -o "$interface" -j ACCEPT 2>/dev/null ||
    sudo iptables -I FORWARD -o "$interface" -j ACCEPT
done
for network in 10.8.5.0/24 10.8.6.0/24; do
  sudo iptables -t nat -C POSTROUTING -s "$network" -j MASQUERADE 2>/dev/null ||
    sudo iptables -t nat -A POSTROUTING -s "$network" -j MASQUERADE
done

if ! sudo iptables -C INPUT -p tcp --dport "${PORT_START}:${PORT_END}" -j ACCEPT 2>/dev/null; then
  echo "ERROR: Could not install the router-management INPUT rule." >&2
  exit 1
fi
if command -v iptables-save >/dev/null 2>&1 && [ -d /etc/iptables ]; then
  sudo iptables-save | sudo tee /etc/iptables/rules.v4 >/dev/null
fi
sudo tee /etc/systemd/system/ochola-router-vpn-ports.service >/dev/null <<EOF
[Unit]
Description=Ochola per-router management VPN port forwarding
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c '/usr/sbin/iptables -t nat -C PREROUTING -p tcp --dport ${PORT_START}:${PORT_END} -j REDIRECT --to-ports ${LISTENER_PORT} 2>/dev/null || /usr/sbin/iptables -t nat -A PREROUTING -p tcp --dport ${PORT_START}:${PORT_END} -j REDIRECT --to-ports ${LISTENER_PORT}'
ExecStart=/bin/sh -c '/usr/sbin/iptables -C INPUT -p tcp --dport ${PORT_START}:${PORT_END} -j ACCEPT 2>/dev/null || /usr/sbin/iptables -I INPUT -p tcp --dport ${PORT_START}:${PORT_END} -j ACCEPT'

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now ochola-router-vpn-ports.service
echo "Forwarding TCP ${PORT_START}-${PORT_END} to OpenVPN TCP ${LISTENER_PORT}."