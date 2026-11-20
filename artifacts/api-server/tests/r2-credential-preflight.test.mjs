import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  R2_ENV_KEYS,
  runR2CredentialPreflight,
} from "../scripts/r2-credential-preflight.mjs";

const validEnv = () => ({
  CLOUDFLARE_R2_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_R2_ACCESS_KEY_ID: "preflight-access-key-marker",
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: "preflight-secret-marker",
  CLOUDFLARE_R2_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
  CLOUDFLARE_R2_BUCKET_BIL: "bil-storage",
  CLOUDFLARE_R2_BUCKET_ISPLATTY: "ispatty-storage",
});

test("fails closed for each missing R2 setting without creating a client", async () => {
  for (const missingName of R2_ENV_KEYS) {
    const env = validEnv();
    env[missingName] = "  ";
    const output = [];
    let clientCreated = false;

    const exitCode = await runR2CredentialPreflight({
      env,
      createClient() {
        clientCreated = true;
        throw new Error("client must not be created");
      },
      report: (line) => output.push(line),
    });

    assert.equal(exitCode, 1, `${missingName} must fail the preflight`);
    assert.equal(clientCreated, false);
    assert.deepEqual(output, ["R2 preflight: FAIL (missing_configuration)"]);
  }
});

test("sends only two HeadBucket checks to the expected bucket names", async () => {
  const commands = [];
  const output = [];
  const env = validEnv();
  const exitCode = await runR2CredentialPreflight({
    env,
    createClient(options) {
      assert.equal(options.region, "auto");
      assert.equal(options.endpoint, env.CLOUDFLARE_R2_ENDPOINT);
      assert.equal(options.forcePathStyle, true);
      assert.equal(options.maxAttempts, 1);
      assert.equal(
        options.credentials.accessKeyId,
        env.CLOUDFLARE_R2_ACCESS_KEY_ID,
      );
      assert.equal(
        options.credentials.secretAccessKey,
        env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
      );
      return {
        async send(command) {
          commands.push(command);
        },
        destroy() {},
      };
    },
    createHeadBucketCommand: (bucket) => ({
      operation: "HeadBucket",
      Bucket: bucket,
    }),
    report: (line) => output.push(line),
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(commands, [
    { operation: "HeadBucket", Bucket: "bil-storage" },
    { operation: "HeadBucket", Bucket: "ispatty-storage" },
  ]);
  assert.deepEqual(output, [
    "R2 BIL bucket: PASS",
    "R2 ISPLATTY bucket: PASS",
    "R2 preflight: PASS",
  ]);
});

test("sanitizes denied-request errors and never reports credential material", async () => {
  const env = validEnv();
  const markers = [
    env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    env.CLOUDFLARE_R2_ENDPOINT,
    "Authorization: AWS4-HMAC-SHA256 signed-marker",
  ];
  const output = [];
  const exitCode = await runR2CredentialPreflight({
    env,
    createClient: () => ({
      async send() {
        throw Object.assign(new Error(`sensitive error ${markers.join(" ")}`), {
          $metadata: { httpStatusCode: 403 },
        });
      },
      destroy() {},
    }),
    createHeadBucketCommand: (bucket) => ({ Bucket: bucket }),
    report: (line) => output.push(line),
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(output, [
    "R2 BIL bucket: FAIL (access_denied)",
    "R2 ISPLATTY bucket: FAIL (access_denied)",
    "R2 preflight: FAIL",
  ]);
  for (const marker of markers) {
    assert.ok(output.every((line) => !line.includes(marker)));
  }
});

test("rejects non-Cloudflare endpoints and unexpected bucket names without a request", async () => {
  for (const [envName, badValue] of [
    ["CLOUDFLARE_R2_ENDPOINT", "https://example.invalid"],
    ["CLOUDFLARE_R2_BUCKET_BIL", "other-bucket"],
  ]) {
    const env = validEnv();
    env[envName] = badValue;
    const output = [];
    let requestSent = false;
    const exitCode = await runR2CredentialPreflight({
      env,
      createClient: () => ({
        async send() {
          requestSent = true;
        },
        destroy() {},
      }),
      report: (line) => output.push(line),
    });

    assert.equal(exitCode, 1);
    assert.equal(requestSent, false);
    assert.ok(output[0]?.startsWith("R2 preflight: FAIL ("));
    assert.ok(output.every((line) => !line.includes(badValue)));
  }
});

test("workflow is manual-only, read-only, and scopes secrets to the check step", async () => {
  const workflow = await readFile(
    fileURLToPath(
      new URL(
        "../../../.github/workflows/r2-credential-preflight.yml",
        import.meta.url,
      ),
    ),
    "utf8",
  );

  assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:\s*$/m);
  assert.doesNotMatch(
    workflow,
    /^\s+(?:push|pull_request|schedule|workflow_call):/m,
  );
  assert.match(workflow, /^permissions:\s*\n\s+contents:\s*read\s*$/m);
  assert.doesNotMatch(workflow, /\b(?:ssh|scp|pm2|supabase|deployments?)\b/i);
  assert.match(workflow, /runs-on:\s*ubuntu-latest/);

  for (const name of R2_ENV_KEYS) {
    const reference = `secrets.${name}`;
    assert.equal(
      workflow.split(reference).length - 1,
      1,
      `${name} is mapped exactly once in the preflight step`,
    );
    assert.match(
      workflow,
      new RegExp(`^\\s+${name}: \\$\\{\\{ secrets\\.${name} \\}\\}$`, "m"),
    );
  }

  const script = await readFile(
    fileURLToPath(
      new URL("../scripts/r2-credential-preflight.mjs", import.meta.url),
    ),
    "utf8",
  );
  assert.match(script, /HeadBucketCommand/);
  assert.doesNotMatch(
    script,
    /(?:ListObjects|GetObject|PutObject|DeleteObject)Command/,
  );
});
