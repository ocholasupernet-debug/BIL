# OcholaSupernet — CyberPanel VPS Deployment Guide

CyberPanel uses **OpenLiteSpeed (OLS)** as the web server and has built-in
Git deployment and Node.js app management. This guide covers the full setup.

---

## Prerequisites on your VPS (run once)

SSH into your VPS and install the required tools:

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# pnpm (fast package manager)
npm install -g pnpm

# PM2 (process manager — keeps Node.js running after reboot)
npm install -g pm2

# Verify
node -v   # should print v20.x.x
pnpm -v
pm2 -v
```

---

## Step 1 — Create a Website in CyberPanel

1. Log in to **CyberPanel** → **Websites** → **Create Website**
2. Fill in:
   - **Domain**: `app.yourdomain.com` (or your domain)
   - **Email**: your email
   - **PHP**: select "None" (this is a Node.js app, not PHP)
   - **SSL**: enable if you want HTTPS (recommended)
3. Click **Create Website**

CyberPanel creates the directory `/home/<cpuser>/app.yourdomain.com/public_html/`

---

## Step 2 — Clone the Repository

SSH into your VPS:

```bash
# Navigate to your domain's folder
cd /home/<cpuser>/app.yourdomain.com/

# Clone your GitHub repo INTO the current folder
git clone https://github.com/YOUR_USERNAME/ocholasupernet.git .

# The project is now at:
# /home/<cpuser>/app.yourdomain.com/
```

> Replace `YOUR_USERNAME/ocholasupernet` with your actual GitHub repo.

---

## Step 3 — Configure Environment Variables

```bash
cp .env.example .env
nano .env
```

Edit the values:

```env
PORT=8080
DATABASE_URL=postgresql://user:password@localhost:5432/ocholasupernet
NODE_ENV=production
BASE_PATH=/
```

---

## Step 4 — First Build & Start

```bash
# Install all dependencies
pnpm install --frozen-lockfile

# Build the React frontend (VPS mode — no Replit plugins)
cd artifacts/ochola-supernet
pnpm run build:vps
cd ../..

# Build the Express API server
cd artifacts/api-server
pnpm run build
cd ../..

# Create logs directory
mkdir -p logs

# Start the API with PM2
pm2 start ecosystem.config.cjs --env production
pm2 save

# Enable PM2 startup on reboot
pm2 startup
# ↑ Copy & run the command it prints (e.g. sudo env PATH=... pm2 startup)
```

---

## Step 5 — Set Up the Node.js Proxy in CyberPanel

CyberPanel can configure OLS to proxy `/api/` to your PM2 process automatically:

### Option A — CyberPanel Node.js Apps (easiest)

1. In CyberPanel → **Node.js Apps** → **Create Application**
2. Fill in:
   - **App Name**: `ocholanet-api`
   - **App Domain**: your domain
   - **App Root**: `/home/<cpuser>/app.yourdomain.com/`
   - **App URL**: `/api`
   - **App Startup File**: `artifacts/api-server/dist/index.mjs`
   - **Environment**: `NODE_ENV=production PORT=8080`
3. Click **Create** — CyberPanel creates the OLS reverse proxy automatically.

### Option B — Manual OLS Config

See `deploy/cyberpanel/ols-proxy.conf` for the exact blocks to paste into
**CyberPanel → vHost Conf** (OLS WebAdmin Console → Virtual Hosts → your domain).

---

## Step 6 — Point OLS Document Root to the React Build

1. In CyberPanel → **Websites** → Manage your domain → **vHost Conf**
2. In OLS WebAdmin, go to **Virtual Hosts** → your domain → **General**
3. Change **Document Root** to:
   ```
   /home/<cpuser>/app.yourdomain.com/artifacts/ochola-supernet/dist/public
   ```
4. Add the SPA rewrite rule (so React client-side routing works):
   ```
   RewriteEngine On
   RewriteCond %{REQUEST_FILENAME} !-f
   RewriteCond %{REQUEST_FILENAME} !-d
   RewriteRule ^ /index.html [L]
   ```
5. **Save** → **Graceful Restart** OLS.

---

## Step 7 — Set Up CyberPanel Git Auto-Deploy

Every time you push to GitHub, CyberPanel can automatically pull and redeploy:

1. In CyberPanel → **Git Manager** → **Create Git**
2. Fill in:
   - **Website**: your domain
   - **Git URL**: `https://github.com/YOUR_USERNAME/ocholasupernet.git`
   - **Branch**: `main`
   - **Deploy Path**: `/home/<cpuser>/app.yourdomain.com/`
   - **Script to Execute**: `bash deploy/cyberpanel/deploy.sh`
3. Click **Create**
4. Copy the **Webhook URL** CyberPanel gives you
5. In GitHub → your repo → **Settings** → **Webhooks** → **Add webhook**
   - Payload URL: paste the CyberPanel webhook URL
   - Content type: `application/json`
   - Event: **Just the push event**
   - Click **Add webhook**

Now every `git push` triggers an auto-deploy on your VPS.

---

## Updating Manually

SSH in and run:

```bash
cd /home/<cpuser>/app.yourdomain.com/
bash deploy/cyberpanel/deploy.sh
```

---

## SSL / HTTPS

CyberPanel handles SSL via Let's Encrypt:

1. CyberPanel → **SSL** → **Issue SSL** → select your domain
2. CyberPanel installs the cert and configures OLS automatically.
3. Done — HTTPS works.

---

## Useful PM2 Commands

```bash
pm2 list                      # show running apps
pm2 logs ocholanet-api        # live logs
pm2 restart ocholanet-api     # restart
pm2 stop ocholanet-api        # stop
pm2 monit                     # real-time CPU/memory dashboard
```

---

## Directory Layout on VPS

```
/home/<cpuser>/app.yourdomain.com/
├── artifacts/
│   ├── ochola-supernet/
│   │   ├── dist/public/       ← React build (served by OLS)
│   │   └── src/               ← source (not served)
│   └── api-server/
│       └── dist/index.mjs     ← Express API (run by PM2)
├── deploy/
│   ├── cyberpanel/
│   │   ├── CYBERPANEL_SETUP.md
│   │   ├── deploy.sh          ← Git hook script
│   │   └── ols-proxy.conf     ← OLS proxy config snippet
│   ├── nginx.conf             ← (alternative if using nginx)
│   └── deploy.sh              ← generic deploy script
├── ecosystem.config.cjs       ← PM2 config
├── .env                       ← secrets (NOT in git)
├── .env.example               ← template (in git)
├── logs/
│   ├── api-out.log
│   └── api-error.log
└── package.json
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `pnpm: command not found` | `npm install -g pnpm` |
| API not responding on `/api/` | Check `pm2 list` — is `ocholanet-api` online? |
| React page shows blank | Check OLS doc root points to `dist/public/` |
| Routes give 404 on refresh | Add the SPA rewrite rule in OLS (Step 6) |
| Git pull fails | Check SSH key or use HTTPS token in the Git URL |
| Port 8080 blocked | `sudo ufw allow 8080` (only needed if NOT using OLS proxy) |
