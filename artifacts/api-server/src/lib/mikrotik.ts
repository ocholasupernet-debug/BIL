(profileRows) ? profileRows : []).map(r => ({
      id:               r[".id"]                  ?? "",
      name:             r.name                    ?? "",
      wpa2PreSharedKey: r["wpa2-pre-shared-key"]  ?? "",
      authentication:   r["authentication-types"]  ?? "",
    }));

    return { interfaces, profiles };
  });
}

export async function setWirelessInterface(
  creds: RouterCredentials,
  interfaceId: string,
  params: { ssid?: string }
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const cmd: string[] = ["/interface/wireless/set", `=.id=${interfaceId}`];
    if (params.ssid !== undefined) cmd.push(`=ssid=${params.ssid}`);
    await withTimeout(conn.write(cmd), ms);
  });
}

export async function setWirelessSecurityProfile(
  creds: RouterCredentials,
  profileId: string,
  params: { password?: string }
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const cmd: string[] = ["/interface/wireless/security-profiles/set", `=.id=${profileId}`];
    if (params.password !== undefined) cmd.push(`=wpa2-pre-shared-key=${params.password}`);
    await withTimeout(conn.write(cmd), ms);
  });
}

export async function fetchPPPoEActive(
  creds: RouterCredentials
): Promise<ActivePPPoESession[]> {
  return withConn(creds, async (conn) => {
    const requestMs = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(
      conn.write(["/ppp/active/print"]),
      requestMs
    )) as Record<string, string>[];
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id:       r[".id"]        ?? "",
      name:     r.name          ?? "",
      address:  r.address       ?? "",
      uptime:   r.uptime        ?? "",
      bytesIn:  parseBytes(r["bytes-in"]),
      bytesOut: parseBytes(r["bytes-out"]),
      service:  r.service       ?? "",
    }));
  });
}

/* ══ PPP Secrets ═══════════════════════════════════════════════════════════ */
export interface PPPSecret {
  id: string;
  name: string;
  password: string;
  service: string;
  profile: string;
  localAddress: string;
  remoteAddress: string;
  disabled: boolean;
  comment: string;
}

export async function fetchPPPSecrets(creds: RouterCredentials): Promise<PPPSecret[]> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(conn.write(["/ppp/secret/print"]), ms)) as Record<string, string>[];
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id:            r[".id"]              ?? "",
      name:          r.name               ?? "",
      password:      r.password           ?? "",
      service:       r.service            ?? "any",
      profile:       r.profile            ?? "default",
      localAddress:  r["local-address"]   ?? "",
      remoteAddress: r["remote-address"]  ?? "",
      disabled:      parseBool(r.disabled),
      comment:       r.comment            ?? "",
    }));
  });
}

export async function addPPPSecret(
  creds: RouterCredentials,
  opts: {
    name: string; password: string; profile?: string; service?: string; comment?: string;
    localAddress?: string; remoteAddress?: string;
  }
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const params = [
      "/ppp/secret/add",
      `=name=${opts.name}`,
      `=password=${opts.password}`,
      `=service=${opts.service ?? "any"}`,
      `=profile=${opts.profile ?? "default"}`,
    ];
    if (opts.comment)        params.push(`=comment=${opts.comment}`);
    if (opts.localAddress)   params.push(`=local-address=${opts.localAddress}`);
    if (opts.remoteAddress)  params.push(`=remote-address=${opts.remoteAddress}`);
    await withTimeout(conn.write(params), ms);
  });
}

export async function removePPPSecret(creds: RouterCredentials, id: string): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    await withTimeout(conn.write(["/ppp/secret/remove", `=.id=${id}`]), ms);
  });
}

export async function removePPPSecretByName(creds: RouterCredentials, username: string): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(conn.write(["/ppp/secret/print", `?name=${username}`]), ms)) as Record<string, string>[];
    for (const r of (Array.isArray(rows) ? rows : [])) {
      const id = r[".id"];
      if (id) await withTimeout(conn.write(["/ppp/secret/remove", `=.id=${id}`]), ms);
    }
  });
}

export async function updatePPPSecret(
  creds: RouterCredentials,
  id: string,
  fields: {
    name?: string; password?: string; profile?: string; disabled?: boolean; comment?: string;
    service?: string; localAddress?: string; remoteAddress?: string;
  }
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const params: string[] = ["/ppp/secret/set", `=.id=${id}`];
    if (fields.name          !== undefined) params.push(`=name=${fields.name}`);
    if (fields.password      !== undefined) params.push(`=password=${fields.password}`);
    if (fields.profile       !== undefined) params.push(`=profile=${fields.profile}`);
    if (fields.disabled      !== undefined) params.push(`=disabled=${fields.disabled ? "yes" : "no"}`);
    if (fields.comment       !== undefined) params.push(`=comment=${fields.comment}`);
    if (fields.service       !== undefined) params.push(`=service=${fields.service}`);
    if (fields.localAddress  !== undefined) params.push(`=local-address=${fields.localAddress}`);
    if (fields.remoteAddress !== undefined) params.push(`=remote-address=${fields.remoteAddress}`);
    await withTimeout(conn.write(params), ms);
  });
}

export async function changePPPSecretName(
  creds: RouterCredentials,
  fromName: string,
  toName: string,
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(conn.write(["/ppp/secret/print", `?name=${fromName}`]), ms)) as Record<string, string>[];
    const id = rows[0]?.[".id"];
    if (!id) throw new Error(`PPP secret '${fromName}' not found`);
    await withTimeout(conn.write(["/ppp/secret/set", `=.id=${id}`, `=name=${toName}`]), ms);
    await disconnectPPPActiveByName(creds, fromName).catch(() => {});
  });
}

export async function disconnectPPPActive(creds: RouterCredentials, id: string): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    await withTimeout(conn.write(["/ppp/active/remove", `=.id=${id}`]), ms);
  });
}

export async function disconnectPPPActiveByName(creds: RouterCredentials, username: string): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(conn.write(["/ppp/active/print", `?name=${username}`]), ms)) as Record<string, string>[];
    const id = rows[0]?.[".id"];
    if (id) await withTimeout(conn.write(["/ppp/active/remove", `=.id=${id}`]), ms);
  });
}

export async function isPPPUserOnline(
  creds: RouterCredentials,
  username: string,
): Promise<boolean> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(conn.write(["/ppp/active/print", `?name=${username}`]), ms)) as Record<string, string>[];
    return rows.length > 0 && !!rows[0]?.[".id"];
  });
}

/* ══ PPP Profiles ══════════════════════════════════════════════════════════ */
export interface PPPProfile {
  id: string;
  name: string;
  localAddress: string;
  remoteAddress: string;
  rateLimit: string;
  sessionTimeout: string;
  idleTimeout: string;
  comment: string;
}

export async function fetchPPPProfiles(creds: RouterCredentials): Promise<PPPProfile[]> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(conn.write(["/ppp/profile/print"]), ms)) as Record<string, string>[];
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id:             r[".id"]              ?? "",
      name:           r.name               ?? "",
      localAddress:   r["local-address"]   ?? "",
      remoteAddress:  r["remote-address"]  ?? "",
      rateLimit:      r["rate-limit"]      ?? "",
      sessionTimeout: r["session-timeout"] ?? "",
      idleTimeout:    r["idle-timeout"]    ?? "",
      comment:        r.comment            ?? "",
    }));
  });
}

