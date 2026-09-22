import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CERTIFICATE_FILENAME = "isrg-root-x1.pem";

function readIsrgRootCertificate(): string {
  const candidatePaths: string[] = [];
  const moduleUrl = typeof import.meta.url === "string" ? import.meta.url : undefined;

  if (moduleUrl) {
    candidatePaths.push(
      fileURLToPath(new URL(`./certificates/${CERTIFICATE_FILENAME}`, moduleUrl)),
    );
  }
  if (typeof __dirname === "string") {
    candidatePaths.push(join(__dirname, "certificates", CERTIFICATE_FILENAME));
  }

  candidatePaths.push(
    resolve(process.cwd(), "dist", "certificates", CERTIFICATE_FILENAME),
    resolve(process.cwd(), "src", "lib", "certificates", CERTIFICATE_FILENAME),
    resolve(process.cwd(), "artifacts", "api-server", "src", "lib", "certificates", CERTIFICATE_FILENAME),
  );

  const certificatePath = candidatePaths.find(path => existsSync(path));
  if (!certificatePath) {
    throw new Error(
      `The public Router HTTPS trust certificate "${CERTIFICATE_FILENAME}" was not found.`,
    );
  }
  return readFileSync(certificatePath, "utf8");
}

const ISRG_ROOT_X1_PEM = readIsrgRootCertificate();
export { ISRG_ROOT_X1_PEM };

/**
 * Public trust anchor for the production wildcard certificate.
 *
 * The VPS certificate is issued by Let's Encrypt and chains to ISRG Root X1.
 * This is a public certificate only; no private key is stored here.
 */
export const ROUTER_HTTPS_CERTIFICATE_NAME = "ochola-isrg-root-x1";
export const ROUTER_HTTPS_CERTIFICATE_FILE = "ochola-isrg-root-x1.pem";
export const ROUTER_HTTPS_CERTIFICATE_PATH = `/scripts/${ROUTER_HTTPS_CERTIFICATE_FILE}`;

/**
 * Render a RouterOS string value without putting the complete PEM on one
 * command line. RouterOS 6 has a relatively small command-line limit, so
 * append one certificate line at a time.
 */
export function routerOsTextVariableWriter(
  value: string,
  variableName = "caText",
  indent = "",
): string {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length === 0) throw new Error("Cannot render an empty RouterOS text value.");

  const escaped = (line: string) =>
    line.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const output = [`${indent}:local ${variableName} "${escaped(lines[0])}"`];
  for (const line of lines.slice(1)) {
    output.push(
      `${indent}:set ${variableName} ($${variableName} . "\\n" . "${escaped(line)}")`,
    );
  }
  return output.join("\n");
}