export class RouterTakeoverTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouterTakeoverTemplateError";
  }
}

export interface ValidateRouterTakeoverMainhotspotOptions {
  sourceRouterId: number;
  fileName: string;
  content: string;
}

function fail(message: string): never {
  throw new RouterTakeoverTemplateError(message);
}

function fileBaseName(fileName: string): string {
  return fileName.trim().replace(/\\/g, "/").split("/").at(-1)?.toLowerCase() ?? "";
}

/**
 * Validates the one read-only Takeover reference file.
 *
 * mainhotspot.rsc is an old bootstrap script: its service settings live in
 * other downloaded scripts. Only its common version/connectivity checks and
 * Hotspot/PPPoE bootstrap shape are recognized here. No source command or URL
 * is returned to the caller or included in generated target scripts.
 */
export function validateRouterTakeoverMainhotspot(
  options: ValidateRouterTakeoverMainhotspotOptions,
): void {
  const { sourceRouterId, fileName, content } = options;
  if (!Number.isSafeInteger(sourceRouterId) || sourceRouterId <= 0) {
    fail("A valid source router is required for Takeover.");
  }

  const pathParts = fileName.trim().replace(/\\/g, "/").split("/");
  if (
    fileBaseName(fileName) !== "mainhotspot.rsc"
    || pathParts.some(part => part === "." || part === "..")
  ) {
    fail('Takeover reads only the source router file named "mainhotspot.rsc".');
  }
  if (!content.trim() || content.includes("\0")) {
    fail('"mainhotspot.rsc" is empty or is not plain text.');
  }

  const header = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .slice(0, 8)
    .join("\n");
  if (!/mainhotspot\.rsc/i.test(header)) {
    fail('"mainhotspot.rsc" does not have a recognized mainhotspot header.');
  }

  if (!/\/system\s+package\s+update\s+get\s+installed-version/i.test(content)) {
    fail('"mainhotspot.rsc" is missing its RouterOS version check.');
  }
  if (!/\/ping\s+8\.8\.8\.8\s+count\s*=\s*3/i.test(content)) {
    fail('"mainhotspot.rsc" is missing its shared Internet connectivity check.');
  }
  if (!/hotspotsetup\.rsc/i.test(content) || !/pppoesetup\.rsc/i.test(content)) {
    fail('"mainhotspot.rsc" must describe both Hotspot and PPPoE setup stages.');
  }
}