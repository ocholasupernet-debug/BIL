import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import platformRadiusRouter from "./platform-radius-route.js";

test("all platform RADIUS management routes require an active Super Admin session", async () => {
  const app = express();
  app.use(express.json());
  app.use(platformRadiusRouter);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const requests: Array<[string, string, Record<string, unknown>?]> = [
      ["GET", "/super-admin/radius-settings"],
      ["GET", "/super-admin/radius-settings/routers"],
      ["POST", "/super-admin/radius-settings/discover"],
      ["POST", "/super-admin/radius-settings/provision", { confirm: true, routerIds: [1] }],
      ["POST", "/super-admin/radius-settings/secret", {}],
      ["POST", "/super-admin/radius-settings/secret/rotate", { confirm: true }],
      ["PUT", "/super-admin/radius-settings", { enabled: true }],
    ];
    for (const [method, path, body] of requests) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: "Bearer ordinary-admin-token",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      assert.equal(response.status, 401, `${method} ${path}`);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