export async function addPPPProfile(
  creds: RouterCredentials,
  opts: {
    name: string; localAddress?: string; remoteAddress?: string;
    rateLimit?: string; onUp?: string; onDown?: string;
  },
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const params = ["/ppp/profile/add", `=name=${opts.name}`];
    if (opts.localAddress)  params.push(`=local-address=${opts.localAddress}`);
    if (opts.remoteAddress) params.push(`=remote-address=${opts.remoteAddress}`);
    if (opts.rateLimit)     params.push(`=rate-limit=${opts.rateLimit}`);
    if (opts.onUp)          params.push(`=on-up=${opts.onUp}`);
    if (opts.onDown)        params.push(`=on-down=${opts.onDown}`);
    await withTimeout(conn.write(params), ms);
  });
}

export async function updatePPPProfile(
  creds: RouterCredentials,
  name: string,
  fields: {
    newName?: string; localAddress?: string; remoteAddress?: string;
    rateLimit?: string; onUp?: string; onDown?: string;
  },
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(conn.write(["/ppp/profile/print", `?name=${name}`]), ms)) as Record<string, string>[];
    const id = rows[0]?.[".id"];
    if (!id) throw new Error(`PPP profile '${name}' not found`);
    const params: string[] = ["/ppp/profile/set", `=.id=${id}`];
    if (fields.newName       !== undefined) params.push(`=name=${fields.newName}`);
    if (fields.localAddress  !== undefined) params.push(`=local-address=${fields.localAddress}`);
    if (fields.remoteAddress !== undefined) params.push(`=remote-address=${fields.remoteAddress}`);
    if (fields.rateLimit     !== undefined) params.push(`=rate-limit=${fields.rateLimit}`);
    if (fields.onUp          !== undefined) params.push(`=on-up=${fields.onUp}`);
    if (fields.onDown        !== undefined) params.push(`=on-down=${fields.onDown}`);
    await withTimeout(conn.write(params), ms);
  });
}

export async function removePPPProfile(
  creds: RouterCredentials,
  name: string,
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(conn.write(["/ppp/profile/print", `?name=${name}`]), ms)) as Record<string, string>[];
    const id = rows[0]?.[".id"];
    if (id) await withTimeout(conn.write(["/ppp/profile/remove", `=.id=${id}`]), ms);
  });
}

/* ══ IP Pool CRUD ═════════════════════════════════════════════════════════ */
export interface IpPool {
  id: string;
  name: string;
  ranges: string;
  comment: string;
}

export async function fetchIpPools(creds: RouterCredentials): Promise<IpPool[]> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(conn.write(["/ip/pool/print"]), ms)) as Record<string, string>[];
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id:      r[".id"]   ?? "",
      name:    r.name     ?? "",
      ranges:  r.ranges   ?? "",
      comment: r.comment  ?? "",
    }));
  });
}

export async function addIpPool(
  creds: RouterCredentials,
  opts: { name: string; ranges: string; comment?: string },
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const params = ["/ip/pool/add", `=name=${opts.name}`, `=ranges=${opts.ranges}`];
    if (opts.comment) params.push(`=comment=${opts.comment}`);
    await withTimeout(conn.write(params), ms);
  });
}

export async function updateIpPool(
  creds: RouterCredentials,
  name: string,
  fields: { newName?: string; ranges?: string; comment?: string },
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(conn.write(["/ip/pool/print", `?name=${name}`]), ms)) as Record<string, string>[];
    const id = rows[0]?.[".id"];
    if (!id) throw new Error(`IP pool '${name}' not found`);
    const params: string[] = ["/ip/pool/set", `=.id=${id}`];
    if (fields.newName  !== undefined) params.push(`=name=${fields.newName}`);
    if (fields.ranges   !== undefined) params.push(`=ranges=${fields.ranges}`);
    if (fields.comment  !== undefined) params.push(`=comment=${fields.comment}`);
    await withTimeout(conn.write(params), ms);
  });
}

export async function removeIpPool(
  creds: RouterCredentials,
  name: string,
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(conn.write(["/ip/pool/print", `?name=${name}`]), ms)) as Record<string, string>[];
    const id = rows[0]?.[".id"];
    if (id) await withTimeout(conn.write(["/ip/pool/remove", `=.id=${id}`]), ms);
  });
}

/* ══ Firewall Address List ════════════════════════════════════════════════ */
export async function addIpToAddressList(
  creds: RouterCredentials,
  opts: { address: string; list: string; comment?: string },
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const params = [
      "/ip/firewall/address-list/add",
      `=address=${opts.address}`,
      `=list=${opts.list}`,
    ];
    if (opts.comment) params.push(`=comment=${opts.comment}`);
    await withTimeout(conn.write(params), ms);
  });
}

export async function removeIpFromAddressList(
  creds: RouterCredentials,
  address: string,
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(conn.write(["/ip/firewall/address-list/print", `?address=${address}`]), ms)) as Record<string, string>[];
    for (const r of (Array.isArray(rows) ? rows : [])) {
      const id = r[".id"];
      if (id) await withTimeout(conn.write(["/ip/firewall/address-list/remove", `=.id=${id}`]), ms);
    }
  });
}

/* ══ NAT Rules (VPN port forwarding) ═════════════════════════════════════ */
export async function addDstNatRule(
  creds: RouterCredentials,
  opts: {
    dstAddress: string; dstPort: string; protocol?: string;
    toAddresses: string; toPorts: string; comment?: string;
  },
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const params = [
      "/ip/firewall/nat/add",
      "=chain=dstnat",
      `=protocol=${opts.protocol ?? "tcp"}`,
      `=dst-port=${opts.dstPort}`,
      "=action=dst-nat",
      `=to-addresses=${opts.toAddresses}`,
      `=to-ports=${opts.toPorts}`,
      `=dst-address=${opts.dstAddress}`,
    ];
    if (opts.comment) params.push(`=comment=${opts.comment}`);
    await withTimeout(conn.write(params), ms);
  });
}

export async function removeDstNatByAddress(
  creds: RouterCredentials,
  toAddress: string,
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(conn.write(["/ip/firewall/nat/print", `?to-addresses=${toAddress}`]), ms)) as Record<string, string>[];
    for (const r of (Array.isArray(rows) ? rows : [])) {
      const id = r[".id"];
      if (id) await withTimeout(conn.write(["/ip/firewall/nat/remove", `=.id=${id}`]), ms);
    }
  });
}

export async function fetchInterfaces(
  creds: RouterCredentials
): Promise<RouterInterface[]> {
  return withConn(creds, async (conn) => {
    const requestMs = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(
      conn.write(["/interface/print"]),
      requestMs
    )) as Record<string, string>[];
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id:         r[".id"]         ?? "",
      name:       r.name           ?? "",
      type:       r.type           ?? "",
      running:    parseBool(r.running),
      disabled:   parseBool(r.disabled),
      macAddress: r["mac-address"] ?? "",
      comment:    r.comment        ?? "",
      txBps:      parseBytes(r["tx-byte"]),
      rxBps:      parseBytes(r["rx-byte"]),
    }));
  });
}

