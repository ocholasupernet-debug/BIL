import assert from "node:assert/strict";
import test from "node:test";
import { installHotspotFiles } from "./router-hotspot-files";

test("hotspot file progress retries a gateway failure and resumes a lost job", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const requests: Array<{ method: string; cache?: RequestCache; url: string }> = [];
  let jobNumber = 0;
  let pollNumber = 0;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout: (callback: TimerHandler) => {
        if (typeof callback === "function") callback();
        return 1;
      },
    },
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ method, cache: init?.cache, url });
    if (method === "POST") {
      jobNumber += 1;
      return new Response(JSON.stringify({
        jobId: jobNumber === 1 ? "first-job" : "recovered-job",
        status: "queued",
        total: 1,
        processed: 0,
        deployed: [],
        skipped: [],
        failed: [],
      }), { status: 202, headers: { "Content-Type": "application/json" } });
    }

    pollNumber += 1;
    if (pollNumber === 1) return new Response("temporarily unavailable", { status: 502 });
    if (pollNumber === 2) {
      return new Response(JSON.stringify({ error: "Bulk deployment job not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      jobId: "recovered-job",
      status: "complete",
      total: 1,
      processed: 1,
      deployed: [{ sourceName: "login.html", destinationPath: "flash/hotspot/login.html", size: 20 }],
      skipped: [],
      failed: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await installHotspotFiles(105, 3, "test-token");
    assert.equal(result.status, "complete");
    assert.equal(result.deployed.length, 1);
    assert.deepEqual(requests.map(request => request.method), ["POST", "GET", "GET", "POST", "GET"]);
    assert.ok(requests.every(request => request.cache === "no-store"));
    assert.ok(requests.some(request => request.url.includes("/recovered-job?")));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});