import { chmodSync, unlinkSync, writeFileSync } from "fs";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import * as net from "net";

export interface VpsScriptResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface VpsTcpForward {
  host: "127.0.0.1";
  port: number;
  close: () => Promise<void>;
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

  /* A base64-wrapped key avoids line-break corruption in secrets UIs or
     terminal copy operations. The prefix makes the encoding explicit. */
  if (key.startsWith("base64:")) {
    const encoded = key.slice("base64:".length).replace(/\s+/g, "");
    try {
      key = Buffer.from(encoded, "base64").toString("utf8").trim();
    } catch {
      return "";
    }
  }

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

function reserveLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function waitForForward(
  child: ReturnType<typeof spawn>,
  port: number,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.off("close", onClose);
      child.off("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onClose = () => finish(new Error("VPS SSH port forward exited before becoming ready."));
    const onError = () => finish(new Error("VPS SSH port forward could not start."));

    const probe = () => {
      if (settled) return;
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.setTimeout(Math.min(500, Math.max(100, timeoutMs)));
      socket.once("connect", () => {
        socket.destroy();
        finish();
      });
      socket.once("timeout", () => socket.destroy());
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          finish(new Error(`VPS SSH port forward timed out after ${timeoutMs}ms.`));
        } else {
          timer = setTimeout(probe, 100);
        }
      });
    };

    child.once("close", onClose);
    child.once("error", onError);
    probe();
  });
}

/**
 * Open a short-lived local TCP endpoint forwarded through the VPS.
 *
 * This is used for management VPN addresses because the Replit API process
 * does not share the VPS OpenVPN route. The SSH key remains in a 0600
 * temporary file until the returned forward is closed.
 */
export async function openVpsTcpForward(
  remoteHost: string,
  remotePort: number,
  options: { timeoutMs?: number } = {},
): Promise<VpsTcpForward> {
  const host = remoteHost.trim();
  if (!/^10\.8\.5\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/.test(host)) {
    throw new Error("VPS TCP forwarding is restricted to a router management 10.8.5.x address.");
  }
  if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
    throw new Error("VPS TCP forwarding requires a valid remote port.");
  }

  const vpsHost = process.env.VPS_HOST?.trim() ?? "";
  const vpsUser = process.env.VPS_USER?.trim() ?? "";
  const keys = configuredKeys();
  if (!vpsHost || !vpsUser || keys.length === 0) {
    throw new Error("VPS_HOST, VPS_USER, and a VPS SSH key are required for router management forwarding.");
  }
  if (["localhost", "127.0.0.1", "::1"].includes(vpsHost)) {
    throw new Error("VPS_HOST must point to the remote production VPS.");
  }

  const timeoutMs = Math.max(5_000, options.timeoutMs ?? 15_000);
  const localPort = await reserveLocalPort();
  const askPassPath = `/tmp/ochola-vps-forward-askpass-${randomUUID()}`;
  const passphrase = process.env.VPS_SSH_PASSPHRASE || "";
  if (passphrase) {
    writeFileSync(
      askPassPath,
      `#!/bin/sh\nprintf '%s' '${b64(passphrase)}' | base64 -d\n`,
      { mode: 0o700 },
    );
    chmodSync(askPassPath, 0o700);
  }

  let lastError = "All configured VPS SSH keys failed.";
  try {
    for (const key of keys) {
      const keyPath = `/tmp/ochola-vps-forward-key-${randomUUID()}`;
      let child: ReturnType<typeof spawn> | undefined;
      try {
        writeFileSync(keyPath, key, { mode: 0o600 });
        chmodSync(keyPath, 0o600);
        const args = [
          "-i", keyPath,
          "-o", "StrictHostKeyChecking=accept-new",
          "-o", "ConnectTimeout=10",
          "-o", "ExitOnForwardFailure=yes",
          "-o", "ServerAliveInterval=15",
          "-o", "ServerAliveCountMax=2",
          "-o", passphrase ? "BatchMode=no" : "BatchMode=yes",
          "-N",
          "-L", `127.0.0.1:${localPort}:${host}:${remotePort}`,
          `${vpsUser}@${vpsHost}`,
        ];
        const env = { ...process.env };
        if (passphrase) {
          env.SSH_ASKPASS = askPassPath;
          env.SSH_ASKPASS_REQUIRE = "force";
          env.DISPLAY = env.DISPLAY || "none";
        }
        child = spawn("ssh", args, { env, stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        child.stderr.on("data", chunk => { stderr = appendBounded(stderr, chunk); });
        await waitForForward(child, localPort, timeoutMs);
        try { unlinkSync(askPassPath); } catch { /* best effort cleanup */ }

        let closed = false;
        const close = async () => {
          if (closed) return;
          closed = true;
          await new Promise<void>(resolve => {
            const forceTimer = setTimeout(() => {
              child?.kill("SIGKILL");
              resolve();
            }, 2_000);
            child?.once("close", () => {
              clearTimeout(forceTimer);
              resolve();
            });
            child?.kill("SIGTERM");
          });
          try { unlinkSync(keyPath); } catch { /* best effort cleanup */ }
        };
        return { host: "127.0.0.1", port: localPort, close };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        child?.kill("SIGKILL");
      } finally {
        if (!child || child.exitCode !== null) {
          try { unlinkSync(keyPath); } catch { /* best effort cleanup */ }
        }
      }
    }
  } finally {
    try { unlinkSync(askPassPath); } catch { /* best effort cleanup */ }
  }
  throw new Error(lastError);
}