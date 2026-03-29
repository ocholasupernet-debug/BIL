import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { existsSync } from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

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