export async function fetchTraffic(
  creds: RouterCredentials,
  interfaces: string[] = []
): Promise<TrafficStats[]> {
  return withConn(creds, async (conn) => {
    const requestMs = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;

    let ifaceNames = interfaces;
    if (ifaceNames.length === 0) {
      const rows = (await withTimeout(
        conn.write(["/interface/print"]),
        requestMs
      )) as Record<string, string>[];
      ifaceNames = (Array.isArray(rows) ? rows : [])
        .filter((r) => parseBool(r.running) && !parseBool(r.disabled))
        .map((r) => r.name)
        .filter(Boolean)
        .slice(0, 8);
    }

    if (ifaceNames.length === 0) return [];

    const samples = (await withTimeout(
      conn.write([
        "/interface/monitor-traffic",
        `=interface=${ifaceNames.join(",")}`,
        "=once=",
      ]),
      requestMs
    )) as Record<string, string>[];

    return (Array.isArray(samples) ? samples : []).map((s, i) => ({
      iface:           s.name             ?? ifaceNames[i] ?? `iface${i}`,
      rxBitsPerSecond: parseBytes(s["rx-bits-per-second"]),
      txBitsPerSecond: parseBytes(s["tx-bits-per-second"]),
    }));
  });
}

/* ─── Combined fetch ─────────────────────────────────────────────────────── */

export async function fetchRouterLiveData(
  creds: RouterCredentials
): Promise<RouterLiveData> {
  const usingSSL = creds.useSSL ?? creds.port === 8729;

  /* Share a single connection across all queries for efficiency */
  const { conn, connectedHost } = await connectWithRetry(creds);
  const requestMs = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;

  try {
    /* Hotspot users */
    const hotspotRows = await withTimeout(
      conn.write(["/ip/hotspot/active/print"]),
      requestMs
    ).catch(e => { logger.warn({ err: e.message }, "hotspot fetch failed"); return [] as Record<string, string>[]; });

    /* PPPoE sessions */
    const pppoeRows = await withTimeout(
      conn.write(["/ppp/active/print"]),
      requestMs
    ).catch(e => { logger.warn({ err: e.message }, "pppoe fetch failed"); return [] as Record<string, string>[]; });

    /* Interfaces */
    const ifaceRows = await withTimeout(
      conn.write(["/interface/print"]),
      requestMs
    ).catch(e => { logger.warn({ err: e.message }, "interface fetch failed"); return [] as Record<string, string>[]; });

    const interfaces: RouterInterface[] = (Array.isArray(ifaceRows) ? ifaceRows : []).map(r => ({
      id:         r[".id"]         ?? "",
      name:       r.name           ?? "",
      type:       r.type           ?? "",
      running:    parseBool(r.running),
      disabled:   parseBool(r.disabled),
      macAddress: r["mac-address"] ?? "",
      comment:    r.comment        ?? "",
      txBps:      parseBytes(r["tx-byte"]),
      rxBps:      parseBytes(r["rx-byte"]),
    }));

    /* Traffic — reuse the connection, only sample running interfaces */
    const runningIfaces = interfaces
      .filter(i => i.running && !i.disabled)
      .map(i => i.name)
      .slice(0, 8);

    let traffic: TrafficStats[] = [];
    if (runningIfaces.length > 0) {
      const samples = await withTimeout(
        conn.write([
          "/interface/monitor-traffic",
          `=interface=${runningIfaces.join(",")}`,
          "=once=",
        ]),
        requestMs
      ).catch(e => { logger.warn({ err: e.message }, "traffic fetch failed"); return [] as Record<string, string>[]; });

      traffic = (Array.isArray(samples) ? samples : []).map((s, i) => ({
        iface:           s.name             ?? runningIfaces[i] ?? `iface${i}`,
        rxBitsPerSecond: parseBytes(s["rx-bits-per-second"]),
        txBitsPerSecond: parseBytes(s["tx-bits-per-second"]),
      }));
    }

    return {
      hotspotUsers: (Array.isArray(hotspotRows) ? hotspotRows : []).map(r => ({
        id:         r[".id"]         ?? "",
        user:       r.user           ?? "",
        address:    r.address        ?? "",
        macAddress: r["mac-address"] ?? "",
        uptime:     r.uptime         ?? "",
        bytesIn:    parseBytes(r["bytes-in"]),
        bytesOut:   parseBytes(r["bytes-out"]),
        server:     r.server         ?? "",
      })),
      pppoeUsers: (Array.isArray(pppoeRows) ? pppoeRows : []).map(r => ({
        id:       r[".id"]        ?? "",
        name:     r.name          ?? "",
        address:  r.address       ?? "",
        uptime:   r.uptime        ?? "",
        bytesIn:  parseBytes(r["bytes-in"]),
        bytesOut: parseBytes(r["bytes-out"]),
        service:  r.service       ?? "",
      })),
      interfaces,
      traffic,
      fetchedAt: new Date().toISOString(),
      usingSSL,
      connectedHost,
    };
  } finally {
    try { conn.close(); } catch { /* ignore */ }
  }
}

/* ─── Connection test ────────────────────────────────────────────────────── */

export interface ConnectionTestResult {
  ok: boolean;
  connectedHost: string;
  method: "public-ip" | "vpn-tunnel" | "failed";
  latencyMs: number;
  usingSSL: boolean;
  error?: string;
  warnings: string[];
  /**
   * Per-host TCP port probe results — run BEFORE the RouterOS API login.
   * Tells you immediately if a host is blocked by firewall/NAT.
   */
  portProbes: PortProbeResult[];
  /** Bridge interfaces detected from the router (name list) */
  bridgeInterfaces?: string[];
  /** Best candidate bridge interface (prefers "hotspot-bridge", then first found) */
  detectedBridgeInterface?: string;
  /** Router identity / model info detected during test */
  routerIdentity?: string;
  rosVersion?: string;
}

/* ─── Detect bridge interfaces from a live MikroTik router ──────────────── */
export async function detectBridgeInterfaces(
  creds: RouterCredentials
): Promise<{ bridgeInterfaces: string[]; detectedBridgeInterface: string | null }> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(
      conn.write(["/interface/bridge/print"]),
      ms
    )) as Record<string, string>[];
    const names = rows.map(r => r.name).filter(Boolean);
    const best =
      names.find(n => n === "hotspot-bridge") ??
      names.find(n => n.toLowerCase().includes("hotspot")) ??
      names.find(n => n.toLowerCase().includes("bridge")) ??
      names[0] ??
      null;
    return { bridgeInterfaces: names, detectedBridgeInterface: best };
  });
}

