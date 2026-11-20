import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import path from "node:path";
import { R2_ENV_KEYS } from "../../../deploy/validate-r2-env.mjs";
import { fileURLToPath } from "node:url";

const EXPECTED_BUCKETS = Object.freeze([
  { label: "BIL", envKey: "CLOUDFLARE_R2_BUCKET_BIL", name: "bil-storage" },
  {
    label: "ISPLATTY",
    envKey: "CLOUDFLARE_R2_BUCKET_ISPLATTY",
    name: "ispatty-storage",
  },
]);

function configurationFailure(env) {
  if (
    R2_ENV_KEYS.some(
      (name) => typeof env[name] !== "string" || env[name].trim() === "",
    )
  ) {
    return "missing_configuration";
  }

  const accountId = env.CLOUDFLARE_R2_ACCOUNT_ID.trim();
  if (!/^[a-f0-9]{32}$/i.test(accountId)) return "invalid_configuration";
  if (
    EXPECTED_BUCKETS.some(({ envKey, name }) => env[envKey].trim() !== name)
  ) {
    return "bucket_configuration_mismatch";
  }

  try {
    const endpoint = new URL(env.CLOUDFLARE_R2_ENDPOINT.trim());
    if (
      endpoint.protocol !== "https:" ||
      endpoint.hostname.toLowerCase() !==
        `${accountId.toLowerCase()}.r2.cloudflarestorage.com` ||
      endpoint.username ||
      endpoint.password ||
      endpoint.port ||
      endpoint.pathname !== "/" ||
      endpoint.search ||
      endpoint.hash
    ) {
      return "invalid_configuration";
    }
  } catch {
    return "invalid_configuration";
  }

  return null;
}

function safeErrorCategory(error) {
  const status = Number(error?.$metadata?.httpStatusCode ?? error?.statusCode);
  if (status === 401) return "authentication_failed";
  if (status === 403) return "access_denied";
  if (status === 404) return "bucket_unavailable";
  if (status === 429 || status >= 500) return "service_unavailable";
  if (
    [
      "ENOTFOUND",
      "EAI_AGAIN",
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
    ].includes(error?.code)
  ) {
    return "network_error";
  }
  if (error?.name === "TimeoutError") return "network_error";
  return "request_failed";
}

export async function runR2CredentialPreflight({
  env = process.env,
  createClient = (options) => new S3Client(options),
  createHeadBucketCommand = (bucket) =>
    new HeadBucketCommand({ Bucket: bucket }),
  report = (line) => console.log(line),
} = {}) {
  const configError = configurationFailure(env);
  if (configError) {
    report(`R2 preflight: FAIL (${configError})`);
    return 1;
  }

  let client;
  try {
    client = createClient({
      region: "auto",
      endpoint: env.CLOUDFLARE_R2_ENDPOINT.trim(),
      forcePathStyle: true,
      maxAttempts: 1,
      credentials: {
        accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID,
        secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
      },
    });
  } catch {
    report("R2 preflight: FAIL (client_initialization_failed)");
    return 1;
  }

  let failed = false;
  try {
    for (const bucket of EXPECTED_BUCKETS) {
      try {
        await client.send(createHeadBucketCommand(bucket.name));
        report(`R2 ${bucket.label} bucket: PASS`);
      } catch (error) {
        failed = true;
        report(`R2 ${bucket.label} bucket: FAIL (${safeErrorCategory(error)})`);
      }
    }
  } catch {
    failed = true;
    report("R2 preflight: FAIL (request_failed)");
  } finally {
    try {
      client.destroy?.();
    } catch {
      // Destruction errors must not expose request or credential details.
    }
  }

  report(`R2 preflight: ${failed ? "FAIL" : "PASS"}`);
  return failed ? 1 : 0;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    process.exitCode = await runR2CredentialPreflight();
  } catch {
    console.log("R2 preflight: FAIL (internal_error)");
    process.exitCode = 1;
  }
}
