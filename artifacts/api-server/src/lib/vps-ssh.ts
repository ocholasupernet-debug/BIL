import { chmodSync, unlinkSync, writeFileSync } from "fs";
import { spawn } from "child_process";
import { randomUUID } from "crypto";

export interface VpsScriptResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

const OUTPUT_LIMIT = 128 * 1024;

function configuredKeys(): string[] {
  /* Keep the newest deployment key first, but retain the older aliases as
     fallbacks. Replit secrets can outlive a rotated key, so selecting the
     first defined name is not enough when that alias contains an old or
     malformed private key. */
  return [
    process.env.VPS_DEPLOYMENT_KEY_V3,
    process.env.VPS_DEPLOYMENT_KEY_V2,
    process.env.VPS_DEPLOYMENT_KEY,
    process.env.VPS_SSH_KEY,
  ]
    .map(value => normalizePrivateKey(value ?? ""))
    .filter(Boolean);
}

function normalizePrivateKey(value: string): string {
  let key = value.trim();
  if (!key) return "";

  /* Secrets are sometimes pasted with literal "\\n" sequences or Windows
     line endings. ssh reads the temporary file literally, so normalize both
     forms before trying the connection. */
  if (!key.includes("\n") && key.includes("\\n") && key.includes("-----BEGIN")) {
    key = key.replaceAll("\\n", "\n");
  }
  key = key.replace(/\r\n?/g, "\n");
  return key.endsWith("\n") ? key : `${key}\n`;
}

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function appendBounded(current: string, chunk: Buffer | string): string {
  const next = current + chunk.toString();
  return next.length > OUTPUT_LIMIT ? next.slice(-OUTPUT_LIMIT) : next;
}

export function vpsSshConfigured(): boolean {
  const host = process.env.VPS_HOST?.trim() ?? "";
  const user = process.env.VPS_USER?.trim() ?? "";
  return Boolean(host && user && configuredKeys().length > 0 && !["localhost", "127.0.0.1", "::1"].includes(host));
}

/**
 * Execute a bounded script over the deployment SSH channel.
 *
 * The script is sent over stdin, never placed in argv, and temporary private
 * key/askpass files are removed before returning. Callers should persist only
 * safe status fields from the result, not stdout/stderr.
 */
export async function runVpsScript(
  script: string,
  options: { timeoutMs?: number } = {},
): Promise<VpsScriptResult> {
  const host = process.env.VPS_HOST?.trim() ?? "";
  const user = process.env.VPS_USER?.trim() ?? "";
  const keys = configuredKeys();
  if (!host || !user || keys.length === 0) {
    return { ok: false, stdout: "", stderr: "", error: "VPS_HOST, VPS_USER, and a VPS SSH key are required." };
  }
  if (["localhost", "127.0.0.1", "::1"].includes(host)) {
    return { ok: false, stdout: "", stderr: "", error: "VPS_HOST must point to the remote production VPS." };
  }

  const askPassPath = `/tmp/ochola-vps-askpass-${randomUUID()}`;
  const timeoutMs = Math.max(5_000, options.timeoutMs ?? 120_000);
  let lastResult: VpsScriptResult = {
    ok: false,
    stdout: "",
    stderr: "",
    error: "All configured VPS SSH keys failed.",
  };

  try {
    const passphrase = process.env.VPS_SSH_PASSPHRASE || "";
    if (passphrase) {
      writeFileSync(
        askPassPath,
        `#!/bin/sh\nprintf '%s' '${b64(passphrase)}' | base64 -d\n`,
        { mode: 0o700 },
      );
      chmodSync(askPassPath, 0o700);
    }

    for (const key of keys) {
      const keyPath = `/tmp/ochola-vps-key-${randomUUID()}`;
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      try {
        writeFileSync(keyPath, key, { mode: 0o600 });
        chmodSync(keyPath, 0o600);

        const args = [
          "-i", keyPath,
          "-o", "StrictHostKeyChecking=accept-new",
          "-o", "ConnectTimeout=10",
          "-o", "PasswordAuthentication=no",
          `${user}@${host}`,
          "bash",
          "-s",
        ];
        const env = { ...process.env };
        if (passphrase) {
          args.unshift("-o", "BatchMode=no");
          env.SSH_ASKPASS = askPassPath;
          env.SSH_ASKPASS_REQUIRE = "force";
          env.DISPLAY = env.DISPLAY || "none";
        } else {
          args.unshift("-o", "BatchMode=yes");
        }

        const result = await new Promise<VpsScriptResult>(resolve => {
          const child = spawn("ssh", args, { env, stdio: ["pipe", "pipe", "pipe"] });
          const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, timeoutMs);
          child.stdout.on("data", chunk => { stdout = appendBounded(stdout, chunk); });
          child.stderr.on("data", chunk => { stderr = appendBounded(stderr, chunk); });
          child.on("error", error => {
            clearTimeout(timer);
            resolve({ ok: false, stdout, stderr, error: error.message });
          });
          child.on("close", code => {
            clearTimeout(timer);
            resolve({
              ok: code === 0 && !timedOut,
              stdout,
              stderr,
              error: timedOut ? `VPS command timed out after ${timeoutMs}ms.` : undefined,
            });
          });
          child.stdin.end(script);
        });

        if (result.ok) return result;
        lastResult = result;
      } finally {
        try { unlinkSync(keyPath); } catch { /* best effort cleanup */ }
      }
    }

    return lastResult;
  } finally {
    try { unlinkSync(askPassPath); } catch { /* best effort cleanup */ }
  }
}