export async function testConnection(
  creds: RouterCredentials
): Promise<ConnectionTestResult> {
  const warnings: string[] = [];

  if (creds.host && isPrivateIp(creds.host)) {
    warnings.push(
      `Host ${creds.host} is a private/local IP. This will only work if the VPS ` +
      `is on the same LAN. For remote access, use the router's public IP or ` +
      `configure a VPN tunnel and set bridge_ip.`
    );
  }
  if (!creds.host && creds.bridgeIp) {
    warnings.push(
      `No public host configured — will attempt via VPN tunnel IP ${creds.bridgeIp} only.`
    );
  }

  /* Run port probes on ALL hosts in parallel FIRST — fast fail before API attempt */
  const probeMs    = Math.min(creds.connectTimeoutMs ?? DEFAULT_CONNECT_MS, 6000);
  const portProbes = await probeAllHosts(creds, probeMs);

  /* Log the probe summary */
  for (const p of portProbes) {
    if (p.reachable) {
      logger.info(
        { host: p.host, port: p.port, latencyMs: p.latencyMs },
        "Port probe: OPEN"
      );
    } else {
      logger.warn(
        { host: p.host, port: p.port, error: p.error, diagnosis: p.diagnosis },
        "Port probe: BLOCKED"
      );
      warnings.push(`${p.host}:${p.port} — ${p.diagnosis ?? p.error ?? "unreachable"}`);
    }
  }

  const anyPortOpen = portProbes.some(p => p.reachable);
  if (!anyPortOpen && portProbes.length > 0) {
    /* All hosts blocked — skip RouterOS API attempt entirely */
    const totalMs = portProbes.reduce((s, p) => s + p.latencyMs, 0);
    return {
      ok:            false,
      connectedHost: "",
      method:        "failed",
      latencyMs:     totalMs,
      usingSSL:      creds.useSSL ?? creds.port === 8729,
      error:
        `API port ${creds.port} is not reachable on any configured host. ` +
        `Check firewall rules, NAT port-forwarding, and that the API service ` +
        `is enabled on the router (/ip service enable api).`,
      warnings,
      portProbes,
    };
  }

  /* Port(s) open — now try the full RouterOS API handshake */
  const start = Date.now();
  try {
    const { conn, connectedHost } = await connectWithRetry(creds);
    const latencyMs = Date.now() - start;
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;

    /* Fetch identity, resource info, and bridge interfaces in parallel */
    let routerIdentity: string | undefined;
    let rosVersion: string | undefined;
    let bridgeInterfaces: string[] = [];
    let detectedBridgeInterface: string | undefined;
    try {
      const [identRows, resRows, bridgeRows] = await Promise.all([
        withTimeout(conn.write(["/system/identity/print"]), ms) as Promise<Record<string, string>[]>,
        withTimeout(conn.write(["/system/resource/print"]), ms) as Promise<Record<string, string>[]>,
        withTimeout(conn.write(["/interface/bridge/print"]), ms) as Promise<Record<string, string>[]>,
      ]);
      routerIdentity = identRows[0]?.name;
      rosVersion     = resRows[0]?.version;
      bridgeInterfaces = bridgeRows.map(r => r.name).filter(Boolean);
      detectedBridgeInterface =
        bridgeInterfaces.find(n => n === "hotspot-bridge") ??
        bridgeInterfaces.find(n => n.toLowerCase().includes("hotspot")) ??
        bridgeInterfaces.find(n => n.toLowerCase().includes("bridge")) ??
        bridgeInterfaces[0];
    } catch { /* enrichment failure is non-fatal */ }

    try { conn.close(); } catch { /* ignore */ }
    const method: ConnectionTestResult["method"] =
      connectedHost === creds.bridgeIp ? "vpn-tunnel" : "public-ip";
    return {
      ok: true,
      connectedHost,
      method,
      latencyMs,
      usingSSL:   creds.useSSL ?? creds.port === 8729,
      warnings,
      portProbes,
      routerIdentity,
      rosVersion,
      bridgeInterfaces,
      detectedBridgeInterface,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok:            false,
      connectedHost: "",
      method:        "failed",
      latencyMs:     Date.now() - start,
      usingSSL:      creds.useSSL ?? creds.port === 8729,
      error:         msg,
      warnings,
      portProbes,
    };
  }
}

/* ─── OpenVPN setup script generator ────────────────────────────────────── */

export interface VpnSetupOptions {
  /** Public IP or hostname of the router (used for VPN endpoint) */
  routerPublicIp: string;
  /** VPS public IP — used to restrict who can connect via OVPN */
  vpsIp?: string;
  /** OpenVPN port on the router (default: 1194) */
  vpnPort?: number;
  /** VPN user to create on the router */
  vpnUsername?: string;
  /** VPN user password */
  vpnPassword?: string;
  /** IP pool CIDR for VPN tunnel addresses (default: 192.168.89.0/24) */
  tunnelNetwork?: string;
  /** Router's LAN network — VPN clients get access to this (default: 192.168.88.0/24) */
  lanNetwork?: string;
  /** Router ID for comments/labelling */
  routerId?: number;
}

/**
 * Generates a MikroTik RouterOS script (.rsc) that:
 *  1. Creates an IP pool for VPN clients
 *  2. Creates a PPP profile for the VPN user
 *  3. Creates the VPN user (PPP secret) with username/password
 *  4. Enables and configures the OpenVPN server
 *  5. Adds firewall rules to allow OpenVPN and API access from the VPN tunnel
 *  6. Optionally restricts OVPN connections to the VPS IP only
 *
 * Paste or import this on the router terminal:
 *   /import ovpn-setup.rsc
 */
export function generateVpnSetupScript(opts: VpnSetupOptions): string {
  const {
    routerPublicIp,
    vpsIp,
    vpnPort      = 1194,
    vpnUsername  = "admin",
    vpnPassword  = "ochola",
    tunnelNetwork = "192.168.89",
    lanNetwork   = "192.168.88.0/24",
    routerId,
  } = opts;

  const routerGateway = `${tunnelNetwork}.1`;   /* router end of tunnel */
  const clientStart   = `${tunnelNetwork}.2`;   /* first client IP */
  const clientEnd     = `${tunnelNetwork}.10`;  /* last client IP */
  const tunnelNet     = `${tunnelNetwork}.0/24`;
  const tag           = routerId ? `ISP-${routerId}` : "ISP-OVPN";
  const vpsRestrict   = vpsIp
    ? `src-address=${vpsIp} `
    : "";
  const vpsNote       = vpsIp
    ? `# VPN access restricted to VPS IP: ${vpsIp}`
    : `# WARNING: OVPN port open to all IPs — set vpsIp to restrict access`;

  return `# ═══════════════════════════════════════════════════════════════
# OcholaSupernet — MikroTik OpenVPN Server Setup
# Generated : ${new Date().toISOString()}
# Router IP : ${routerPublicIp}
# VPN Port  : ${vpnPort}/tcp
# VPN User  : ${vpnUsername}  (password stored in PPP secrets)
# Tunnel    : ${tunnelNet}
# LAN Access: ${lanNetwork}
# ${vpsNote}
#
# USAGE: Paste into RouterOS terminal, or upload and run:
#          /import ovpn-setup-router${routerId ?? ""}.rsc
# ═══════════════════════════════════════════════════════════════

# ── Step 1: IP pool for VPN clients ─────────────────────────────────────────
/ip pool
add name=ovpn-pool ranges=${clientStart}-${clientEnd} comment="${tag}"

# ── Step 2: PPP profile for VPN sessions ────────────────────────────────────
/ppp profile
add name=ovpn-profile \\
    local-address=${routerGateway} \\
    remote-address=ovpn-pool \\
    use-compression=no \\
    use-encryption=yes \\
    use-upnp=no \\
    dns-server=8.8.8.8,1.1.1.1 \\
    comment="${tag}"

# ── Step 3: VPN user account (PPP secret) ───────────────────────────────────
# Password is stored in the router's PPP secrets — not in any config file.
/ppp secret
add name=${vpnUsername} \\
    password=${vpnPassword} \\
    profile=ovpn-profile \\
    service=ovpn \\
    local-address=${routerGateway} \\
    remote-address=${clientStart} \\
    comment="${tag} — default VPN/API admin (OcholaSupernet backend)"

# ── Step 4: OpenVPN server ───────────────────────────────────────────────────
# Requires a certificate. If you don't have one, generate a self-signed cert:
#   /certificate add name=ovpn-ca common-name=ovpn-ca key-usage=key-cert-sign,crl-sign
#   /certificate sign ovpn-ca
#   /certificate add name=ovpn-server common-name=${routerPublicIp}
#   /certificate sign ovpn-server ca=ovpn-ca
/interface ovpn-server server
set enabled=yes \\
    port=${vpnPort} \\
    mode=ip \\
    protocol=tcp \\
    auth=sha1 \\
    cipher=aes128,aes192,aes256 \\
    default-profile=ovpn-profile \\
    require-client-certificate=no \\
    certificate=none

# ── Step 5: Firewall rules ───────────────────────────────────────────────────
/ip firewall filter

# 5a. Allow OpenVPN connections (port ${vpnPort}) on WAN
add action=accept chain=input \\
    ${vpsRestrict}protocol=tcp dst-port=${vpnPort} \\
    in-interface-list=WAN \\
    comment="${tag}-allow-ovpn"

# 5b. Allow API access (8728 plain + 8729 SSL) from VPN tunnel
add action=accept chain=input \\
    src-address=${tunnelNet} \\
    protocol=tcp dst-port=8728,8729 \\
    comment="${tag}-api-from-vpn"

# 5c. Allow full LAN access from VPN tunnel (PPPoE/Hotspot management)
add action=accept chain=forward \\
    src-address=${tunnelNet} \\
    dst-address=${lanNetwork} \\
    comment="${tag}-lan-from-vpn"

# ── Step 6: Enable the API service (if not already) ─────────────────────────
/ip service
enable api
# enable api-ssl   # uncomment if you want encrypted API-SSL on port 8729

# ── Step 7: Route — allow VPN clients to reach the LAN ──────────────────────
# (Usually handled automatically; add only if your routing table needs it)
# /ip route add dst-address=${lanNetwork} gateway=${routerGateway}

# ── Verify ───────────────────────────────────────────────────────────────────
:log info "${tag}: OpenVPN server configured. User '${vpnUsername}' created."
:log info "${tag}: VPN clients will get IPs in ${tunnelNet}"
:log info "${tag}: API accessible at ${routerGateway}:8728 from VPN tunnel"
`;
}

