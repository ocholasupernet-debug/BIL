import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const baseUrl = (process.env.VISUAL_BASE_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
const outputDirectory = process.env.VISUAL_OUTPUT_DIR || path.join(os.tmpdir(), "ochola-dashboard-visual-checks");
const pageCases = [
  { page: "admin-dashboard", label: "Admin dashboard" },
  { page: "reseller-dashboard", label: "Reseller dashboard" },
  { page: "storage", label: "Super-admin storage" },
];
const themes = ["light", "dark"];
const viewports = [
  { name: "desktop", width: 1440, height: 3000 },
  { name: "mobile", width: 390, height: 3600 },
];

function findChromium() {
  if (process.env.CHROMIUM_BIN) return process.env.CHROMIUM_BIN;
  for (const candidate of ["/repl/tools/bin/chromium", "chromium", "chromium-browser", "google-chrome"]) {
    try {
      if (candidate.startsWith("/")) {
        execFileSync("test", ["-x", candidate]);
        return candidate;
      }
      return execFileSync("bash", ["-lc", `command -v ${candidate}`], { encoding: "utf8" }).trim();
    } catch {
      // Try the next browser name.
    }
  }
  throw new Error("Chromium was not found. Set CHROMIUM_BIN to a headless Chromium executable.");
}

async function waitForWebApp() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The configured web workflow may still be starting.
    }
    await delay(250);
  }
  throw new Error(`No web app responded at ${baseUrl}. Start the OcholaSupernet web workflow, then retry.`);
}

const chromium = findChromium();
await waitForWebApp();
await mkdir(outputDirectory, { recursive: true });

let failures = 0;
for (const { page, label } of pageCases) {
  for (const theme of themes) {
    for (const viewport of viewports) {
      const name = `${page}-${theme}-${viewport.name}`;
      const screenshot = path.join(outputDirectory, `${name}.png`);
      const profile = await mkdtemp(path.join(os.tmpdir(), "ochola-visual-profile-"));
      const url = `${baseUrl}/__visual/${page}?theme=${theme}`;
      const result = spawnSync(chromium, [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-extensions",
        "--disable-background-networking",
        "--no-first-run",
        "--hide-scrollbars",
        `--window-size=${viewport.width},${viewport.height}`,
        "--virtual-time-budget=14000",
        "--dump-dom",
        `--screenshot=${screenshot}`,
        `--user-data-dir=${profile}`,
        url,
      ], { encoding: "utf8", timeout: 35_000, maxBuffer: 12 * 1024 * 1024 });
      await rm(profile, { recursive: true, force: true });

      const dom = result.stdout || "";
      const status = dom.match(/data-visual-status="([^"]+)"/)?.[1] || "missing";
      const errors = dom.match(/data-visual-errors="([^"]*)"/)?.[1] || "";
      const passed = result.status === 0 && status === "passed";
      console.log(`${passed ? "PASS" : "FAIL"} ${label} · ${theme} · ${viewport.name}${errors ? ` — ${errors}` : ""}`);
      if (!passed) {
        failures += 1;
        if (result.error) console.error(`  Chromium error: ${result.error.message}`);
        if (result.stderr?.trim()) console.error(result.stderr.trim().split("\n").slice(-8).join("\n"));
        if (status === "missing") console.error(`  Harness did not report completion; browser status: ${result.status}`);
      }
    }
  }
}

console.log(`Screenshots: ${outputDirectory}`);
if (failures) process.exitCode = 1;