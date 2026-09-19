import ISRG_ROOT_X1_PEM from "./certificates/isrg-root-x1.pem";
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