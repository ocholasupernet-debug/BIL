import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const HOTSPOT_ROOT = [
  path.resolve(process.cwd(), "artifacts/ochola-supernet/public/hotspot"),
  path.resolve(process.cwd(), "../ochola-supernet/public/hotspot"),
  path.resolve(process.cwd(), "../../artifacts/ochola-supernet/public/hotspot"),
].find(candidate => existsSync(candidate))
  ?? path.resolve(process.cwd(), "artifacts/ochola-supernet/public/hotspot");

const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".svg", ".txt", ".xsd"]);
const BINARY_EXTENSIONS = new Set([".ico", ".png", ".jpg", ".jpeg", ".gif", ".webp"]);

export type DeployableSourceType = "hotspot";

export interface DeployableSource {
  id: string;
  type: DeployableSourceType;
  name: string;
  label: string;
  size: number;
}

export interface DeployableSourceContent {
  source: DeployableSource;
  content: Buffer;
}

function hotspotFiles(relativeDir = ""): DeployableSource[] {
  const directory = path.resolve(HOTSPOT_ROOT, relativeDir);
  const entries: DeployableSource[] = [];

  if (!directory.startsWith(`${HOTSPOT_ROOT}${path.sep}`) && directory !== HOTSPOT_ROOT) return entries;

  try {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativeName = path.posix.join(relativeDir.replaceAll("\\", "/"), entry.name);
      const absoluteName = path.resolve(HOTSPOT_ROOT, relativeName);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        entries.push(...hotspotFiles(relativeName));
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(extension) && !BINARY_EXTENSIONS.has(extension)) continue;

      try {
        entries.push({
          id: `hotspot:${relativeName}`,
          type: "hotspot",
          name: relativeName,
          label: `Hotspot · ${relativeName}`,
          size: statSync(absoluteName).size,
        });
      } catch {
        /* Ignore files that disappear while the catalog is being built. */
      }
    }
  } catch {
    /* A missing portal asset directory is an empty catalog. */
  }

  return entries;
}

export function listDeployableSources(): DeployableSource[] {
  return hotspotFiles().sort((a, b) => a.name.localeCompare(b.name));
}

export function getDeployableSource(
  type: DeployableSourceType,
  name: string,
): DeployableSourceContent | null {
  if (type !== "hotspot") return null;
  const source = listDeployableSources().find(item => item.name === name);
  if (!source) return null;

  const relativeName = name.replaceAll("\\", "/");
  const absoluteName = path.resolve(HOTSPOT_ROOT, relativeName);
  if (!absoluteName.startsWith(`${HOTSPOT_ROOT}${path.sep}`) || !existsSync(absoluteName)) return null;

  return {
    source: { ...source, size: statSync(absoluteName).size },
    content: readFileSync(absoluteName),
  };
}