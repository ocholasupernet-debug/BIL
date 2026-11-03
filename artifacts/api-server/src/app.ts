import "./lib/routeros-reply-compat";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { resolveVlanHotspotPortalRequest } from "./lib/api-auth.js";
import { TENANT_BASE_DOMAINS } from "./lib/tenant-host.js";
import {
  resolveCanonicalAdminLoginRedirect,
  resolveLegacyAdminEntry,
} from "./lib/legacy-admin-entry.js";
import { sbSelectStrict } from "./lib/supabase-client.js";
import { injectHotspotHostConfig, isPlatformHostname, normalizeRequestHostname, resolveHotspotHostMapping, type HotspotHostMapping } from "./lib/hotspot-host-routing.js";

const app: Express = express();

// bil.isplatty.org is retired. Keep this guard before every API, script, and
// static route so shared wildcard HTTPS cannot accidentally revive the tenant.
app.use((req, res, next) => {
  const forwardedHost = String(req.headers["x-forwarded-host"] ?? "")
    .split(",")[0]
    .trim();
  const requestHost = (forwardedHost || req.get("host") || req.hostname || "")
    .split(":")[0]
    .toLowerCase();

  if (requestHost === "bil.isplatty.org") {
    res.status(410).type("text").send("This hostname has been retired.\n");
    return;
  }
  next();
});
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
/* Meta signs the exact incoming bytes, so capture this route before JSON parsing. */
app.use("/api/whatsapp/webhook", express.raw({ type: "application/json", limit: "1mb" }));
app.use(express.json({
  limit: "8mb",
  verify(req, _res, body) {
    (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(body);
  },
}));
app.use(express.urlencoded({ extended: true }));

// Customer portal domains must not be used to submit administrator credentials.
// Their public Hotspot endpoints remain available on the same hostname.
app.use((req, res, next) => {
  const host = req.get("host") ?? req.hostname ?? "";
  const isAdminAuthRequest = req.method === "POST" && (
    req.path === "/api/auth/admin/login"
    || req.path === "/api/super-admin/login"
    || req.path.startsWith("/api/auth/whatsapp/")
    || req.path.startsWith("/api/auth/sms/")
  );
  if (
    process.env.NODE_ENV === "production"
    && isAdminAuthRequest
    && !isPlatformHostname(host, TENANT_BASE_DOMAINS)
  ) {
    res.status(403).json({ ok: false, error: "Administrator sign-in is only available on BIL admin hostnames." });
    return;
  }
  next();
});

// Scope verification applies to API calls from the captive portal. The
// router-served HTML must load first so it can attach its embedded signed
// context token to those API calls.
app.use("/api", resolveVlanHotspotPortalRequest);

app.use("/api", router);

// Support the old PHP-style admin URL as a narrow redirect only. The tenant
// hostname is preserved, so the existing login flow continues resolving the
// correct ISP; custom Hotspot domains such as ocholasupernet.com are excluded.



// ── Static file serving for VPS ──────────────────────────────────────────────
// Production always serves the built SPA because nginx proxies both the web
// page and /api/* to this process. SERVE_STATIC remains available for local
// single-port VPS runs; the frontend must be built first with
// pnpm run build:vps in artifacts/ochola-supernet.
const shouldServeStatic =
  process.env.NODE_ENV === "production" || process.env.SERVE_STATIC === "true";
if (shouldServeStatic) {
  const moduleStaticDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../ochola-supernet/dist/public",
  );
  const workingDirectoryStaticDir = path.resolve(
    process.cwd(),
    "artifacts/ochola-supernet/dist/public",
  );
  const staticDirCandidates = [...new Set([
    moduleStaticDir,
    workingDirectoryStaticDir,
  ])];
  const staticDir =
    staticDirCandidates.find((candidate) => existsSync(candidate)) ??
    moduleStaticDir;

  if (existsSync(staticDir)) {
    const registerIndexPath = path.join(staticDir, "index.html");
    app.get("/admin/login", (req, res, next) => {
      const destination = resolveCanonicalAdminLoginRedirect(
        req.get("host") ?? req.hostname ?? "",
        req.originalUrl,
      );
      if (!destination) {
        next();
        return;
      }
      res.set("Cache-Control", "no-store").redirect(302, destination);
    });
    // Keep the tenant's PHP-style URL while serving the existing React login.
    app.get("/index.php", (req, res, next) => {
      const destination = resolveLegacyAdminEntry(
        req.get("host") ?? req.hostname ?? "",
        req.originalUrl,
      );
      if (!destination) {
        next();
        return;
      }
      res.set("Cache-Control", "no-store").sendFile(registerIndexPath);
    });
      const resolvePortalHost = async (host: string): Promise<HotspotHostMapping | null> => {
        const hostname = normalizeRequestHostname(host);
        if (!hostname || isPlatformHostname(hostname, TENANT_BASE_DOMAINS)) return null;
        const branding = await sbSelectStrict<{ admin_id: number; portal_hostname: string | null }>(
          "isp_hotspot_branding",
          `portal_hostname=eq.${encodeURIComponent(hostname)}&select=admin_id,portal_hostname&limit=2`,
        );
        if (branding.length !== 1) return null;
        const adminId = Number(branding[0].admin_id);
        if (!Number.isSafeInteger(adminId) || adminId < 1) return null;
        const admins = await sbSelectStrict<{
          id: number;
          subdomain: string | null;
          is_active: boolean;
          status: string;
        }>(
          "isp_admins",
          `id=eq.${adminId}&is_active=is.true&status=eq.active&select=id,subdomain,is_active,status&limit=1`,
        );
        return resolveHotspotHostMapping(hostname, admins.length === 1
          ? [{
              adminId: Number(branding[0].admin_id),
              portalHostname: branding[0].portal_hostname,
              subdomain: admins[0].subdomain,
              isActive: admins[0].is_active,
              status: admins[0].status,
            }]
          : []);
      };

      // A configured customer domain loads the hosted Hotspot portal at its
      // root. The bootstrap contains only the mapped tenant ID and same-origin
      // API base; the portal then loads that tenant's saved branding/layout.
      app.use(async (req, res, next) => {
        const isPortalEntry = req.method === "GET" && (
          req.path === "/"
          || req.path === "/index.php"
          || req.path.startsWith("/admin")
          || req.path.startsWith("/super-admin")
        );
        if (!isPortalEntry) {
          next();
          return;
        }
        const forwardedHost = String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim();
        const host = forwardedHost || req.get("host") || req.hostname || "";
        if (isPlatformHostname(host, TENANT_BASE_DOMAINS)) {
          next();
          return;
        }
        try {
          const mapping = await resolvePortalHost(host);
          if (!mapping) {
            next();
            return;
          }
          if (req.path !== "/") {
            res.redirect(302, "/");
            return;
          }
          const html = readFileSync(registerIndexPath, "utf8");
          res.set("Cache-Control", "no-store")
            .type("html")
            .send(injectHotspotHostConfig(html, host, mapping.adminId));
        } catch (error) {
          logger.error({ err: error }, "Custom Hotspot hostname lookup failed");
          res.status(503).type("text").send("Hotspot portal is temporarily unavailable.\n");
        }
      });
    app.use((req, res, next) => {
      const forwardedHost = String(req.headers["x-forwarded-host"] ?? "")
        .split(",")[0]
        .trim();
      const requestHost = (forwardedHost || req.get("host") || req.hostname || "")
        .split(":")[0]
        .toLowerCase();
      const isDocumentRequest = req.method === "GET"
        && !req.path.startsWith("/api/")
        && !req.path.startsWith("/assets/")
        && !/\.[a-z0-9]+$/i.test(req.path);
      if (requestHost !== "register.isplatty.org" || !isDocumentRequest) {
        next();
        return;
      }

      try {
        const html = readFileSync(registerIndexPath, "utf8")
          .replace(/<title>[^<]*<\/title>/i, "<title>Register New company | OcholaSupernet</title>")
          .replace(
            /<meta name="description" content="[^"]*"\s*\/?>/i,
            '<meta name="description" content="Register New company with OcholaSupernet." />',
          );
        res.set("Cache-Control", "no-store").type("html").send(html);
      } catch {
        next();
      }
    });
    app.use(express.static(staticDir, {
      setHeaders(res, filePath) {
        if (path.basename(filePath) === "index.html" || path.basename(filePath) === "sw.js") {
          res.setHeader("Cache-Control", "no-store");
        }
      },
    }));

    // Never let an unknown API route fall through to the SPA document.
    // A JSON 404 keeps health checks and API clients from treating HTML as
    // a successful API response.
    app.use("/api", (_req, res) => {
      res.status(404).json({ error: "API route not found" });
    });

    // Missing assets must not return HTML as a successful script response.
    app.get("/{*path}", (req, res) => {
      if (req.path.startsWith("/assets/") || path.posix.extname(req.path)) {
        res.set("Cache-Control", "no-store").status(404).end();
        return;
      }
      res.set("Cache-Control", "no-store").sendFile(path.join(staticDir, "index.html"));
    });

    logger.info({ staticDir }, "Serving frontend static files");
  } else {
    logger.warn(
      { staticDir, candidates: staticDirCandidates },
      "Production static serving is enabled but dist/public was not found — run build:vps first",
    );
  }
}

export default app;
