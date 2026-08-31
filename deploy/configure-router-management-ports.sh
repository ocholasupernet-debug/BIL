#!/usr/bin/env bash
set -euo pipefail

# Router profiles use a stable port derived from the router id:
#   public port = 11960 + ((router id - 1) % 1000)
# The OpenVPN management server itself remains on TCP 1196.
PORT_START="${ROUTER_OPENVPN_PUBLIC_PORT_START:-11960}"
PORT_END="${ROUTER_OPENVPN_PUBLIC_PORT_END:-12959}"
LISTENER_PORT="${ROUTER_OPENVPN_LISTENER_PORT:-1196}"

sudo iptables -t nat -C PREROUTING -p tcp --dport "${PORT_START}:${PORT_END}" \
  -j REDIRECT --to-ports "$LISTENER_PORT" 2>/dev/null ||
  sudo iptables -t nat -A PREROUTING -p tcp --dport "${PORT_START}:${PORT_END}" \
    -j REDIRECT --to-ports "$LISTENER_PORT"

sudo iptables -C INPUT -p tcp --dport "${PORT_START}:${PORT_END}" -j ACCEPT 2>/dev/null ||
  sudo iptables -I INPUT -p tcp --dport "${PORT_START}:${PORT_END}" -j ACCEPT

sudo ufw allow "${PORT_START}:${PORT_END}/tcp" >/dev/null 2>&1 || true

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