/* ─── OpenVPN client config (.ovpn) generator ────────────────────────────── */

export interface OvpnClientOptions {
  /** Router's public IP or hostname — the VPN endpoint */
  routerPublicIp: string;
  /** OpenVPN port on the router (default: 1194) */
  vpnPort?: number;
  /** VPN username for auth-user-pass */
  vpnUsername?: string;
  /** VPN password — CAUTION: only embed in .ovpn for dev/testing;
   *  production setups should use a separate credentials file */
  vpnPassword?: string;
  /** Expected VPN tunnel IP the router will assign to this client */
  tunnelClientIp?: string;
  /** Router's LAN network to route through VPN (default: 192.168.88.0/24) */
  lanNetwork?: string;
  /** API port(s) to reach through the tunnel (informational, in comment) */
  apiPorts?: string;
  /** Whether to route ALL traffic through VPN (default: false = split tunnel) */
  routeAll?: boolean;
}

/**
 * Generates a .ovpn client configuration file for the VPS to connect
 * to the router's OpenVPN server.
 *
 * Save as /etc/openvpn/router-admin.ovpn on the VPS and run:
 *   openvpn --config /etc/openvpn/router-admin.ovpn --daemon
 */
export function generateOvpnClientConfig(opts: OvpnClientOptions): string {
  const {
    routerPublicIp,
    vpnPort        = 1194,
    vpnUsername    = "admin",
    vpnPassword    = "ochola",
    tunnelClientIp = "192.168.89.2",
    lanNetwork     = "192.168.88.0/24",
    apiPorts       = "8728, 8729",
    routeAll       = false,
  } = opts;

  /* LAN route: e.g. "192.168.88.0 255.255.255.0" */
  const [lanBase, lanPrefix] = lanNetwork.split("/");
  const lanMask = prefixToMask(parseInt(lanPrefix ?? "24", 10));

  return `# ═══════════════════════════════════════════════════════════════
# OcholaSupernet — VPS OpenVPN Client Configuration
# Generated  : ${new Date().toISOString()}
# Server     : ${routerPublicIp}:${vpnPort}/tcp
# VPN user   : ${vpnUsername}
# Tunnel IP  : ${tunnelClientIp}  (assigned by router)
# LAN access : ${lanNetwork}  (PPPoE/Hotspot management)
# API ports  : ${apiPorts}  (reachable at router tunnel IP after connect)
#
# USAGE on VPS:
#   1. Install OpenVPN:  apt install openvpn
#   2. Save this file:   /etc/openvpn/router-admin.ovpn
#   3. Create creds:     echo "${vpnUsername}\\n${vpnPassword}" > /etc/openvpn/router-creds.txt
#                        chmod 600 /etc/openvpn/router-creds.txt
#   4. Connect:          openvpn --config /etc/openvpn/router-admin.ovpn --daemon
#   5. Verify:           ip addr show tun0    # should show ${tunnelClientIp}
#                        ping 192.168.89.1    # ping router tunnel endpoint
#                        curl http://192.168.89.1:8728  # test API port
#
# ENVIRONMENT VARIABLE — set in OcholaSupernet backend:
#   MIKROTIK_BRIDGE_IP=${tunnelClientIp.replace(/\.\d+$/, ".1")}  # router's tunnel IP
#
# ── SECURITY NOTE ─────────────────────────────────────────────
# The credentials below are for DEVELOPMENT / initial setup only.
# In production, keep credentials in a separate file (see step 3 above)
# and remove the <auth-user-pass> inline block.
# ═══════════════════════════════════════════════════════════════

client
dev tun
proto tcp

# OpenVPN server endpoint
remote ${routerPublicIp} ${vpnPort}

resolv-retry infinite
nobind
persist-key
persist-tun

# Authentication
auth SHA1
cipher AES-128-CBC
auth-nocache

# Credentials — store in a separate file for production:
#   auth-user-pass /etc/openvpn/router-creds.txt
<auth-user-pass>
${vpnUsername}
${vpnPassword}
</auth-user-pass>

# MikroTik uses self-signed certs by default
tls-client
# If you configured a CA on the router, add:
# <ca>
# -----BEGIN CERTIFICATE-----
# ... paste router CA cert here ...
# -----END CERTIFICATE-----
# </ca>

# Disable cert verification for self-signed (remove in production with proper cert)
verify-x509-name none
# OR: ns-cert-type server   (for older RouterOS)

${routeAll
  ? `# Route ALL traffic through VPN
redirect-gateway def1`
  : `# Split tunnel — only route LAN traffic through VPN (recommended)
route-nopull
route ${lanBase} ${lanMask}
# Route to router tunnel subnet (auto-assigned by server, but explicit here for clarity)
route 192.168.89.0 255.255.255.0`}

# Logging
verb 3
log /var/log/openvpn-router.log
`;
}

