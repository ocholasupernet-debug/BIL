type RouterHotspotServer = Record<string, unknown>;
type RouterHotspotProfile = Record<string, unknown>;

const PRIMARY_HOTSPOT_DIRECTORIES = new Set([
  "hotspot",
  "flash/hotspot",
  "disk1/hotspot",
]);

export interface PrimaryHotspotProfileCandidate {
  serverName: string;
  interfaceName: string;
  profileName: string;
  profileId: string;
  htmlDirectory: string;
}

export interface ActiveHotspotProfileTarget {
  serverName: string;
  interfaceName: string;
  profileName: string;
  profileId: string | null;
  htmlDirectory: string | null;
}

function normalizeHtmlDirectory(value: unknown): string {
  return String(value ?? "hotspot")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "") || "hotspot";
}

export function listActiveHotspotProfileTargets(
  serverRows: unknown,
  profileRows: unknown,
): ActiveHotspotProfileTarget[] {
  const profiles = new Map<string, RouterHotspotProfile>();
  for (const row of Array.isArray(profileRows) ? profileRows : []) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const profile = row as RouterHotspotProfile;
    const name = String(profile.name ?? "").trim();
    if (name) profiles.set(name, profile);
  }

  const targets: ActiveHotspotProfileTarget[] = [];
  for (const row of Array.isArray(serverRows) ? serverRows : []) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const server = row as RouterHotspotServer;
    const interfaceName = String(server.interface ?? "").trim();
    if (!interfaceName || /^(?:true|yes)$/i.test(String(server.disabled ?? "").trim())) continue;

    const profileName = String(server.profile ?? "").trim();
    const profile = profiles.get(profileName);
    const profileId = String(profile?.[".id"] ?? "").trim();
    targets.push({
      serverName: String(server.name ?? "").trim(),
      interfaceName,
      profileName,
      profileId: profileId || null,
      htmlDirectory: profile ? normalizeHtmlDirectory(profile["html-directory"]) : null,
    });
  }
  return targets;
}

export function selectUniquePrimaryHotspotProfile(
  serverRows: unknown,
  profileRows: unknown,
): {
  candidates: PrimaryHotspotProfileCandidate[];
  selected: PrimaryHotspotProfileCandidate | null;
} {
  const candidates = listActiveHotspotProfileTargets(serverRows, profileRows)
    .flatMap((target): PrimaryHotspotProfileCandidate[] => {
      if (
        !target.profileId
        || !target.htmlDirectory
        || !PRIMARY_HOTSPOT_DIRECTORIES.has(target.htmlDirectory.toLowerCase())
      ) return [];
      return [{
        ...target,
        profileId: target.profileId,
        htmlDirectory: target.htmlDirectory,
      }];
    });

  return {
    candidates,
    selected: candidates.length === 1 ? candidates[0] : null,
  };
}

export type HotspotPortalPreflightStatus =
  | "already_root_hotspot"
  | "uses_flash_root"
  | "uses_disk1_root"
  | "ambiguous_root_profiles"
  | "no_active_hotspot_service"
  | "active_profile_unresolved"
  | "isolated_service_only"
  | "other_directory";

export interface HotspotPortalPreflightSummary {
  status: HotspotPortalPreflightStatus;
  primaryProfileCount: number;
  rootPortalFiles: { login: boolean; redirectLogin: boolean };
  services: Array<ActiveHotspotProfileTarget & {
    login: boolean;
    redirectLogin: boolean;
    isolatedServiceDirectory: boolean;
  }>;
}

export function summarizeHotspotPortalPreflight(
  serverRows: unknown,
  profileRows: unknown,
  fileNames: unknown,
): HotspotPortalPreflightSummary {
  const normalizePath = (value: unknown) => String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
  const knownFiles = new Set(
    (Array.isArray(fileNames) ? fileNames : [])
      .map(normalizePath)
      .filter(Boolean),
  );
  const fileExists = (directory: string | null, fileName: string): boolean =>
    Boolean(directory && knownFiles.has(`${normalizePath(directory)}/${fileName.toLowerCase()}`));
  const activeTargets = listActiveHotspotProfileTargets(serverRows, profileRows);
  const primary = selectUniquePrimaryHotspotProfile(serverRows, profileRows);
  const nestedPaths = activeTargets.map(target => target.htmlDirectory?.toLowerCase() ?? "");
  const onlyNestedServicePaths = nestedPaths.length > 0
    && nestedPaths.every(directory => directory.startsWith("flash/hotspot/"));

  let status: HotspotPortalPreflightStatus;
  if (primary.candidates.length > 1) {
    status = "ambiguous_root_profiles";
  } else if (primary.candidates.length === 1) {
    const directory = primary.candidates[0].htmlDirectory.toLowerCase();
    status = directory === "hotspot"
      ? "already_root_hotspot"
      : directory === "flash/hotspot"
        ? "uses_flash_root"
        : "uses_disk1_root";
  } else if (activeTargets.length === 0) {
    status = "no_active_hotspot_service";
  } else if (activeTargets.some(target => !target.profileId || !target.htmlDirectory)) {
    status = "active_profile_unresolved";
  } else if (onlyNestedServicePaths) {
    status = "isolated_service_only";
  } else {
    status = "other_directory";
  }

  return {
    status,
    primaryProfileCount: primary.candidates.length,
    rootPortalFiles: {
      login: fileExists("hotspot", "login.html"),
      redirectLogin: fileExists("hotspot", "rlogin.html"),
    },
    services: activeTargets.map(target => ({
      ...target,
      login: fileExists(target.htmlDirectory, "login.html"),
      redirectLogin: fileExists(target.htmlDirectory, "rlogin.html"),
      isolatedServiceDirectory: Boolean(target.htmlDirectory?.toLowerCase().startsWith("flash/hotspot/")),
    })),
  };
}

export function selectUniqueActiveHotspotServer(
  rows: unknown,
  requestedInterface?: string,
): {
  activeServers: RouterHotspotServer[];
  candidates: RouterHotspotServer[];
  selected: RouterHotspotServer | null;
} {
  const activeServers = (Array.isArray(rows) ? rows : []).filter((row): row is RouterHotspotServer => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const interfaceName = String(row.interface ?? "").trim();
    const disabled = /^(?:true|yes)$/i.test(String(row.disabled ?? "").trim());
    return Boolean(interfaceName) && !disabled;
  });
  const candidates = requestedInterface
    ? activeServers.filter(row => String(row.interface ?? "").trim() === requestedInterface)
    : activeServers;

  return {
    activeServers,
    candidates,
    selected: candidates.length === 1 ? candidates[0] : null,
  };
}