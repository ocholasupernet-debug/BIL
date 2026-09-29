import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { resolveVlanHotspotPortalRequest } from "./lib/api-auth.js";

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
app.use(resolveVlanHotspotPortalRequest);

app.use("/api", router);

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