/** Convert CIDR prefix length to dotted-decimal subnet mask */
function prefixToMask(prefix: number): string {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return [24, 16, 8, 0].map(s => (mask >> s) & 255).join(".");
}

/* ─── Router as OpenVPN CLIENT script generator ──────────────────────────── */

export interface RouterAsClientOptions {
  /** VPS public IP that is running the OpenVPN server */
  vpsPublicIp: string;
  /** OpenVPN server port on the VPS (default 1194) */
  vpnPort?: number;
  /** Username to authenticate with the VPS OVPN server */
  vpnUsername?: string;
  /** Password for the VPN user */
  vpnPassword?: string;
  /**
   * VPN tunnel IP the VPS server will assign to the router.
    * Depends on the VPS server's IP pool (default "10.8.5.2").
   */
  tunnelRouterIp?: string;
  /** VPS tunnel IP (gateway end, default "10.8.5.1") */
  tunnelVpsIp?: string;
  /** Router LAN network for routing rules (default "192.168.88.0/24") */
  lanNetwork?: string;
  /** Router ID for comment labels */
  routerId?: number;
}

export interface RouterWireGuardClientOptions {
  /** WireGuard endpoint hostname or IP address. */
  endpoint: string;
  /** WireGuard endpoint UDP port. */
  endpointPort?: number;
  /** Public key of the VPS WireGuard peer. */
  serverPublicKey: string;
  /** Private key assigned to this router on the VPS. */
  clientPrivateKey: string;
  /** Router address on the management WireGuard network. */
  tunnelRouterIp?: string;
  /** VPS address on the management WireGuard network. */
  tunnelVpsIp?: string;
  /** Router ID for comment labels. */
  routerId?: number;
}

export interface RouterIpsecClientOptions {
  /** IPsec peer hostname or IP address. */
  endpoint: string;
  /** Pre-shared key for the VPS IPsec peer. */
  preSharedKey: string;
  /** Local management address used by the IPsec policy. */
  tunnelRouterIp?: string;
  /** Remote management address used by the IPsec policy. */
  tunnelVpsIp?: string;
  /** Router ID for comment labels. */
  routerId?: number;
}

/**
 * Generates a MikroTik RouterOS script (.rsc) that configures the router
 * as an OpenVPN CLIENT connecting back to the VPS server.
 *
 * Architecture (correct for this setup):
  *   VPS  ──── OpenVPN SERVER (tun0 10.8.5.1) ◄──── MikroTik OVPN CLIENT (gets 10.8.5.2)
 *
 * After connect, the backend reaches the router API at:
  *   MIKROTIK_BRIDGE_IP=10.8.5.2  (router's tunnel IP)
 *
 * Import on the router:
 *   /import router-as-client.rsc
 */
export function generateRouterAsClientScript(opts: RouterAsClientOptions): string {
  const {
    vpsPublicIp,
    vpnPort         = 1194,
    vpnUsername     = "admin",
    vpnPassword     = "ochola",
    tunnelRouterIp  = "10.8.5.2",
    tunnelVpsIp     = "10.8.5.1",
    lanNetwork      = "192.168.88.0/24",
    routerId,
  } = opts;

  const tag = "coreispbilling";
  const interfaceName = "coreispbilling";

  return `# ═══════════════════════════════════════════════════════════════
# OcholaSupernet — MikroTik Router as OpenVPN CLIENT
# Generated  : ${new Date().toISOString()}
# Architecture: Router connects TO VPS (VPS is the OVPN server)
#
# VPS OVPN server : ${vpsPublicIp}:${vpnPort}/tcp  (tun0 ${tunnelVpsIp})
# Router tunnel IP: ${tunnelRouterIp}  (assigned by VPS server after connect)
# VPN user        : ${vpnUsername}
#
# After import:
#   - Router connects to VPS and gets tunnel IP ${tunnelRouterIp}
#   - Backend: set MIKROTIK_BRIDGE_IP=${tunnelRouterIp}
#   - API reaches router at ${tunnelRouterIp}:8728
#
# REQUIREMENTS on VPS side (run vps-ovpn-setup.sh first):
#   - VPS OpenVPN server must use proto tcp
#   - User '${vpnUsername}' must be added to /etc/openvpn/easy-rsa or auth file
#   - tls-auth should be disabled or compatible with MikroTik
#
# USAGE: /import router-as-client${routerId ?? ""}.rsc
# ═══════════════════════════════════════════════════════════════

# ── Step 1: Create the OVPN client interface ─────────────────────────────────
# Make this safe to re-import during recovery or after a failed migration.
:global ocholaVpnChildError
:set ocholaVpnChildError ""
:local ovpnError ""
:do { /interface ovpn-client remove [find where name="ovpn-to-vps"] } on-error={}
:do { /interface ovpn-client remove [find where name="ocholasupernet"] } on-error={}
:do { /interface ovpn-client remove [find where name="${interfaceName}"] } on-error={}
:do { /interface ovpn-client add name=${interfaceName} connect-to=${vpsPublicIp} port=${vpnPort} user=${vpnUsername} password=${vpnPassword} disabled=no comment="${tag} VPS tunnel" } on-error={ :set ovpnError "RouterOS rejected the OpenVPN client add command." }
:if ([:len $ovpnError] > 0) do={
    :set ocholaVpnChildError ("${tag}: OVPN client creation failed: " . $ovpnError)
    :error $ocholaVpnChildError
}

:delay 10s
:put "${tag}: waiting for OVPN client to establish..."
:if ([:len [/interface ovpn-client find where name="${interfaceName}" and running=yes]] = 0) do={
    :set ocholaVpnChildError "${tag}: OVPN client did not establish a running session. Check /log for TLS, credential, certificate, or reachability errors."
    :error $ocholaVpnChildError
} else={
    :put "${tag}: OVPN client is running."
}

# ── Step 2: Allow API access from VPN tunnel ─────────────────────────────────
# The VPS reaches the router's API at ${tunnelRouterIp}:8728 through the tunnel.
/ip firewall filter
remove [find where comment="${tag}-api-from-vps-tunnel"]
add action=accept chain=input src-address=${tunnelVpsIp}/32 protocol=tcp dst-port=8728,8729 comment="${tag}-api-from-vps-tunnel"

# ── Step 3: Allow ping from VPS (connectivity check) ─────────────────────────
remove [find where comment="${tag}-ping-from-vps-tunnel"]
add action=accept chain=input src-address=${tunnelVpsIp}/32 protocol=icmp comment="${tag}-ping-from-vps-tunnel"

# ── Step 4: Ensure API service is enabled ────────────────────────────────────
/ip service
enable api
# enable api-ssl   # uncomment for port 8729 encrypted API

# ── Step 5: Verify the interface came up ─────────────────────────────────────
# Run this in terminal after import — should show "R" (running):
#   /interface print where name=${interfaceName}
#   /ip address print where interface=${interfaceName}
#
# Expected: inet ${tunnelRouterIp} on ${interfaceName}
# Then from VPS:  ping ${tunnelRouterIp}  and  curl http://${tunnelRouterIp}:8728

:log info "${tag}: OVPN client configured → ${vpsPublicIp}:${vpnPort}"
:log info "${tag}: After connect, router API reachable at ${tunnelRouterIp}:8728"
`;
}

