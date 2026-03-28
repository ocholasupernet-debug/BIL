/**
 * Reads the current subdomain from window.location.hostname.
 *
 * Examples:
 *   fastnet.isplatty.org      →  "fastnet"
 *   www.isplatty.org          →  ""   (www is ignored)
 *   isplatty.org              →  ""
 *   localhost                 →  ""
 *   xxx.worf.replit.dev       →  ""   (Replit preview is ignored)
 */
export function getHostSubdomain(): string {
  const hostname = window.location.hostname;

  if (
    hostname === "localhost" ||
    hostname.includes("replit.dev") ||
    hostname.includes("repl.co") ||
    hostname.includes("worf.")
  ) {
    return "";
  }

  const parts = hostname.split(".");
  if (parts.length >= 3 && parts[0] !== "www" && parts[0] !== "api") {
    return parts[0];
  }

  return "";
}
