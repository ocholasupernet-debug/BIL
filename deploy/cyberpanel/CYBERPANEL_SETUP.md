# OcholaSupernet — CyberPanel Deployment Guide
## Domain: isplatty.org

CyberPanel uses **OpenLiteSpeed (OLS)** as the web server.  
This guide walks through the complete first-time setup.

---

## Quick Fix — 403 Forbidden on isplatty.org

If you're already seeing 403, run this on your VPS:

```bash
cd /home/<cpuser>/isplatty.org

# Build the frontend
cd artifacts/ochola-supernet && pnpm run build:vps && cd ../..

# Copy built files into public_html/ (fixes 403 immediately)
rsync -a --delete artifacts/ochola-supernet/dist/public/ public_html/

# Verify index.html is now there
ls public_html/index.html
```

Then refresh your browser — the site should load.  
Replace `<cpuser>` with your actual CyberPanel Linux username.

---

## Prerequisites (run once on VPS)

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# pnpm
npm install -g pnpm

# PM2 (keeps Node.js running after reboot)
npm install -g pm2

# Verify
node -v    # v20.x.x
pnpm -v
pm2 -v
```

---

## Step 1 — Create the Website in CyberPanel

1. **CyberPanel → Websites → Create Website**
2. Fill in:
   - Domain: `isplatty.org`
   - Email: your email
   - PHP: **None** (Node.js app)
   - SSL: enable (recommended)
3. Click **Create Website**

CyberPanel creates: `/home/<cpuser>/isplatty.org/public_html/`

---

## Step 2 — Clone the Repository

```bash
cd /home/<cpuser>/isplatty.org/

# Clone the repo into this folder
git clone https://github.com/ocholasupernet-debug/BIL.git .
```

---

## Step 3 — First Build & Deploy

```bash
cd /home/<cpuser>/isplatty.org/

# Install dependencies
pnpm install --frozen-lockfile

# Build frontend + API + copy to public_html in one command
bash deploy/cyberpanel/deploy.sh
```

The deploy script:
1. Installs dependencies
2. Builds the React frontend
3. Builds the Node.js API server
4. **Copies the built frontend into `public_html/`** (this fixes 403)
5. Starts/reloads the API via PM2

---

## Step 4 — Set Up the API Proxy in CyberPanel

The API runs on port 8080 (PM2). You need OLS to proxy `/api/` to it.

### Easiest — CyberPanel Node.js Apps

1. **CyberPanel → Node.js Apps → Create Application**
2. Fill in:
   - **App Root**: `/home/<cpuser>/isplatty.org/`
   - **App URL**: `/api/`
   - **Startup File**: `artifacts/api-server/dist/index.mjs`
   - **Environment**: `NODE_ENV=production PORT=8080`
3. Click **Create** — OLS proxy is configured automatically.

### Alternative — Manual vHost Config

Edit the OLS config directly:

```bash
sudo nano /usr/local/lsws/conf/vhosts/isplatty.org/vhost.conf
```

Paste the contents of `deploy/cyberpanel/ols-proxy.conf` into the file, then:

```bash
sudo /usr/local/lsws/bin/lswsctrl restart
```

---

## Step 5 — Enable PM2 on Reboot

```bash
pm2 startup
# Copy & run the command it prints, e.g.:
# sudo env PATH=... pm2 startup systemd -u <cpuser> --hp /home/<cpuser>

pm2 save
```

---

## Step 6 — SSL (HTTPS)

CyberPanel handles Let's Encrypt automatically:

1. **CyberPanel → SSL → Issue SSL** → select `isplatty.org`
2. Done — HTTPS is live.

For wildcard SSL (covers `*.isplatty.org` subdomains for per-ISP scripts):

```bash
sudo certbot certonly --manual --preferred-challenges dns \
  -d isplatty.org -d "*.isplatty.org"
```

---

## Updating After a Code Push

```bash
cd /home/<cpuser>/isplatty.org/
bash deploy/cyberpanel/deploy.sh
```

Or set up **CyberPanel Git Manager** for auto-deploy on every GitHub push:

1. CyberPanel → Git Manager → Create Git
2. Git URL: `https://github.com/ocholasupernet-debug/BIL.git`
3. Branch: `main`
4. Deploy Path: `/home/<cpuser>/isplatty.org/`
5. **Script to Execute**: `bash deploy/cyberpanel/deploy.sh`
6. Copy the webhook URL → add it in GitHub → Settings → Webhooks

---

## Useful Commands

```bash
pm2 list                    # show running processes
pm2 logs ocholanet-api      # live API logs
pm2 restart ocholanet-api   # restart API
pm2 monit                   # CPU/memory dashboard
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| **403 Forbidden** | Run `rsync -a --delete artifacts/ochola-supernet/dist/public/ public_html/` |
| **404 on page refresh** | Check SPA rewrite rule is applied in OLS (ols-proxy.conf) |
| **API `/api/` not working** | Check `pm2 list` — is `ocholanet-api` running? Check port 8080 |
| **Blank white page** | Open browser DevTools → Console for JS errors |
| **`pnpm` not found** | `npm install -g pnpm` |
| **Port 8080 blocked** | `sudo ufw allow 8080` (only if not using OLS proxy) |
