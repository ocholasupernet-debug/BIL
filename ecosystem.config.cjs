const fs = require("fs");
const path = require("path");

/* PM2 evaluates ecosystem files inside its daemon context, which may not
   inherit the shell that sourced the deployment .env. Load the file before
   constructing env_standalone so a reload cannot replace required settings
   with empty strings. Existing process variables remain authoritative. */
function loadDeploymentEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key] = match;
    let value = match[2];
    if (
      value.length >= 2 &&
      ((value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]?.trim()) process.env[key] = value;
  }
}

loadDeploymentEnv(path.join(__dirname, ".env"));

/**
 * PM2 Ecosystem Config — OcholaSupernet
 *
 * Usage (from project root):
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 save          (persist across reboots)
 *   pm2 startup       (generate systemd/init script)
 *
 * Two deployment modes:
 *   1. With nginx    → nginx handles static files, PM2 only runs the API
 *   2. Without nginx → set SERVE_STATIC=true, API serves everything on one port
 */

module.exports = {
  apps: [
    {
      name: "ocholanet-api",
      script: "./artifacts/api-server/dist/index.mjs",
      cwd: "./",
      instances: 1,
      exec_mode: "fork",

      // ── Mode 1: With nginx (recommended for production) ──────────────
      // nginx serves static files, API only handles /api/* routes
      env_production: {
        NODE_ENV: "production",
        PORT: "8080",
        SERVE_STATIC: "false",
      },

      // ── Mode 2: Without nginx (simple single-port setup) ─────────────
      // API serves BOTH the frontend (/) and the API (/api)
      // App accessible at http://YOUR_VPS_IP:8080
      env_standalone: {
        NODE_ENV: "production",
        PORT: process.env.APP_PORT || "8080",
        SERVE_STATIC: "true",
        VITE_SUPABASE_URL:    process.env.VITE_SUPABASE_URL || "",
        VITE_SUPABASE_KEY:    process.env.VITE_SUPABASE_KEY || "",
        SUPABASE_URL:         process.env.SUPABASE_URL || "",
         SESSION_SECRET:       process.env.SESSION_SECRET || "",
         ROUTER_OPENVPN_ENDPOINT: process.env.ROUTER_OPENVPN_ENDPOINT || "vpn.isplatty.org",
         VPS_HOST:             process.env.VPS_HOST || "vpn.isplatty.org",
         VPS_USER:             process.env.VPS_USER || "",
         VPS_DEPLOYMENT_KEY:   process.env.VPS_DEPLOYMENT_KEY || "",
         VPS_DEPLOYMENT_KEY_V2: process.env.VPS_DEPLOYMENT_KEY_V2 || "",
         VPS_DEPLOYMENT_KEY_V3: process.env.VPS_DEPLOYMENT_KEY_V3 || "",
         VPS_SSH_KEY:          process.env.VPS_SSH_KEY || "",
         VPS_SSH_PASSPHRASE:   process.env.VPS_SSH_PASSPHRASE || "",
          VPS_SSH_PASSPHRASE_B64: process.env.VPS_SSH_PASSPHRASE_B64 || "",
        /* Pass service-role key under the canonical name the API uses.
            Accepts the legacy name only for older .env files. */
         ...(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
          ? {
              SUPABASE_SERVICE_ROLE_KEY:
                 process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
            }
          : {}),
      },

      error_file: "./logs/api-error.log",
      out_file: "./logs/api-out.log",
      log_file: "./logs/api-combined.log",
      time: true,
      max_memory_restart: "512M",
      restart_delay: 3000,
      max_restarts: 10,
    },
  ],
};
