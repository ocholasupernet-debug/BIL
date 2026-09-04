import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { existsSync } from "fs";
import router from "./routes";
import scriptsRouter from "./routes/scripts-route";
import { logger } from "./lib/logger";

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
app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

/* Also serve /scripts/* at the root path (no /api prefix) so MikroTik
   routers can fetch mainhotspot.rsc and the sub-scripts exactly as the
   URLs written inside those scripts:
     /tool fetch url="https://<isp-subdomain>.isplatty.org/scripts/vpn7.rsc"
   The same handlers are already mounted under /api/scripts/* via the main
   router above — this second mount is purely for the rootless path. */
app.use(scriptsRouter);

// ── Static file serving for VPS (no nginx needed) ─────────────────────────────
// Set SERVE_STATIC=true when running on a VPS without nginx in front.
// The frontend must be built first: pnpm run build:vps (in artifacts/ochola-supernet)
if (process.env.SERVE_STATIC === "true") {
  const staticDir = path.resolve(
    process.cwd(),
    "artifacts/ochola-supernet/dist/public",
  );

  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));

    // Never let an unknown API route fall through to the SPA document.
    // A JSON 404 keeps health checks and API clients from treating HTML as
    // a successful API response.
    app.use("/api", (_req, res) => {
      res.status(404).json({ error: "API route not found" });
    });

    // SPA fallback — send index.html for all non-API routes
    app.get("/{*path}", (_req, res) => {
      res.sendFile(path.join(staticDir, "index.html"));
    });

    logger.info({ staticDir }, "Serving frontend static files");
  } else {
    logger.warn(
      { staticDir },
      "SERVE_STATIC=true but dist/public not found — run build:vps first",
    );
  }
}

export default app;
