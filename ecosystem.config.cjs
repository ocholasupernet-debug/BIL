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
        PORT: "8080",
        SERVE_STATIC: "true",
        VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || "",
        VITE_SUPABASE_KEY: process.env.VITE_SUPABASE_KEY || "",
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
