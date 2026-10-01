export type RouterDiagnosticRow = Record<string, string>;

type HotspotServerSummary = {
  name: string;
  interface: string | null;
  profile: string | null;
  addressPool: string | null;
  disabled: string | null;
};

type HotspotProfileSummary = {
  name: string;
  htmlDirectory: string | null;
  dnsName: string | null;
  hotspotAddress: string | null;
  loginBy: string | null;
};

function value(row: RouterDiagnosticRow | undefined, key: string): string | null {
  const result = String(row?.[key] ?? "").trim();
  return result || null;
}

function normalizePath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

export function summarizeVlanHotspotDiagnostics(input: {
  expectedServerName: string;
  expectedProfileName: string;
  expectedDirectory: string;
  storedDnsName: string | null;
  servers: RouterDiagnosticRow[];
  profiles: RouterDiagnosticRow[];
  files: RouterDiagnosticRow[];
  hosts: RouterDiagnosticRow[];
}): {
  expected: {
    serverName: string;
    profileName: string;
    htmlDirectory: string;
    storedDnsName: string | null;
    portalFiles: string[];
  };
  servers: HotspotServerSummary[];
  selectedServer: HotspotServerSummary | null;
  profiles: HotspotProfileSummary[];
  selectedProfile: HotspotProfileSummary | null;
  expectedProfile: HotspotProfileSummary | null;
  portalFiles: string[];
  missingExpectedPortalFiles: string[];
  hostCountsByServer: { server: string; count: number }[];
} {
  const expectedDirectory = normalizePath(input.expectedDirectory);
  const expectedPortalFiles = [
    `${expectedDirectory}/login.html`,
    `${expectedDirectory}/rlogin.html`,
  ];
  const servers = input.servers
    .map(row => ({
      name: value(row, "name") ?? "",
      interface: value(row, "interface"),
      profile: value(row, "profile"),
      addressPool: value(row, "address-pool"),
      disabled: value(row, "disabled"),
    }))
    .filter(row => row.name);
  const selectedServer = servers.find(row => row.name === input.expectedServerName) ?? null;

  const profileNames = new Set([
    input.expectedProfileName,
    ...servers.map(row => row.profile).filter((name): name is string => Boolean(name)),
  ]);
  const profiles = input.profiles
    .map(row => ({
      name: value(row, "name") ?? "",
      htmlDirectory: value(row, "html-directory"),
      dnsName: value(row, "dns-name"),
      hotspotAddress: value(row, "hotspot-address"),
      loginBy: value(row, "login-by"),
    }))
    .filter(row => row.name && profileNames.has(row.name));
  const selectedProfile = selectedServer?.profile
    ? profiles.find(row => row.name === selectedServer.profile) ?? null
    : null;
  const expectedProfile = profiles.find(row => row.name === input.expectedProfileName) ?? null;

  const relevantDirectories = new Set(
    [
      expectedDirectory,
      ...profiles.map(profile => normalizePath(profile.htmlDirectory || "hotspot")),
    ].map(path => path.toLowerCase()),
  );
  const allFileNames = input.files
    .map(row => normalizePath(value(row, "name") ?? ""))
    .filter(Boolean);
  const portalFiles = [...new Set(allFileNames.filter(fileName => {
    const separator = fileName.lastIndexOf("/");
    if (separator < 0) return false;
    const directory = fileName.slice(0, separator).toLowerCase();
    const basename = fileName.slice(separator + 1).toLowerCase();
    return relevantDirectories.has(directory)
      && (basename === "login.html" || basename === "rlogin.html");
  }))].sort((left, right) => left.localeCompare(right));
  const existingFileNames = new Set(allFileNames.map(name => name.toLowerCase()));
  const missingExpectedPortalFiles = expectedPortalFiles
    .filter(name => !existingFileNames.has(name.toLowerCase()));

  const hostCounts = new Map<string, number>();
  for (const row of input.hosts) {
    const server = value(row, "server");
    if (server) hostCounts.set(server, (hostCounts.get(server) ?? 0) + 1);
  }

  return {
    expected: {
      serverName: input.expectedServerName,
      profileName: input.expectedProfileName,
      htmlDirectory: expectedDirectory,
      storedDnsName: input.storedDnsName,
      portalFiles: expectedPortalFiles,
    },
    servers,
    selectedServer,
    profiles,
    selectedProfile,
    expectedProfile,
    portalFiles,
    missingExpectedPortalFiles,
    hostCountsByServer: [...hostCounts.entries()]
      .map(([server, count]) => ({ server, count }))
      .sort((left, right) => left.server.localeCompare(right.server)),
  };
}