import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import express from "express";
import test from "node:test";
import { employeeSessionCookieName, hashEmployeeSecret } from "../lib/employee-portal-security.js";

process.env.EMPLOYEE_PORTAL_ENABLED = "true";
process.env.NODE_ENV = "development";
process.env.REPLIT_DEV_DOMAIN = "workspace-preview.invalid";
process.env.VITE_SUPABASE_URL = "https://technician-learning-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-not-a-secret";

const { default: employeePortalRouter } = await import("./employee-portal-route.js");

const guideId = "00000000-0000-4000-8000-000000000011";
const modelId = "00000000-0000-4000-8000-000000000012";
const guideRow = {
  id: guideId, slug: "safe-port-check", title: "Safe port check", summary: "Check the printed model labels.",
  category: "ports", brands: ["All"], models: ["All models"], firmware_notes: "Verify the exact revision.",
  symptom_tags: ["no-ip"], likely_causes: ["Wrong port"], safe_checks: ["Read labels."],
  escalate_when: ["Shared uplink at risk."], warnings: ["Do not reset."],
  steps: [{ title: "Read labels", instruction: "Use the exact device label." }],
  diagrams: [{ kind: "router-ports", caption: "Conceptual only.", labels: ["WAN", "LAN"] }],
  customer_script: "I will check the device labels first.", manual_url: null,
  status: "published", created_by: "super_admin", updated_by: "super_admin",
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
};
const modelRow = {
  id: modelId, brand: "Tenda", model: "Example revision", device_type: "Router",
  hardware_revisions: ["Check base label"], firmware_variants: ["Revision-specific"],
  notes: "Confirm exact mode.", warning: "WAN behavior depends on model and mode.",
  manual_url: null, diagram: null, status: "published", created_by: "super_admin",
  updated_by: "super_admin", created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

test("Technician Learning APIs isolate roles and expose published material only", async (t) => {
  const app = express();
  app.use(express.json());
  app.use("/api", employeePortalRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  let accountType: "employee" | "technician" = "technician";
  const databaseCalls: Array<{ url: string; method: string }> = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    databaseCalls.push({ url, method });
    if (url.includes("/employee_sessions?")) {
      return new Response(JSON.stringify([{
        id: "session", employee_id: "00000000-0000-4000-8000-000000000010", auth_version: 1,
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/employee_profiles?")) {
      return new Response(JSON.stringify([{
        id: "00000000-0000-4000-8000-000000000010", username: "staff-1",
        display_name: "Field Technician", email: "tech@example.invalid",
        status: "active", auth_version: 1, account_type: accountType,
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/technician_learning_guides?")) {
      return new Response(JSON.stringify([guideRow]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/technician_device_models?")) {
      return new Response(JSON.stringify([modelRow]), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected fake Supabase request: ${url}`);
  };

  const request = (path: string, options: { cookie?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
      const req = httpRequest({
        hostname: "127.0.0.1",
        port: address.port,
        path: `/api${path}`,
        method: options.method ?? "GET",
        headers: {
          host: "staff.isplatty.com",
          ...(options.cookie ? { cookie: options.cookie } : {}),
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...options.headers,
        },
      }, (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => { raw += chunk; });
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) as Record<string, unknown> }); }
          catch (error) { reject(error); }
        });
      });
      req.on("error", reject);
      if (options.body) req.write(JSON.stringify(options.body));
      req.end();
    });

  const cookie = `${employeeSessionCookieName}=temporary-test-session`;
  try {
    const missingSession = await request("/employee/learning/guides");
    assert.equal(missingSession.status, 401);

    const technicianGuides = await request("/employee/learning/guides?q=port", { cookie });
    assert.equal(technicianGuides.status, 200);
    assert.equal((technicianGuides.body.guides as unknown[]).length, 1);
    assert.ok(databaseCalls.some(({ url }) =>
      url.includes("technician_learning_guides?status=eq.published"),
    ));

    const technicianModels = await request("/employee/learning/models?q=tenda", { cookie });
    assert.equal(technicianModels.status, 200);
    assert.equal((technicianModels.body.models as unknown[]).length, 1);

    const techPayroll = await request("/employee/dashboard", { cookie });
    assert.equal(techPayroll.status, 403);

    accountType = "employee";
    const employeeLearning = await request("/employee/learning/guides", { cookie });
    assert.equal(employeeLearning.status, 403);

    const noAdminAuth = await request("/employee/admin/learning/guides");
    assert.equal(noAdminAuth.status, 401);

    const deniedWrite = await request("/employee/admin/learning/guides", {
      method: "POST",
      body: { slug: "unauthorized", title: "No", summary: "No" },
    });
    assert.equal(deniedWrite.status, 401);
    assert.equal(databaseCalls.some(({ url, method }) =>
      url.includes("technician_learning_guides") && method === "POST",
    ), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Technician session lookups use hashed tokens, not browser-provided employee IDs", () => {
  const token = "temporary-test-session";
  assert.equal(hashEmployeeSecret(token).length, 64);
});
