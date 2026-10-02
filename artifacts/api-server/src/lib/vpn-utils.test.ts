import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { generateVpsOvpnSetupScript } from "./vpn-utils.js";

test("VPS setup preserves nested auth verifier variables under strict shell mode", async () => {
  const setup = generateVpsOvpnSetupScript({
    vpsPublicIp: "vpn.example.test",
    vpnUsername: "test-router",
    vpnPassword: "one-time-password",
    routerTunnelIp: "10.8.5.2",
  });
  const writerStart = setup.indexOf('cat > "$AUTHSCRIPT" << AUTHEOF\n');
  assert.notEqual(writerStart, -1);
  const writerEnd = setup.indexOf("\nAUTHEOF", writerStart);
  assert.notEqual(writerEnd, -1);
  const writer = setup.slice(writerStart, writerEnd + "\nAUTHEOF".length);
  const tempDir = await mkdtemp(path.join(tmpdir(), "router-vpn-auth-"));
  const authFile = path.join(tempDir, "router-passwd");
  const authScript = path.join(tempDir, "verify-router-pass.sh");

  try {
    const shell = [
      "set -euo pipefail",
      `AUTHFILE=${JSON.stringify(authFile)}`,
      `AUTHSCRIPT=${JSON.stringify(authScript)}`,
      writer,
      "",
    ].join("\n");
    execFileSync("bash", ["-c", shell], { encoding: "utf8" });

    const verifier = await readFile(authScript, "utf8");
    assert.match(verifier, /^PASSFILE=".*\/router-passwd"$/m);
    assert.match(verifier, /^username="\$\{username:-\}"$/m);
    assert.match(verifier, /^password="\$\{password:-\}"$/m);
    assert.match(verifier, /^\[ -f "\$PASSFILE" \] \|\| exit 1$/m);
    assert.match(
      verifier,
      /^grep -Fqx "\$\{username\}:\$\{password\}" "\$PASSFILE" && exit 0 \|\| exit 1$/m,
    );

    await writeFile(authFile, "test-router:one-time-password\n", { mode: 0o600 });
    execFileSync("bash", [authScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        username: "test-router",
        password: "one-time-password",
      },
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});