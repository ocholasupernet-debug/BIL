# IP-only deployment on CyberPanel

Use this path when the VPS is reachable by IP but no domain is available yet.
The app runs as one PM2 process with the frontend and API on the same origin:

```text
http://102.203.116.204:8080
```

## 1. Prepare the VPS

On the VPS, install Node.js 20+, pnpm, Git, and PM2. Then clone the project:

```bash
git clone <your-repository-url> ocholasupernet
cd ocholasupernet
cp .env.example .env
nano .env
```

Set at minimum:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SESSION_SECRET`
- `SUPERADMIN_PASSWORD`

Keep `.env` private and do not commit it.

## 2. Deploy the combined app

```bash
PUBLIC_IP=102.203.116.204 bash deploy/cyberpanel/deploy-ip.sh
```

The script builds both artifacts and starts `ocholanet-api` using the
`standalone` PM2 environment. That environment sets `SERVE_STATIC=true`, so
the API serves the React build and `/api/*` from port 8080.

## 3. Open the VPS port

Allow TCP 8080 in CyberPanel/CSF and the VPS provider firewall. Verify locally
on the VPS:

```bash
curl http://127.0.0.1:8080/api/health
pm2 status ocholanet-api
```

Then open `http://102.203.116.204:8080` in a browser.

## Important IP-only limitations

- An IP address cannot provide an `api.` subdomain.
- HTTP on an IP is not suitable for production credentials or M-Pesa callbacks.
- Router self-install scripts that require HTTPS should be used after attaching a
  real domain and TLS certificate.
- When a domain is available, use `deploy/cyberpanel/deploy.sh` with the
  domain-based CyberPanel setup instead of this IP-only script.