/** Generate a RouterOS 7-only WireGuard management-client script. */
export function generateRouterWireGuardClientScript(opts: RouterWireGuardClientOptions): string {
  const {
    endpoint,
    endpointPort = 51820,
    serverPublicKey,
    clientPrivateKey,
    tunnelRouterIp = "10.8.5.2",
    tunnelVpsIp = "10.8.5.1",
    routerId,
  } = opts;
  const tag = "coreispbilling";
  const interfaceName = "ochola-wg";

  return `# ${tag} — MikroTik RouterOS 7 WireGuard management client
# This child script is fetched only after the OpenVPN attempt fails.
# RouterOS 6 devices must not import this file.

:put "${tag}: configuring WireGuard fallback..."
:do { /interface wireguard peers remove [find where comment="${tag} WireGuard management peer"] } on-error={}
:do { /ip address remove [find interface="${interfaceName}"] } on-error={}
:do { /interface wireguard remove [find where name="${interfaceName}"] } on-error={}
:global ocholaVpnChildError
:set ocholaVpnChildError ""
:do { /interface wireguard add name="${interfaceName}" private-key="${clientPrivateKey}" disabled=no comment="${tag} WireGuard management" } on-error={ :set ocholaVpnChildError "${tag}: WireGuard interface creation failed: RouterOS rejected the interface command." ; :error $ocholaVpnChildError }
:do { /ip address add address=${tunnelRouterIp}/24 interface="${interfaceName}" comment="${tag} WireGuard management address" } on-error={ :set ocholaVpnChildError "${tag}: WireGuard address creation failed: RouterOS rejected the address command." ; :error $ocholaVpnChildError }
:do { /interface wireguard peers add interface="${interfaceName}" public-key="${serverPublicKey}" endpoint-address="${endpoint}" endpoint-port=${endpointPort} allowed-address=${tunnelVpsIp}/32 persistent-keepalive=25 comment="${tag} WireGuard management peer" } on-error={ :set ocholaVpnChildError "${tag}: WireGuard peer creation failed: RouterOS rejected the peer command." ; :error $ocholaVpnChildError }
:do { /ip firewall filter remove [find where comment="${tag}-api-from-vpn-tunnel"] } on-error={}
:do { /ip firewall filter add action=accept chain=input src-address=${tunnelVpsIp}/32 protocol=tcp dst-port=8728,8729 comment="${tag}-api-from-vpn-tunnel" } on-error={ :set ocholaVpnChildError "${tag}: WireGuard API firewall rule failed: RouterOS rejected the firewall command." ; :error $ocholaVpnChildError }
:do { /ip firewall filter remove [find where comment="${tag}-ping-from-vpn-tunnel"] } on-error={}
:do { /ip firewall filter add action=accept chain=input src-address=${tunnelVpsIp}/32 protocol=icmp comment="${tag}-ping-from-vpn-tunnel" } on-error={ :set ocholaVpnChildError "${tag}: WireGuard ping firewall rule failed: RouterOS rejected the firewall command." ; :error $ocholaVpnChildError }
:delay 5s
:if ([:len [/interface wireguard find where name="${interfaceName}"]] = 0) do={ :set ocholaVpnChildError "${tag}: WireGuard interface was not verified."; :error $ocholaVpnChildError }
:put "${tag}: WireGuard management resources verified."
:log info "${tag}: WireGuard fallback configured via ${endpoint}:${endpointPort}"
`;
}

/** Generate a RouterOS 6/7-compatible IPsec management-client script. */
export function generateRouterIpsecClientScript(opts: RouterIpsecClientOptions): string {
  const {
    endpoint,
    preSharedKey,
    tunnelRouterIp = "10.8.5.2",
    tunnelVpsIp = "10.8.5.1",
    routerId,
  } = opts;
  const tag = "coreispbilling";
  const peerName = `ochola-ipsec-${routerId ?? "management"}`;
  const endpointPrefix = endpoint.includes(":") ? `${endpoint}/128` : `${endpoint}/32`;
  const safePreSharedKey = preSharedKey
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

  return `# ${tag} — MikroTik IPsec management fallback
# This child script is attempted only after OpenVPN and WireGuard fail.
# IPsec is policy-based, so verification confirms the peer, identity and policy
# resources; the authenticated heartbeat must confirm end-to-end reachability.

:put "${tag}: configuring IPsec fallback..."
:do { /ip ipsec policy remove [find where comment="${tag} IPsec management policy"] } on-error={}
:do { /ip ipsec identity remove [find where comment="${tag} IPsec management identity"] } on-error={}
:do { /ip ipsec peer remove [find where comment="${tag} IPsec management peer"] } on-error={}
:global ocholaVpnChildError
:set ocholaVpnChildError ""
:do { /ip ipsec peer add name="${peerName}" address=${endpointPrefix} exchange-mode=ike2 disabled=no comment="${tag} IPsec management peer" } on-error={ :set ocholaVpnChildError "${tag}: IPsec peer creation failed: RouterOS rejected the peer command." ; :error $ocholaVpnChildError }
:do { /ip ipsec identity add peer="${peerName}" auth-method=pre-shared-key secret="${safePreSharedKey}" comment="${tag} IPsec management identity" } on-error={ :set ocholaVpnChildError "${tag}: IPsec identity creation failed: RouterOS rejected the identity command." ; :error $ocholaVpnChildError }
:do { /ip ipsec policy add src-address=${tunnelRouterIp}/32 dst-address=${tunnelVpsIp}/32 tunnel=yes sa-src-address=0.0.0.0 sa-dst-address=${endpoint} proposal=default comment="${tag} IPsec management policy" } on-error={ :set ocholaVpnChildError "${tag}: IPsec policy creation failed: RouterOS rejected the policy command." ; :error $ocholaVpnChildError }
:do { /ip firewall filter remove [find where comment="${tag}-api-from-vpn-tunnel"] } on-error={}
:do { /ip firewall filter add action=accept chain=input src-address=${tunnelVpsIp}/32 protocol=tcp dst-port=8728,8729 comment="${tag}-api-from-vpn-tunnel" } on-error={ :set ocholaVpnChildError "${tag}: IPsec API firewall rule failed: RouterOS rejected the firewall command." ; :error $ocholaVpnChildError }
:if ([:len [/ip ipsec peer find where comment="${tag} IPsec management peer"]] = 0) do={ :set ocholaVpnChildError "${tag}: IPsec peer was not verified."; :error $ocholaVpnChildError }
:if ([:len [/ip ipsec identity find where comment="${tag} IPsec management identity"]] = 0) do={ :set ocholaVpnChildError "${tag}: IPsec identity was not verified."; :error $ocholaVpnChildError }
:if ([:len [/ip ipsec policy find where comment="${tag} IPsec management policy"]] = 0) do={ :set ocholaVpnChildError "${tag}: IPsec policy was not verified."; :error $ocholaVpnChildError }
:put "${tag}: IPsec management resources verified; waiting for authenticated heartbeat."
:log info "${tag}: IPsec fallback configured via ${endpoint}"
`;
}

/* ─── MikroTik firewall script generator ────────────────────────────────── */

/**
 * Generates a MikroTik RouterOS script that restricts API access to a
 * specific VPS IP, blocking all other connections to port 8728 and 8729.
 *
 * The user should paste this into the router's terminal:
 *   /import mikrotik-firewall.rsc
 */
