import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  CircleHelp,
  Eye,
  GitBranch,
  Loader2,
  Network,
  PlugZap,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ServerCog,
  ShieldCheck,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  adminApiHeaders,
  useAdminRouterContext,
} from "@/lib/admin-router-context";

type ConnectionType = "static" | "pppoe";
type BalancingMode = "weighted" | "failover";
type RouterOsVersion = "auto" | "6" | "7";

type WanConfig = {
  name: string;
  interfaceName: string;
  connectionType: ConnectionType;
  staticAddressCidr: string;
  gateway: string;
  weight: number;
  healthCheckIp: string;
  enabled: boolean;
  position: number;
  pppoeUsername: string;
  pppoePassword?: string;
  pppoeSecretConfigured?: boolean;
  reassignFromBridge: boolean;
  bridgeName: string;
};

type LanLink = {
  interfaceName: string;
  wanPosition: number;
  maxMbps: number;
};

type LoadBalancingConfig = {
  routerId: number;
  enabled: boolean;
  mode: BalancingMode;
  lanInterface: string;
  routerOsVersion: RouterOsVersion;
  allowBridgeFirewall: boolean;
  wans: WanConfig[];
  lanLinks: LanLink[];
};

type InterfaceInfo = {
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
};

type InterfacePayload = {
  ok: boolean;
  interfaces: {
    interfaces: InterfaceInfo[];
    bridges: Array<{ name: string; running: boolean }>;
    bridgePorts: Array<{ bridge: string; interface: string }>;
    addresses: Array<{ interface: string; address: string }>;
    connectedVia?: string;
  };
};

type PreviewResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  changes: string[];
  scriptPreview: string;
  previewHash: string;
  enabledWanCount: number;
};

const card: CSSProperties = {
  background: "var(--isp-card)",
  border: "1px solid var(--isp-border)",
  borderRadius: 14,
  boxShadow: "var(--shadow-card)",
};

const fieldLabel: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginBottom: 6,
  color: "var(--isp-text-muted)",
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: ".065em",
  textTransform: "uppercase",
};

function cloneConfig(config: LoadBalancingConfig): LoadBalancingConfig {
  return JSON.parse(JSON.stringify(config)) as LoadBalancingConfig;
}

function defaultWan(position: number, interfaceName = ""): WanConfig {
  return {
    name: `WAN ${position}`,
    interfaceName,
    connectionType: "static",
    staticAddressCidr: "",
    gateway: "",
    weight: 1,
    healthCheckIp: "1.1.1.1",
    enabled: true,
    position,
    pppoeUsername: "",
    pppoePassword: "",
    pppoeSecretConfigured: false,
    reassignFromBridge: false,
    bridgeName: "",
  };
}

function normalizeConfig(raw: Partial<LoadBalancingConfig> | null | undefined, routerId: number): LoadBalancingConfig {
  const sourceWans = Array.isArray(raw?.wans) ? raw.wans : [];
  const wans = (sourceWans.length ? sourceWans : [defaultWan(1)]).map((wan, index) => ({
    ...defaultWan(index + 1),
    ...wan,
    position: Number(wan.position) || index + 1,
    weight: Number(wan.weight) || 1,
    pppoePassword: "",
    pppoeSecretConfigured: Boolean(wan.pppoeSecretConfigured),
    reassignFromBridge: Boolean(wan.reassignFromBridge),
  }));
  return {
    routerId,
    enabled: Boolean(raw?.enabled),
    mode: raw?.mode === "failover" ? "failover" : "weighted",
    lanInterface: raw?.lanInterface ?? "",
    routerOsVersion: raw?.routerOsVersion === "6" || raw?.routerOsVersion === "7" ? raw.routerOsVersion : "auto",
    allowBridgeFirewall: Boolean(raw?.allowBridgeFirewall),
    wans,
    lanLinks: Array.isArray(raw?.lanLinks)
      ? raw.lanLinks.map(link => ({
        interfaceName: link.interfaceName ?? "",
        wanPosition: Number(link.wanPosition) || 1,
        maxMbps: Number(link.maxMbps) || 1,
      }))
      : [],
  };
}

