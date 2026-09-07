/**
 * Validate the final rendered RouterOS file, not only its TypeScript template.
 * RouterOS treats physical line breaks inside quoted strings as parser errors.
 */
export function validateGeneratedRouterScript(script: string): string {
  const normalized = script
    .replace(/â€”/g, "-")
    .replace(/[—–]/g, "-")
    .replace(/→/g, "->")
    .replace(/↔/g, "<->")
    .replace(/·/g, "-")
    .replace(/•/g, "*")
    .replace(/…/g, "...")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/⚠/g, "WARNING")
    .replace(/[^\x00-\x7F]/g, "?")
    .replace(/\r\n?/g, "\n");
  let inString = false;
  let escaped = false;
  let line = 1;
  let column = 0;
  let braceDepth = 0;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    column += 1;
    if (char === "\n") {
      if (inString) {
        throw new Error(`Generated RouterOS script contains a line break inside a quoted string at line ${line}, column ${column}.`);
      }
      line += 1;
      column = 0;
      escaped = false;
      continue;
    }
    if (!inString && char === "#") {
      while (index + 1 < normalized.length && normalized[index + 1] !== "\n") {
        index += 1;
        column += 1;
      }
      continue;
    }
    if (char.charCodeAt(0) > 0x7e || (char.charCodeAt(0) < 0x20 && char !== "\t")) {
      throw new Error(`Generated RouterOS script contains a non-ASCII control character at line ${line}, column ${column}.`);
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
    } else if (char === "{") {
      braceDepth += 1;
    } else if (char === "}") {
      braceDepth -= 1;
      if (braceDepth < 0) {
        throw new Error(`Generated RouterOS script closes a block before opening it at line ${line}, column ${column}.`);
      }
    }
  }

  if (inString) {
    throw new Error(`Generated RouterOS script ends inside a quoted string at line ${line}, column ${column}.`);
  }
  if (braceDepth !== 0) {
    throw new Error(`Generated RouterOS script has ${braceDepth > 0 ? "unclosed" : "unexpected"} block brace(s).`);
  }
  return normalized;
}