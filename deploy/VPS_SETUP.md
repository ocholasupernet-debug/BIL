# OcholaSupernet — VPS Deployment Guide

## Prerequisites on your VPS

```bash
# Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# pnpm
npm install -g pnpm

# PM2 (process manager)
npm install -g pm2

# nginx (for production with reverse proxy)
sudo apt install -y nginx

# (Optional) certbot for HTTPS
sudo apt install -y certbot python3-certbot-nginx
```

---

## First-time Setup

```bash
# Clone the repo
git clone https://github.com/ocholasupernet-debug/BIL.git /var/www/ocholasupernet
cd /var/www/ocholasupernet

# Install dependencies
pnpm install

# Build the frontend (VPS build — no Replit plugins)
cd artifacts/ochola-supernet
pnpm run build:vps
cd ../..

# Build the API server
cd artifacts/api-server
pnpm run build
cd ../..

# Create logs directory
mkdir -p logs
```

---

## Option A — With nginx (Recommended)

nginx handles static files and proxies API calls. Better performance.

```bash
# Edit the nginx config
nano deploy/nginx.conf
# Replace YOUR_DOMAIN with your actual domain
# Replace PROJECT_PATH with /var/www/ocholasupernet

# Install the nginx config
sudo cp deploy/nginx.conf /etc/nginx/sites-available/ocholasupernet
sudo ln -s /etc/nginx/sites-available/ocholasupernet \
           /etc/nginx/sites-enabled/ocholasupernet
sudo nginx -t          # test config
sudo systemctl reload nginx

# Start API server with PM2 (nginx mode — SERVE_STATIC=false)
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup            # follow the printed command to enable on reboot
```

### HTTPS with Let's Encrypt

```bash
sudo certbot --nginx -d YOUR_DOMAIN -d www.YOUR_DOMAIN
```

---

## Option B — Without nginx (Simple single-port)

Everything served by the API on port 8080. Good for quick testing.

```bash
# Start with SERVE_STATIC=true
pm2 start ecosystem.config.cjs --env standalone
pm2 save

# Open port 8080 in your firewall
sudo ufw allow 8080
```

Access the app at `http://YOUR_VPS_IP:8080`

---

## Updating (after git push from Replit)

```bash
cd /var/www/ocholasupernet
bash deploy/deploy.sh
```

Or manually:

```bash
git pull origin main
pnpm install --frozen-lockfile

# Rebuild frontend
cd artifacts/ochola-supernet && pnpm run build:vps && cd ../..

# Rebuild API
cd artifacts/api-server && pnpm run build && cd ../..

# Reload PM2
pm2 reload ocholanet-api
```

---

## Useful PM2 Commands

```bash
pm2 list                  # show running apps
pm2 logs ocholanet-api    # tail live logs
pm2 restart ocholanet-api # restart the API
pm2 stop ocholanet-api    # stop the API
```

---

## Directory Structure on VPS

```
/var/www/ocholasupernet/
├── artifacts/
│   ├── ochola-supernet/
│   │   ├── dist/public/        ← built frontend (served by nginx or API)
│   │   └── src/                ← source (not served)
│   └── api-server/
│       └── dist/index.mjs      ← compiled API (run by PM2)
├── deploy/
│   ├── nginx.conf
│   └── deploy.sh
├── ecosystem.config.cjs
├── logs/
└── .env
```
