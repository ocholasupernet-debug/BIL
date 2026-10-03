import assert from "node:assert/strict";
import test from "node:test";
import { installHotspotFiles, replaceHotspotFiles } from "./router-hotspot-files";

test("hotspot file progress resumes a lost job immediately and retries gateway failures", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const requests: Array<{ method: string; cache?: RequestCache; url: string; body?: string }> = [];
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
    requests.push({ method, cache: init?.cache, url, body: typeof init?.body === "string" ? init.body : undefined });
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
    if (pollNumber === 1) {
      return new Response(JSON.stringify({ error: "Bulk deployment job not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (pollNumber === 2) return new Response("temporarily unavailable", { status: 502 });
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
    assert.equal(JSON.parse(requests.find(request => request.method === "POST")?.body ?? "{}").mode, "install");
    assert.deepEqual(requests.map(request => request.method), ["POST", "GET", "POST", "GET", "GET"]);
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

test("hotspot file deployment includes router API detail and hint in startup errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    error: "MikroTik API error",
    detail: "Connection timed out",
    hint: "Check the router-management VPN and API access.",
  }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;

  try {
    await assert.rejects(
      installHotspotFiles(105, 3, "test-token"),
      /MikroTik API error — Connection timed out — Check the router-management VPN and API access\./,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hotspot file progress requeues when the first poll cannot find its job", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const requests: Array<{ method: string; cache?: RequestCache; url: string; body?: string }> = [];
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
    requests.push({ method, cache: init?.cache, url, body: typeof init?.body === "string" ? init.body : undefined });
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
    if (pollNumber === 1) {
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
      deployed: [],
      skipped: [{ sourceName: "login.html", destinationPath: "flash/hotspot/login.html", reason: "already exists" }],
      failed: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await installHotspotFiles(105, 3, "test-token");
    assert.equal(result.status, "complete");
    assert.equal(result.skipped.length, 1);
    assert.equal(jobNumber, 2);
    assert.deepEqual(requests.map(request => request.method), ["POST", "GET", "POST", "GET"]);
    assert.ok(requests.filter(request => request.method === "POST").every(request => JSON.parse(request.body ?? "{}").mode === "install"));
    assert.ok(requests[3].url.includes("/recovered-job?"));
    assert.ok(requests.every(request => request.cache === "no-store"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("replacement mode survives a lost job and returns added, replaced, skipped, and failed results", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const requests: Array<{ method: string; body?: string }> = [];
  let postCount = 0;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout: (callback: TimerHandler) => {
        if (typeof callback === "function") callback();
        return 1;
      },
    },
  });
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    requests.push({ method, body: typeof init?.body === "string" ? init.body : undefined });
    if (method === "POST") {
      postCount += 1;
      return new Response(JSON.stringify({
        jobId: postCount === 1 ? "lost-replace-job" : "recovered-replace-job",
        status: "queued",
        total: 3,
        processed: 0,
        deployed: [],
        replaced: [],
        skipped: [],
        failed: [],
      }), { status: 202, headers: { "Content-Type": "application/json" } });
    }
    if (postCount === 1) {
      return new Response(JSON.stringify({ error: "Bulk deployment job not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      status: "complete",
      total: 3,
      processed: 3,
      deployed: [{ sourceName: "new.css", destinationPath: "flash/hotspot/new.css", size: 30 }],
      replaced: [{ sourceName: "login.html", destinationPath: "flash/hotspot/login.html", size: 40 }],
      skipped: [{ sourceName: "extra.js", destinationPath: "flash/hotspot/extra.js", reason: "appeared during deployment; left unchanged" }],
      failed: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await replaceHotspotFiles(105, 3, "test-token");
    assert.equal(result.status, "complete");
    assert.equal(result.deployed.length, 1);
    assert.equal(result.replaced.length, 1);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.failed.length, 0);
    assert.equal(postCount, 2);
    assert.ok(requests.filter(request => request.method === "POST").every(request => JSON.parse(request.body ?? "{}").mode === "replace"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});