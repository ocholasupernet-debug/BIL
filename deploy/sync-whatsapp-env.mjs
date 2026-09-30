import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WHATSAPP_ENV_KEYS = [
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_PHONE_NUMBER_ID",
];

function quoteForShell(value) {
  return `"${value.replace(/[\\"$`]/g, character => `\\${character}`)}"`;
}

export async function syncWhatsAppEnv({
  env = process.env,
  envPath = path.resolve(process.cwd(), ".env"),
} = {}) {
  const supplied = WHATSAPP_ENV_KEYS.flatMap(key => {
    const value = env[key];
    if (typeof value !== "string" || value.length === 0 || value.trim() === "") return [];
    if (/[\0\r\n]/.test(value)) {
      throw new Error(`${key} must be a single-line value.`);
    }
    return [{ key, value }];
  });

  if (supplied.length === 0) return [];

  let current = "";
  try {
    current = await readFile(envPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const lines = current.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();

  for (const { key } of supplied) {
    const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (pattern.test(lines[index])) lines.splice(index, 1);
    }
  }

  lines.push(...supplied.map(({ key, value }) => `${key}=${quoteForShell(value)}`));
  const tempPath = `${envPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tempPath, `${lines.join("\n")}\n`, { flag: "wx", mode: 0o600 });
    await chmod(tempPath, 0o600);
    await rename(tempPath, envPath);
    await chmod(envPath, 0o600);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return supplied.map(({ key }) => key);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const syncedKeys = await syncWhatsAppEnv();
    console.log(
      syncedKeys.length > 0
        ? `Synced WhatsApp environment entries: ${syncedKeys.join(", ")}`
        : "No WhatsApp Actions secrets supplied; existing VPS .env values were left unchanged.",
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "WhatsApp environment sync failed.");
    process.exitCode = 1;
  }
}