function configForWrite(config: LoadBalancingConfig): LoadBalancingConfig {
  const copy = cloneConfig(config);
  copy.wans = copy.wans.map(wan => {
    const next = { ...wan };
    // A password is intentionally never hydrated from the API. An empty field
    // means "leave the stored secret unchanged", not "clear the secret".
    if (!next.pppoePassword?.trim()) delete next.pppoePassword;
    return next;
  });
  return copy;
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      ...adminApiHeaders(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !body) {
    throw new Error(body?.error ?? `Request failed (HTTP ${response.status}).`);
  }
  return body;
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`lw-toggle ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="lw-toggle-knob" />
    </button>
  );
}

function Notice({
  kind,
  children,
}: {
  kind: "error" | "warning" | "success" | "info";
  children: React.ReactNode;
}) {
  const Icon = kind === "error" ? AlertTriangle : kind === "warning" ? AlertTriangle : kind === "success" ? CheckCircle2 : CircleHelp;
  return (
    <div className={`lw-notice lw-notice-${kind}`}>
      <Icon size={16} />
      <div>{children}</div>
    </div>
  );
}

export default function LoadBalancing() {
  const { data: routerContext, isLoading: routersLoading, error: routersError } = useAdminRouterContext();
  const routers = routerContext?.routers ?? [];
  const [selectedRouterId, setSelectedRouterId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const value = Number(new URLSearchParams(window.location.search).get("routerId"));
    return Number.isFinite(value) && value > 0 ? value : null;
  });
  const [config, setConfig] = useState<LoadBalancingConfig | null>(null);
  const [interfaces, setInterfaces] = useState<InterfacePayload["interfaces"] | null>(null);
  const [routerName, setRouterName] = useState("");
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [confirmationName, setConfirmationName] = useState("");
  const [applyOpen, setApplyOpen] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (selectedRouterId === null && routers.length > 0) setSelectedRouterId(routers[0].id);
  }, [routers, selectedRouterId]);

  const selectedRouter = routers.find(router => router.id === selectedRouterId);

  const loadRouterData = useCallback(async (routerId: number) => {
    setLoading(true);
    setLoadError("");
    setMessage(null);
    setPreview(null);
    try {
      const [configResponse, interfaceResponse] = await Promise.all([
        apiJson<{ ok: boolean; config: LoadBalancingConfig | null; routerName?: string; recoveryAvailable?: boolean }>(`/api/router/${routerId}/load-balancing`),
        apiJson<InterfacePayload>(`/api/router/${routerId}/load-balancing/interfaces`),
      ]);
      setConfig(normalizeConfig(configResponse.config, routerId));
      setRouterName(configResponse.routerName || routers.find(router => router.id === routerId)?.name || `Router ${routerId}`);
      setRecoveryAvailable(Boolean(configResponse.recoveryAvailable));
      setInterfaces(interfaceResponse.interfaces);
    } catch (cause) {
      setConfig(null);
      setInterfaces(null);
      setLoadError(cause instanceof Error ? cause.message : "Unable to read multi-WAN settings from this router.");
    } finally {
      setLoading(false);
    }
  }, [routers]);

  useEffect(() => {
    if (selectedRouterId !== null) void loadRouterData(selectedRouterId);
  }, [loadRouterData, selectedRouterId]);

  const physicalInterfaces = useMemo(
    () => (interfaces?.interfaces ?? []).filter(item => {
      const type = item.type.toLowerCase();
      return !item.disabled && (type.includes("ether") || type.includes("sfp"));
    }),
    [interfaces],
  );
  const availableLanInterfaces = useMemo(
    () => interfaces?.bridges ?? [],
    [interfaces],
  );
  const interfaceNames = useMemo(
    () => physicalInterfaces.map(item => item.name),
    [physicalInterfaces],
  );
  const bridgePorts = interfaces?.bridgePorts ?? [];

  const updateConfig = (updater: (next: LoadBalancingConfig) => void) => {
    setConfig(current => {
      if (!current) return current;
      const next = cloneConfig(current);
      updater(next);
      return next;
    });
    setPreview(null);
    setMessage(null);
  };

  const localIssues = useMemo(() => {
    if (!config) return [];
    const issues: string[] = [];
    const enabledWans = config.wans.filter(wan => wan.enabled);
    if (config.enabled && enabledWans.length === 0) issues.push("Enable at least one WAN before previewing.");
    if (config.enabled && !config.lanInterface) issues.push("Choose the LAN bridge that serves customer traffic.");
    enabledWans.forEach((wan, index) => {
      if (!wan.interfaceName) issues.push(`WAN ${index + 1} needs a physical interface.`);
      if (wan.connectionType === "static" && !wan.gateway) issues.push(`${wan.name || `WAN ${index + 1}`} needs a gateway.`);
      if (config.mode === "weighted" && wan.weight < 1) issues.push(`${wan.name || `WAN ${index + 1}`} needs a weight of at least 1.`);
    });
    return issues;
  }, [config]);

  const addWan = () => updateConfig(next => {
    const position = next.wans.length + 1;
    const unusedInterface = interfaceNames.find(name => !next.wans.some(wan => wan.interfaceName === name)) ?? "";
    next.wans.push(defaultWan(position, unusedInterface));
  });

  const removeWan = (position: number) => updateConfig(next => {
    if (next.wans.length <= 1) return;
    next.wans = next.wans
      .filter(wan => wan.position !== position)
      .map((wan, index) => ({ ...wan, position: index + 1 }));
    next.lanLinks = next.lanLinks.map(link => ({
      ...link,
      wanPosition: link.wanPosition === position ? 1 : link.wanPosition > position ? link.wanPosition - 1 : link.wanPosition,
    }));
  });

  const moveWan = (position: number, direction: -1 | 1) => updateConfig(next => {
    const index = next.wans.findIndex(wan => wan.position === position);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.wans.length) return;
    [next.wans[index], next.wans[target]] = [next.wans[target], next.wans[index]];
    next.wans = next.wans.map((wan, itemIndex) => ({ ...wan, position: itemIndex + 1 }));
  });

  const addLanLink = () => updateConfig(next => {
    const unused = interfaceNames.find(name => !next.lanLinks.some(link => link.interfaceName === name));
    if (!unused) return;
    next.lanLinks.push({ interfaceName: unused, wanPosition: next.wans[0]?.position ?? 1, maxMbps: 10 });
  });

  const previewChanges = async () => {
    if (!config || selectedRouterId === null) return;
    if (localIssues.length > 0) {
      setMessage({ kind: "error", text: localIssues[0] });
      return;
    }
    setPreviewing(true);
    setMessage(null);
    try {
      const result = await apiJson<PreviewResult>(`/api/router/${selectedRouterId}/load-balancing/preview`, {
        method: "POST",
        body: JSON.stringify({ config: configForWrite(config) }),
      });
      setPreview(result);
      if (!result.ok || result.errors.length > 0) setMessage({ kind: "error", text: result.errors[0] || "The router rejected this preview." });
      else if (result.warnings.length > 0) setMessage({ kind: "success", text: "Preview ready. Review the warnings before applying." });
    } catch (cause) {
      setMessage({ kind: "error", text: cause instanceof Error ? cause.message : "Preview could not be generated." });
    } finally {
      setPreviewing(false);
    }
  };

  const applyChanges = async () => {
    if (!config || !preview || !selectedRouterId || confirmationName.trim() !== routerName.trim()) return;
    setApplying(true);
    setMessage(null);
    try {
      const result = await apiJson<{ ok: boolean; error?: string; recoveryAvailable?: boolean }>(`/api/router/${selectedRouterId}/load-balancing/apply`, {
        method: "POST",
        body: JSON.stringify({
          config: configForWrite(config),
          previewHash: preview.previewHash,
          confirmationName: confirmationName.trim(),
        }),
      });
      if (!result.ok) throw new Error(result.error || "The router did not accept the configuration.");
      setRecoveryAvailable(Boolean(result.recoveryAvailable ?? true));
      setApplyOpen(false);
      setConfirmationName("");
      setMessage({ kind: "success", text: "Multi-WAN configuration applied. RouterOS is now using the previewed policy." });
      await loadRouterData(selectedRouterId);
    } catch (cause) {
      setMessage({ kind: "error", text: cause instanceof Error ? cause.message : "Configuration could not be applied." });
    } finally {
      setApplying(false);
    }
  };

  const rollback = async () => {
    if (!selectedRouterId) return;
    if (!window.confirm("Roll back the last multi-WAN change on this router?")) return;
    setRollingBack(true);
    setMessage(null);
    try {
      const result = await apiJson<{ ok: boolean; error?: string }>(`/api/router/${selectedRouterId}/load-balancing/rollback`, { method: "POST" });
      if (!result.ok) throw new Error(result.error || "Rollback was not completed.");
      setMessage({ kind: "success", text: "The previous multi-WAN configuration was restored." });
      setRecoveryAvailable(false);
      await loadRouterData(selectedRouterId);
    } catch (cause) {
      setMessage({ kind: "error", text: cause instanceof Error ? cause.message : "Rollback could not be completed." });
    } finally {
      setRollingBack(false);
    }
  };

  const styles = `
    .lw-page { max-width: 1440px; display: grid; gap: 16px; color: var(--isp-text); }
    .lw-hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; padding: 22px 24px; background: linear-gradient(125deg, rgba(37,99,235,.14), var(--isp-card) 54%, rgba(15,157,120,.07)); overflow: hidden; position: relative; }
    .lw-hero:after { content: ""; position: absolute; width: 260px; height: 260px; right: -95px; top: -120px; border: 1px solid var(--isp-accent-border); border-radius: 50%; box-shadow: 0 0 0 28px rgba(37,99,235,.035), 0 0 0 56px rgba(37,99,235,.025); pointer-events: none; }
    .lw-eyebrow { display: flex; align-items: center; gap: 8px; color: var(--isp-accent); font-size: 11px; font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }
    .lw-title { margin: 8px 0 6px; font-size: clamp(22px, 3vw, 30px); line-height: 1.08; font-weight: 850; letter-spacing: -.04em; }
    .lw-subtitle { max-width: 720px; margin: 0; color: var(--isp-text-muted); font-size: 13px; line-height: 1.65; }
    .lw-router-select { min-width: 230px; position: relative; z-index: 1; }
    .lw-router-select label, .lw-modal label { display: block; color: var(--isp-text-muted); font-size: 10px; font-weight: 850; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 6px; }
    .lw-select, .lw-input { width: 100%; border: 1px solid var(--isp-input-border); border-radius: 8px; background: var(--isp-input-bg); color: var(--isp-text); padding: 9px 10px; font: inherit; font-size: 13px; outline: none; }
    .lw-select:focus, .lw-input:focus { border-color: var(--isp-accent); box-shadow: 0 0 0 3px var(--isp-accent-glow); }
    .lw-toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: flex-end; }
    .lw-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; border-radius: 8px; border: 1px solid transparent; padding: 9px 13px; background: var(--isp-input-bg); color: var(--isp-text); font: inherit; font-size: 12px; font-weight: 800; cursor: pointer; transition: transform .15s ease, background .15s ease, border-color .15s ease; }
    .lw-btn:hover:not(:disabled) { transform: translateY(-1px); border-color: var(--isp-accent-border); background: var(--isp-hover); }
    .lw-btn:disabled { opacity: .5; cursor: not-allowed; }
    .lw-btn-primary { color: #fff; background: var(--isp-accent); border-color: var(--isp-accent); }
    .lw-btn-primary:hover:not(:disabled) { background: var(--isp-accent-strong); }
    .lw-btn-danger { color: #b91c1c; background: rgba(239,68,68,.07); border-color: rgba(239,68,68,.2); }
    .lw-btn-small { padding: 6px 8px; font-size: 11px; }
    .lw-btn-icon { width: 29px; height: 29px; padding: 0; }
    .lw-notice { display: flex; gap: 9px; align-items: flex-start; padding: 11px 13px; border-radius: 9px; font-size: 12px; line-height: 1.5; }
    .lw-notice-error { color: #b91c1c; background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.22); }
    .lw-notice-warning { color: #a16207; background: rgba(245,158,11,.09); border: 1px solid rgba(245,158,11,.25); }
    .lw-notice-success { color: #15803d; background: rgba(34,197,94,.08); border: 1px solid rgba(34,197,94,.22); }
    .lw-notice-info { color: var(--isp-accent-strong); background: var(--isp-accent-glow); border: 1px solid var(--isp-accent-border); }
    .lw-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(320px, .65fr); gap: 16px; align-items: start; }
    .lw-section { overflow: hidden; }
    .lw-section-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--isp-border); }
    .lw-section-title { display: flex; align-items: center; gap: 9px; font-size: 14px; font-weight: 850; }
    .lw-section-title svg { color: var(--isp-accent); }
    .lw-section-note { margin: 3px 0 0 26px; color: var(--isp-text-muted); font-size: 11px; line-height: 1.45; }
    .lw-section-body { padding: 16px 18px; }
    .lw-general-grid { display: grid; grid-template-columns: 1.1fr .9fr .8fr; gap: 14px; }
    .lw-field { min-width: 0; }
    .lw-check-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 42px; padding: 10px 12px; border: 1px solid var(--isp-border); border-radius: 9px; background: var(--isp-inner-card); }
    .lw-check-copy strong { display: block; font-size: 12px; }
    .lw-check-copy span { display: block; margin-top: 3px; color: var(--isp-text-muted); font-size: 11px; line-height: 1.35; }
    .lw-toggle { width: 36px; height: 21px; flex: 0 0 auto; padding: 2px; border: 0; border-radius: 999px; background: var(--isp-border); cursor: pointer; transition: background .15s ease; }
    .lw-toggle.is-on { background: var(--isp-green); }
    .lw-toggle-knob { display: block; width: 17px; height: 17px; border-radius: 50%; background: var(--isp-card); transition: transform .15s ease; }
    .lw-toggle.is-on .lw-toggle-knob { transform: translateX(15px); }
    .lw-wan-list { display: grid; gap: 11px; }
    .lw-wan { border: 1px solid var(--isp-border); border-radius: 11px; overflow: hidden; background: var(--isp-inner-card); }
    .lw-wan.is-disabled { opacity: .62; }
    .lw-wan-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 11px 13px; border-bottom: 1px solid var(--isp-border); background: color-mix(in srgb, var(--isp-card) 55%, transparent); }
    .lw-wan-name { display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 850; }
    .lw-wan-index { display: grid; place-items: center; width: 23px; height: 23px; border-radius: 6px; background: var(--isp-accent-glow); border: 1px solid var(--isp-accent-border); color: var(--isp-accent-strong); font-family: var(--font-mono); font-size: 11px; }
    .lw-wan-actions { display: flex; gap: 5px; align-items: center; }
    .lw-wan-body { display: grid; grid-template-columns: 1.1fr 1fr 1fr 1fr; gap: 11px; padding: 13px; }
    .lw-span-2 { grid-column: span 2; }
    .lw-secret-note { margin-top: 6px; color: var(--isp-text-muted); font-size: 10px; }
    .lw-status { display: inline-flex; align-items: center; gap: 5px; padding: 3px 7px; border: 1px solid rgba(34,197,94,.22); border-radius: 999px; color: #15803d; background: rgba(34,197,94,.08); font-size: 10px; font-weight: 800; }
    .lw-status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .lw-table-wrap { overflow-x: auto; }
    .lw-table { width: 100%; min-width: 610px; border-collapse: collapse; font-size: 12px; }
    .lw-table th { padding: 9px 12px; background: var(--isp-inner-card); color: var(--isp-text-muted); border-bottom: 1px solid var(--isp-border); font-size: 10px; letter-spacing: .07em; text-align: left; text-transform: uppercase; }
    .lw-table td { padding: 10px 12px; color: var(--isp-text); border-bottom: 1px solid var(--isp-border-subtle); vertical-align: middle; }
    .lw-table tr:last-child td { border-bottom: 0; }
    .lw-empty { padding: 22px 12px; color: var(--isp-text-muted); text-align: center; font-size: 12px; }
    .lw-preview { position: sticky; top: 14px; }
    .lw-preview-meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 13px; }
    .lw-metric { padding: 10px; border: 1px solid var(--isp-border); border-radius: 9px; background: var(--isp-inner-card); }
    .lw-metric span { display: block; color: var(--isp-text-muted); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
    .lw-metric strong { display: block; margin-top: 5px; font-family: var(--font-mono); font-size: 15px; }
    .lw-change-list { display: grid; gap: 7px; margin: 0; padding: 0; list-style: none; }
    .lw-change-list li { display: flex; gap: 7px; align-items: flex-start; color: var(--isp-text-muted); font-size: 11px; line-height: 1.45; }
    .lw-change-list svg { margin-top: 2px; flex: 0 0 auto; color: var(--isp-green); }
    .lw-code { max-height: 190px; overflow: auto; margin: 12px 0 0; padding: 11px; border: 1px solid var(--isp-border); border-radius: 8px; color: var(--isp-text-muted); background: var(--isp-bg); font: 10px/1.55 var(--font-mono); white-space: pre-wrap; }
    .lw-loading { display: flex; gap: 10px; align-items: center; min-height: 220px; justify-content: center; color: var(--isp-text-muted); font-size: 13px; }
    .lw-skeleton { height: 13px; border-radius: 5px; background: linear-gradient(90deg, var(--isp-inner-card), var(--isp-border), var(--isp-inner-card)); background-size: 200% 100%; animation: lw-shimmer 1.4s ease infinite; }
    .lw-modal-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 20px; background: rgba(8,20,34,.58); }
    .lw-modal { width: min(100%, 480px); padding: 20px; border: 1px solid var(--isp-border); border-radius: 14px; background: var(--isp-card); box-shadow: var(--shadow-lg); }
    .lw-modal h2 { margin: 0 0 7px; font-size: 18px; }
    .lw-modal p { margin: 0 0 15px; color: var(--isp-text-muted); font-size: 12px; line-height: 1.55; }
    .lw-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 15px; }
    @keyframes lw-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
    @media (max-width: 980px) { .lw-grid { grid-template-columns: 1fr; } .lw-preview { position: static; } }
    @media (max-width: 720px) { .lw-hero { flex-direction: column; padding: 18px; } .lw-router-select { width: 100%; } .lw-general-grid, .lw-wan-body { grid-template-columns: 1fr 1fr; } .lw-span-2 { grid-column: span 2; } .lw-section-head { align-items: flex-start; flex-direction: column; } .lw-toolbar { width: 100%; justify-content: flex-start; } }
    @media (max-width: 480px) { .lw-general-grid, .lw-wan-body { grid-template-columns: 1fr; } .lw-span-2 { grid-column: span 1; } .lw-section-body { padding: 13px; } }
  `;

  return (
    <AdminLayout>
      <style>{styles}</style>
      <div className="lw-page">
        <section className="isp-card lw-hero">
          <div>
            <div className="lw-eyebrow"><Network size={15} /> Network policy / multi-WAN</div>
            <h1 className="lw-title">Load balancing that is safe to change.</h1>
            <p className="lw-subtitle">
              Shape customer traffic across static or PPPoE uplinks, keep failover explicit, and inspect the exact RouterOS changes before they touch a live MikroTik.
            </p>
          </div>
          <div className="lw-router-select">
            <label htmlFor="lw-router">Router scope</label>
            {routersLoading ? <div className="lw-skeleton" /> : (
              <select id="lw-router" className="lw-select" value={selectedRouterId ?? ""} onChange={event => setSelectedRouterId(Number(event.target.value) || null)}>
                <option value="" disabled>Select a router</option>
                {routers.map(router => <option key={router.id} value={router.id}>{router.name} · {router.status}</option>)}
              </select>
            )}
          </div>
        </section>

        {routersError && <Notice kind="error">Router list could not be loaded. Refresh the page and try again.</Notice>}
        {loadError && <Notice kind="error">{loadError}</Notice>}
        {message && <Notice kind={message.kind}>{message.text}</Notice>}

        {!routersLoading && routers.length === 0 && !routersError && (
          <section className="isp-card lw-loading">
            <ServerCog size={20} /> No routers are available for this admin account yet.
          </section>
        )}

        {loading && (
          <section className="isp-card lw-loading">
            <Loader2 size={18} /> Reading interfaces and saved policy from {selectedRouter?.name || "the router"}…
          </section>
        )}

        {!loading && config && interfaces && (
          <>
            <div className="lw-grid">
              <div style={{ display: "grid", gap: 16 }}>
                <section className="isp-card lw-section">
                  <div className="lw-section-head">
                    <div>
                      <div className="lw-section-title"><ShieldCheck size={17} /> Policy guardrails</div>
                      <p className="lw-section-note">These controls affect how the generated policy is installed and how customers leave the LAN.</p>
                    </div>
                    <div className="lw-toolbar">
                      <button type="button" className="lw-btn" onClick={() => void loadRouterData(config.routerId)} disabled={loading}><RefreshCw size={14} /> Refresh</button>
                      {recoveryAvailable && <button type="button" className="lw-btn lw-btn-danger" onClick={() => void rollback()} disabled={rollingBack}><RotateCcw size={14} /> {rollingBack ? "Rolling back…" : "Rollback last apply"}</button>}
                    </div>
                  </div>
                  <div className="lw-section-body">
                    <div className="lw-general-grid">
                      <div className="lw-field">
                        <label style={fieldLabel} htmlFor="lw-lan-interface">Customer LAN bridge</label>
                        <select id="lw-lan-interface" className="lw-select" value={config.lanInterface} onChange={event => updateConfig(next => { next.lanInterface = event.target.value; })}>
                          <option value="">Select bridge</option>
                          {availableLanInterfaces.map(bridge => <option key={bridge.name} value={bridge.name}>{bridge.name}{bridge.running ? " · running" : " · down"}</option>)}
                        </select>
                      </div>
                      <div className="lw-field">
                        <label style={fieldLabel} htmlFor="lw-mode">Traffic policy</label>
                        <select id="lw-mode" className="lw-select" value={config.mode} onChange={event => updateConfig(next => { next.mode = event.target.value as BalancingMode; })}>
                          <option value="weighted">Weighted connection split</option>
                          <option value="failover">Failover only</option>
                        </select>
                      </div>
                      <div className="lw-field">
                        <label style={fieldLabel} htmlFor="lw-routeros">RouterOS version</label>
                        <select id="lw-routeros" className="lw-select" value={config.routerOsVersion} onChange={event => updateConfig(next => { next.routerOsVersion = event.target.value as RouterOsVersion; })}>
                          <option value="auto">Detect automatically</option>
                          <option value="6">RouterOS 6</option>
                          <option value="7">RouterOS 7</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ display: "grid", gap: 9, marginTop: 14 }}>
                      <div className="lw-check-row">
                        <div className="lw-check-copy"><strong>Enable multi-WAN policy</strong><span>Keep disabled while you are assembling or inspecting a draft.</span></div>
                        <Toggle checked={config.enabled} onChange={checked => updateConfig(next => { next.enabled = checked; })} label="Enable multi-WAN policy" />
                      </div>
                      <div className="lw-check-row">
                        <div className="lw-check-copy"><strong>Allow bridge firewall handling</strong><span>Permit the generated rules to account for customer traffic arriving through a bridge.</span></div>
                        <Toggle checked={config.allowBridgeFirewall} onChange={checked => updateConfig(next => { next.allowBridgeFirewall = checked; })} label="Allow bridge firewall handling" />
                      </div>
                    </div>
                  </div>
                </section>

                <section className="isp-card lw-section">
                  <div className="lw-section-head">
                    <div>
                      <div className="lw-section-title"><PlugZap size={17} /> Uplink inventory</div>
                      <p className="lw-section-note">{config.mode === "weighted" ? "Weights influence new connections; health checks remove failed uplinks from rotation." : "Position 1 is primary. Later uplinks are used only when earlier paths fail."}</p>
                    </div>
                    <button type="button" className="lw-btn lw-btn-primary" onClick={addWan}><Plus size={14} /> Add uplink</button>
                  </div>
                  <div className="lw-section-body">
                    <div className="lw-wan-list">
                      {config.wans.map((wan, index) => (
                        <div key={`${wan.position}-${wan.name}`} className={`lw-wan ${wan.enabled ? "" : "is-disabled"}`}>
                          <div className="lw-wan-head">
                            <div className="lw-wan-name"><span className="lw-wan-index">{wan.position}</span>{wan.name || `WAN ${wan.position}`} {wan.pppoeSecretConfigured && <span className="lw-status"><span className="lw-status-dot" /> secret configured</span>}</div>
                            <div className="lw-wan-actions">
                              <Toggle checked={wan.enabled} onChange={checked => updateConfig(next => { next.wans[index].enabled = checked; })} label={`Enable ${wan.name || `WAN ${wan.position}`}`} />
                              <button type="button" className="lw-btn lw-btn-icon" title="Move uplink up" aria-label="Move uplink up" onClick={() => moveWan(wan.position, -1)} disabled={index === 0}><ArrowUp size={13} /></button>
                              <button type="button" className="lw-btn lw-btn-icon" title="Move uplink down" aria-label="Move uplink down" onClick={() => moveWan(wan.position, 1)} disabled={index === config.wans.length - 1}><ArrowDown size={13} /></button>
                              <button type="button" className="lw-btn lw-btn-icon lw-btn-danger" title="Remove uplink" aria-label="Remove uplink" onClick={() => removeWan(wan.position)} disabled={config.wans.length <= 1}><Trash2 size={13} /></button>
                            </div>
                          </div>
                          <div className="lw-wan-body">
                            <div className="lw-field">
                              <label style={fieldLabel}>Uplink label</label>
                              <input className="lw-input" value={wan.name} onChange={event => updateConfig(next => { next.wans[index].name = event.target.value; })} placeholder="e.g. Safaricom fibre" />
                            </div>
                            <div className="lw-field">
                              <label style={fieldLabel}>Router interface</label>
                              <select className="lw-select" value={wan.interfaceName} onChange={event => updateConfig(next => { next.wans[index].interfaceName = event.target.value; })}>
                                <option value="">Select port</option>
                                {physicalInterfaces.map(item => <option key={item.name} value={item.name}>{item.name} · {item.type}{item.running ? "" : " · down"}</option>)}
                              </select>
                            </div>
                            <div className="lw-field">
                              <label style={fieldLabel}>Connection type</label>
                              <select className="lw-select" value={wan.connectionType} onChange={event => updateConfig(next => { next.wans[index].connectionType = event.target.value as ConnectionType; })}>
                                <option value="static">Static address</option>
                                <option value="pppoe">PPPoE client</option>
                              </select>
                            </div>
                            <div className="lw-field">
                              <label style={fieldLabel}>{config.mode === "weighted" ? "Connection weight" : "Failover order"}</label>
                              <input className="lw-input" type="number" min={1} step={1} value={config.mode === "weighted" ? wan.weight : wan.position} disabled={config.mode === "failover"} onChange={event => updateConfig(next => { next.wans[index].weight = Math.max(1, Number(event.target.value) || 1); })} />
                            </div>
                            {wan.connectionType === "static" ? (
                              <>
                                <div className="lw-field lw-span-2">
                                  <label style={fieldLabel}>Address / CIDR</label>
                                  <input className="lw-input" value={wan.staticAddressCidr} onChange={event => updateConfig(next => { next.wans[index].staticAddressCidr = event.target.value; })} placeholder="e.g. 197.248.12.10/30" />
                                </div>
                                <div className="lw-field">
                                  <label style={fieldLabel}>Gateway</label>
                                  <input className="lw-input" value={wan.gateway} onChange={event => updateConfig(next => { next.wans[index].gateway = event.target.value; })} placeholder="e.g. 197.248.12.9" />
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="lw-field">
                                  <label style={fieldLabel}>PPPoE username</label>
                                  <input className="lw-input" value={wan.pppoeUsername} onChange={event => updateConfig(next => { next.wans[index].pppoeUsername = event.target.value; })} placeholder="ISP account username" />
                                </div>
                                <div className="lw-field">
                                  <label style={fieldLabel}>PPPoE password</label>
                                  <input className="lw-input" type="password" value="" onChange={event => updateConfig(next => { next.wans[index].pppoePassword = event.target.value; if (event.target.value) next.wans[index].pppoeSecretConfigured = true; })} placeholder={wan.pppoeSecretConfigured ? "Enter to replace secret" : "Write-only secret"} autoComplete="new-password" />
                                  <div className="lw-secret-note">Stored passwords are never displayed. Leave blank to keep the current secret.</div>
                                </div>
                              </>
                            )}
                            <div className="lw-field">
                              <label style={fieldLabel}>Health check IP</label>
                              <input className="lw-input" value={wan.healthCheckIp} onChange={event => updateConfig(next => { next.wans[index].healthCheckIp = event.target.value; })} placeholder="1.1.1.1" />
                            </div>
                            <div className="lw-field lw-span-2">
                              <div className="lw-check-row" style={{ minHeight: 38 }}>
                                <div className="lw-check-copy"><strong>Promote an existing bridge port</strong><span>Remove this port from its current bridge before assigning it as WAN.</span></div>
                                <Toggle checked={wan.reassignFromBridge} onChange={checked => updateConfig(next => { next.wans[index].reassignFromBridge = checked; })} label={`Promote ${wan.interfaceName || "port"} from its bridge`} />
                              </div>
                            </div>
                            {wan.reassignFromBridge && (
                              <div className="lw-field">
                                <label style={fieldLabel}>Current bridge</label>
                                <select className="lw-select" value={wan.bridgeName} onChange={event => updateConfig(next => { next.wans[index].bridgeName = event.target.value; })}>
                                  <option value="">Select bridge</option>
                                  {interfaces.bridges.map(bridge => <option key={bridge.name} value={bridge.name}>{bridge.name}</option>)}
                                  {bridgePorts.filter(port => port.interface === wan.interfaceName).map(port => <option key={port.bridge} value={port.bridge}>{port.bridge} · detected</option>)}
                                </select>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                <section className="isp-card lw-section">
                  <div className="lw-section-head">
                    <div>
                      <div className="lw-section-title"><GitBranch size={17} /> LAN link pinning</div>
                      <p className="lw-section-note">Pin a customer-facing port to a WAN and apply the same symmetric cap to upload and download.</p>
                    </div>
                    <button type="button" className="lw-btn" onClick={addLanLink} disabled={interfaceNames.length === config.lanLinks.length}><Plus size={14} /> Add LAN link</button>
                  </div>
                  <div className="lw-table-wrap">
                    <table className="lw-table">
                      <thead><tr><th>LAN interface</th><th>Selected WAN</th><th>Symmetric cap</th><th aria-label="Remove link" /></tr></thead>
                      <tbody>
                        {config.lanLinks.length === 0 ? (
                          <tr><td className="lw-empty" colSpan={4}>No pinned LAN links. Customer traffic will follow the selected policy.</td></tr>
                        ) : config.lanLinks.map((link, index) => (
                          <tr key={`${link.interfaceName}-${index}`}>
                            <td><select className="lw-select" value={link.interfaceName} onChange={event => updateConfig(next => { next.lanLinks[index].interfaceName = event.target.value; })}>{interfaceNames.map(name => <option key={name} value={name}>{name}</option>)}</select></td>
                            <td><select className="lw-select" value={link.wanPosition} onChange={event => updateConfig(next => { next.lanLinks[index].wanPosition = Number(event.target.value); })}>{config.wans.map(wan => <option key={wan.position} value={wan.position}>{wan.position} · {wan.name || `WAN ${wan.position}`}</option>)}</select></td>
                            <td><div style={{ display: "flex", alignItems: "center", gap: 7 }}><input className="lw-input" type="number" min={1} step={1} value={link.maxMbps} onChange={event => updateConfig(next => { next.lanLinks[index].maxMbps = Math.max(1, Number(event.target.value) || 1); })} /><span style={{ color: "var(--isp-text-muted)", fontSize: 11 }}>Mbps</span></div></td>
                            <td><button type="button" className="lw-btn lw-btn-icon lw-btn-danger" title="Remove LAN link" aria-label="Remove LAN link" onClick={() => updateConfig(next => { next.lanLinks.splice(index, 1); })}><Trash2 size={13} /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              <aside className="isp-card lw-section lw-preview">
                <div className="lw-section-head">
                  <div>
                    <div className="lw-section-title"><Eye size={17} /> Change preview</div>
                    <p className="lw-section-note">Nothing is written to the router until you approve this preview.</p>
                  </div>
                </div>
                <div className="lw-section-body">
                  <div className="lw-preview-meta">
                    <div className="lw-metric"><span>Router</span><strong style={{ fontFamily: "inherit", fontSize: 13 }}>{routerName || "—"}</strong></div>
                    <div className="lw-metric"><span>Uplinks enabled</span><strong>{preview?.enabledWanCount ?? config.wans.filter(wan => wan.enabled).length}</strong></div>
                    <div className="lw-metric"><span>Policy</span><strong style={{ fontFamily: "inherit", fontSize: 13 }}>{config.mode === "weighted" ? "Weighted" : "Failover"}</strong></div>
                    <div className="lw-metric"><span>Connected via</span><strong style={{ fontFamily: "inherit", fontSize: 11 }}>{interfaces.connectedVia || "Router API"}</strong></div>
                  </div>
                  {localIssues.length > 0 && <Notice kind="warning"><strong>Needs attention:</strong> {localIssues[0]}</Notice>}
                  {!preview && localIssues.length === 0 && <Notice kind="info">Generate a preview to see RouterOS commands, warnings, and the exact change set.</Notice>}
                  {preview && (
                    <div style={{ marginTop: 12 }}>
                      {preview.errors.map(error => <div key={error} style={{ marginBottom: 7 }}><Notice kind="error">{error}</Notice></div>)}
                      {preview.warnings.map(warning => <div key={warning} style={{ marginBottom: 7 }}><Notice kind="warning">{warning}</Notice></div>)}
                      {preview.changes.length > 0 && (
                        <ul className="lw-change-list">{preview.changes.map(change => <li key={change}><Check size={13} /> <span>{change}</span></li>)}</ul>
                      )}
                      {preview.scriptPreview && <pre className="lw-code">{preview.scriptPreview}</pre>}
                      {preview.ok && preview.errors.length === 0 && <div className="lw-notice lw-notice-success" style={{ marginTop: 12 }}><CheckCircle2 size={16} /> Preview hash is ready for confirmation.</div>}
                    </div>
                  )}
                  <div style={{ display: "grid", gap: 8, marginTop: 15 }}>
                    <button type="button" className="lw-btn lw-btn-primary" onClick={() => void previewChanges()} disabled={previewing || !config.enabled || localIssues.length > 0}>
                      {previewing ? <Loader2 size={14} /> : <Activity size={14} />} {previewing ? "Generating preview…" : "Generate change preview"}
                    </button>
                    <button type="button" className="lw-btn" onClick={() => { if (preview?.ok && preview.errors.length === 0) setApplyOpen(true); }} disabled={!preview?.ok || preview.errors.length > 0 || applying}>
                      <Save size={14} /> Review and apply
                    </button>
                  </div>
                </div>
              </aside>
            </div>

            {recoveryAvailable && (
              <Notice kind="info"><strong>Recovery point available.</strong> The last successful apply can be rolled back from Policy guardrails if the router needs to return to its previous state.</Notice>
            )}
          </>
        )}
      </div>

      {applyOpen && preview && (
        <div className="lw-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setApplyOpen(false); }}>
          <div className="lw-modal" role="dialog" aria-modal="true" aria-labelledby="lw-apply-title">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div>
                <h2 id="lw-apply-title">Confirm live router change</h2>
                <p>This will install the previewed {config?.mode === "weighted" ? "weighted connection" : "failover"} policy on <strong>{routerName}</strong>. Existing customer sessions may choose a new path.</p>
              </div>
              <button type="button" className="lw-btn lw-btn-icon" aria-label="Close confirmation" onClick={() => setApplyOpen(false)}><X size={15} /></button>
            </div>
            <div className="lw-notice lw-notice-warning"><AlertTriangle size={16} /><span>Confirm the router name exactly to prevent an accidental apply to the wrong device.</span></div>
            <div style={{ marginTop: 14 }}>
              <label htmlFor="lw-confirm-name">Type {routerName} to confirm</label>
              <input id="lw-confirm-name" className="lw-input" value={confirmationName} onChange={event => setConfirmationName(event.target.value)} autoFocus />
            </div>
            <div className="lw-modal-actions">
              <button type="button" className="lw-btn" onClick={() => setApplyOpen(false)}>Cancel</button>
              <button type="button" className="lw-btn lw-btn-primary" disabled={applying || confirmationName.trim() !== routerName.trim()} onClick={() => void applyChanges()}>
                {applying ? <Loader2 size={14} /> : <Zap size={14} />} {applying ? "Applying…" : "Apply to router"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}