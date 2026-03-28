#!/bin/bash
##############################################################
# OcholaSupernet — OpenLiteSpeed API Proxy Setup
# Run once on VPS: bash deploy/setup-ols-proxy.sh
# Adds /api/ → PM2 (port 8080) proxy to the OLS vhost config
##############################################################
set -e

VHOST_DIR="/usr/local/lsws/conf/vhosts/isplatty.org"
VHOST_CONF="$VHOST_DIR/vhost.conf"

echo "══════════════════════════════════════════"
echo "  OcholaSupernet — OLS Proxy Setup"
echo "══════════════════════════════════════════"

# ── 1. Find vhost config ───────────────────────────────────
if [ ! -f "$VHOST_CONF" ]; then
  # Try alternate locations
  VHOST_CONF=$(find /usr/local/lsws/conf/vhosts -name "vhost.conf" 2>/dev/null | head -1)
fi

if [ ! -f "$VHOST_CONF" ]; then
  echo "❌ vhost.conf not found. Trying CyberPanel path..."
  VHOST_CONF=$(find /usr/local/lsws -name "*.conf" 2>/dev/null | xargs grep -l "isplatty.org" 2>/dev/null | head -1)
fi

if [ ! -f "$VHOST_CONF" ]; then
  echo "❌ Could not find OLS vhost config. Try manual setup:"
  echo "   sudo nano /usr/local/lsws/conf/vhosts/isplatty.org/vhost.conf"
  exit 1
fi

echo "  Config: $VHOST_CONF"

# ── 2. Backup existing config ─────────────────────────────
cp "$VHOST_CONF" "${VHOST_CONF}.bak.$(date +%Y%m%d_%H%M%S)"
echo "  ✓ Backup created"

# ── 3. Check if proxy already configured ──────────────────
if grep -q "node_api" "$VHOST_CONF" 2>/dev/null; then
  echo "  ✓ API proxy already exists in vhost.conf — skipping"
else
  echo "  Adding API proxy config..."
  cat >> "$VHOST_CONF" << 'PROXY_CONF'

# ── OcholaSupernet API Proxy ──────────────────────────────
extProcessor node_api {
  type                    proxy
  address                 127.0.0.1:8080
  maxConns                100
  initTimeout             60
  retryTimeout            0
  respBuffer              0
}

context /api/ {
  type                    proxy
  handler                 node_api
  addDefaultCharset       off
}
PROXY_CONF
  echo "  ✓ API proxy config added"
fi

# ── 4. Fix the SPA rewrite to exclude /api/ ───────────────
# Check for .htaccess in public_html
PUBLIC_HTML=""
if   [ -d "/home/isplatty.org/public_html" ];  then PUBLIC_HTML="/home/isplatty.org/public_html"
elif [ -d "/home/ocholasupernet/public_html" ]; then PUBLIC_HTML="/home/ocholasupernet/public_html"
else
  PUBLIC_HTML=$(find /home -maxdepth 3 -name "public_html" -type d 2>/dev/null | head -1)
fi

if [ -n "$PUBLIC_HTML" ]; then
  cat > "$PUBLIC_HTML/.htaccess" << 'HTACCESS'
RewriteEngine On

# Don't rewrite /api/ — let LiteSpeed proxy handle it
RewriteCond %{REQUEST_URI} ^/api/ [NC]
RewriteRule ^ - [L]

# SPA fallback — non-file, non-dir requests → index.html
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ /index.html [L]
HTACCESS
  echo "  ✓ .htaccess updated at $PUBLIC_HTML"
fi

# ── 5. Restart OLS ────────────────────────────────────────
echo "  Restarting OpenLiteSpeed..."
if command -v lswsctrl &>/dev/null; then
  lswsctrl restart
elif [ -f /usr/local/lsws/bin/lswsctrl ]; then
  /usr/local/lsws/bin/lswsctrl restart
else
  echo "  ⚠ Could not find lswsctrl — restart OLS manually in CyberPanel"
fi

echo ""
echo "══════════════════════════════════════════"
echo "  ✓ Done! API proxy is now active."
echo "  /api/* → PM2 on port 8080"
echo "  /      → Static files from public_html/"
echo "══════════════════════════════════════════"
echo ""
echo "  If the site is still blank, run:"
echo "  pm2 reload ecosystem.config.cjs --env production"
echo ""
