#!/bin/bash
##############################################################
# OcholaSupernet — First-Time VPS Setup
# Run this ONCE on a fresh VPS:
#   bash <(curl -fsSL https://raw.githubusercontent.com/ocholasupernet-debug/BIL/main/deploy/vps-init.sh)
##############################################################
set -e

REPO="https://github.com/ocholasupernet-debug/BIL.git"
APP_DIR="/var/www/ocholasupernet"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   OcholaSupernet — VPS Initialisation        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. System packages ────────────────────────────────────
echo "[1/7] Installing system dependencies..."
sudo apt-get update -qq
sudo apt-get install -y -qq git curl ufw

# ── 2. Node.js 20 ─────────────────────────────────────────
echo "[2/7] Installing Node.js 20..."
if ! command -v node &>/dev/null || [[ "$(node -v)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - -qq
  sudo apt-get install -y -qq nodejs
fi
echo "    Node: $(node -v)  |  npm: $(npm -v)"

# ── 3. pnpm & PM2 ─────────────────────────────────────────
echo "[3/7] Installing pnpm and PM2..."
npm install -g pnpm pm2 --silent
echo "    pnpm: $(pnpm -v)  |  PM2: $(pm2 -v)"

# ── 4. Clone repository ───────────────────────────────────
echo "[4/7] Cloning repository..."
sudo mkdir -p "$(dirname "$APP_DIR")"
sudo chown "$USER":"$USER" "$(dirname "$APP_DIR")"

if [ -d "$APP_DIR/.git" ]; then
  echo "    Repo already exists — pulling latest..."
  cd "$APP_DIR"
  git pull origin main
else
  git clone "$REPO" "$APP_DIR"
  cd "$APP_DIR"
fi

# ── 5. Install dependencies ───────────────────────────────
echo "[5/7] Installing Node dependencies..."
pnpm install --frozen-lockfile

# ── 6. Build ──────────────────────────────────────────────
echo "[6/7] Building frontend and API..."

cd artifacts/ochola-supernet
BASE_PATH="/" pnpm run build:vps
cd ../..

cd artifacts/api-server
pnpm run build
cd ../..

mkdir -p logs

# ── 7. Start with PM2 ─────────────────────────────────────
echo "[7/7] Starting app with PM2..."
if pm2 list | grep -q "ocholanet-api"; then
  pm2 reload ecosystem.config.cjs --env standalone
else
  pm2 start ecosystem.config.cjs --env standalone
  pm2 save
fi

# Enable PM2 on reboot
pm2 startup | tail -1 | sudo bash || true

# ── Open firewall port ────────────────────────────────────
echo "Opening port 8080 in firewall..."
sudo ufw allow 8080/tcp || true
sudo ufw --force enable || true

# ── Done ──────────────────────────────────────────────────
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || echo "YOUR_VPS_IP")

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   ✅  Setup complete!                         ║"
echo "╠══════════════════════════════════════════════╣"
echo "║                                              ║"
echo "║   App URL:  http://$PUBLIC_IP:8080"
echo "║                                              ║"
echo "║   Useful commands:                           ║"
echo "║     pm2 logs ocholanet-api   (live logs)     ║"
echo "║     pm2 list                 (status)        ║"
echo "║     pm2 restart ocholanet-api                ║"
echo "║                                              ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
