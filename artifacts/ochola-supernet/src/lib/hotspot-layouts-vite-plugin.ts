import type { Plugin } from "vite";
import { STATIC_PORTAL_LAYOUT_CSS_TEXT } from "./hotspot-layouts.js";

const ASSET_PATH = "/hotspot/portal-layouts.css";
const ASSET_FILE = "hotspot/portal-layouts.css";

export function hotspotLayoutsStylesheetPlugin(): Plugin {
  return {
    name: "hotspot-layouts-stylesheet",
    configureServer(server) {
      server.middlewares.use(ASSET_PATH, (request, response, next) => {
        if (request.method !== "GET" && request.method !== "HEAD") {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/css; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(request.method === "HEAD" ? undefined : STATIC_PORTAL_LAYOUT_CSS_TEXT);
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: ASSET_FILE,
        source: STATIC_PORTAL_LAYOUT_CSS_TEXT,
      });
    },
  };
}