export function generateFirewallScript(vpsIp: string, options?: {
  enableApiSsl?: boolean;
  comment?: string;
}): string {
  const { enableApiSsl = true, comment = "VPS-ONLY" } = options ?? {};
  const ports = enableApiSsl ? "8728,8729" : "8728";

  return `# OcholaSupernet — MikroTik API Firewall Rules
# Generated: ${new Date().toISOString()}
# Purpose: Allow API access ONLY from VPS IP ${vpsIp}
# Paste into terminal or upload and run: /import filename.rsc

# ── 1. Allow API from VPS (must come FIRST) ──────────────────────────────
/ip firewall filter
add action=accept chain=input comment="${comment}-allow-api" \\
    dst-port=${ports} in-interface-list=WAN protocol=tcp \\
    src-address=${vpsIp}

# ── 2. Drop API access from all other sources ─────────────────────────────
add action=drop chain=input comment="${comment}-block-api" \\
    dst-port=${ports} in-interface-list=WAN protocol=tcp

# ── 3. (Optional) Enable API-SSL service on port 8729 ────────────────────
${enableApiSsl ? "/ip service enable api-ssl" : "# /ip service enable api-ssl  (uncomment to enable)"}

# ── Verify — check that the rules are in place ───────────────────────────
# :log info "Firewall rules applied. API restricted to ${vpsIp} only."
`;
}

/* ═══════════════════════ Bridge port management ═══════════════════════════ */

export interface BridgeEntry {
  name: string;
  running: boolean;
}

export interface BridgePortEntry {
  id: string;
  bridge: string;
  interface: string;
}

export interface BridgePortLayout {
  interfaces: RouterInterface[];
  bridges: BridgeEntry[];
  bridgePorts: BridgePortEntry[];
  connectedVia: string;
}

/**
 * Fetch all interfaces, bridge objects, and bridge port memberships.
 * Used by the Bridge Ports admin page.
 */
export async function fetchBridgePortLayout(
  creds: RouterCredentials
): Promise<BridgePortLayout> {
  return withConn(creds, async (conn, connectedHost) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;

    const [ifaceRows, bridgeRows, bpRows] = await Promise.all([
      withTimeout(conn.write(["/interface/print"]),             ms) as Promise<Record<string, string>[]>,
      withTimeout(conn.write(["/interface/bridge/print"]),      ms) as Promise<Record<string, string>[]>,
      withTimeout(conn.write(["/interface/bridge/port/print"]), ms) as Promise<Record<string, string>[]>,
    ]);

    const interfaces: RouterInterface[] = (Array.isArray(ifaceRows) ? ifaceRows : []).map(r => ({
      id:         r[".id"]         ?? "",
      name:       r.name           ?? "",
      type:       r.type           ?? "",
      running:    parseBool(r.running),
      disabled:   parseBool(r.disabled),
      macAddress: r["mac-address"] ?? "",
      comment:    r.comment        ?? "",
      txBps:      parseBytes(r["tx-byte"]),
      rxBps:      parseBytes(r["rx-byte"]),
    }));

    const bridges: BridgeEntry[] = (Array.isArray(bridgeRows) ? bridgeRows : []).map(r => ({
      name:    r.name    ?? "",
      running: parseBool(r.running),
    }));

    const bridgePorts: BridgePortEntry[] = (Array.isArray(bpRows) ? bpRows : []).map(r => ({
      id:        r[".id"]    ?? "",
      bridge:    r.bridge    ?? "",
      interface: r.interface ?? "",
    }));

    return { interfaces, bridges, bridgePorts, connectedVia: connectedHost };
  });
}

/**
 * Add or remove interfaces from a MikroTik bridge.
 * Returns an array of human-readable log lines.
 */
export async function assignBridgePorts(
  creds: RouterCredentials,
  bridgeName: string,
  addPorts: string[],
  removePorts: string[]
): Promise<string[]> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const logs: string[] = [];

    /* Fetch ALL bridge port rows (across every bridge) so we have global .id mapping */
    const existing = (await withTimeout(
      conn.write(["/interface/bridge/port/print"]),
      ms
    )) as Record<string, string>[];

    /* globalPortMap: interface name → { id, bridge } for every assigned port */
    const globalPortMap: Record<string, { id: string; bridge: string }> = {};
    (Array.isArray(existing) ? existing : []).forEach(r => {
      if (r.interface && r[".id"]) {
        globalPortMap[r.interface] = { id: r[".id"], bridge: r.bridge ?? "" };
      }
    });

    /* ── Remove ports from the target bridge ── */
    for (const iface of removePorts) {
      const entry = globalPortMap[iface];
      if (!entry || entry.bridge !== bridgeName) {
        logs.push(`⚠ ${iface}: not in ${bridgeName}, skipping remove`);
        continue;
      }
      try {
        await withTimeout(conn.write(["/interface/bridge/port/remove", `=.id=${entry.id}`]), ms);
        logs.push(`✓ Removed ${iface} from ${bridgeName}`);
        delete globalPortMap[iface]; // keep map in sync for the add step
      } catch (e) {
        logs.push(`✗ Failed to remove ${iface}: ${(e as Error).message}`);
      }
    }

    /* ── Add ports to the target bridge ── */
    for (const iface of addPorts) {
      const entry = globalPortMap[iface];

      /* Already in this bridge — nothing to do */
      if (entry && entry.bridge === bridgeName) {
        logs.push(`⚠ ${iface}: already in ${bridgeName}, skipping`);
        continue;
      }

      /* Port is a member of a DIFFERENT bridge — remove it first */
      if (entry && entry.bridge && entry.bridge !== bridgeName) {
        try {
          await withTimeout(conn.write(["/interface/bridge/port/remove", `=.id=${entry.id}`]), ms);
          logs.push(`  ↩ Moved ${iface} out of ${entry.bridge}`);
        } catch (e) {
          logs.push(`✗ Could not remove ${iface} from ${entry.bridge}: ${(e as Error).message}`);
          continue; // skip add if we couldn't remove
        }
      }

      /* Add to target bridge */
      try {
        await withTimeout(
          conn.write(["/interface/bridge/port/add", `=bridge=${bridgeName}`, `=interface=${iface}`]),
          ms
        );
        logs.push(`✓ Added ${iface} → ${bridgeName}`);
      } catch (e) {
        logs.push(`✗ Failed to add ${iface}: ${(e as Error).message}`);
      }
    }

    if (logs.length === 0) logs.push("No changes made.");
    return logs;
  });
}

/**
 * Create a bridge on the router if it does not already exist.
 * Idempotent: if a bridge with the given name exists, returns without error.
 * Returns { created: boolean, message: string }.
 */
export async function createBridge(
  creds: RouterCredentials,
  bridgeName: string
): Promise<{ created: boolean; message: string }> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;

    const existing = (await withTimeout(
      conn.write(["/interface/bridge/print", `?name=${bridgeName}`]),
      ms
    )) as Record<string, string>[];

    if (Array.isArray(existing) && existing.length > 0) {
      return { created: false, message: `Bridge "${bridgeName}" already exists.` };
    }

    await withTimeout(
      conn.write(["/interface/bridge/add", `=name=${bridgeName}`]),
      ms
    );

    return { created: true, message: `Bridge "${bridgeName}" created successfully.` };
  });
}
