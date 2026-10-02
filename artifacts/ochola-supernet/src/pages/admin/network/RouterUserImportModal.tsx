import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { apiUrl, parseJsonResponse } from "@/lib/api-client";
import { getAdminApiToken } from "@/lib/supabase";

type ServiceType = "hotspot" | "pppoe";

interface ImportPlan {
  id: number;
  name: string;
  type: ServiceType | string;
  price: number;
  validity: number;
  validity_unit: string;
  speed_down: number;
  speed_up: number;
  speed_down_unit: string;
  speed_up_unit: string;
  data_cap_mode?: string | null;
}

interface ImportProfile {
  key: string;
  type: ServiceType;
  name: string;
  userCount: number;
  profileAvailable: boolean;
  rateLimit: string;
  localAddress: string;
  remoteAddress: string;
  sessionTimeout: string;
  idleTimeout: string;
  keepaliveTimeout: string;
  sharedUsers: number | null;
  onlyOne: boolean | null;
  comment: string;
}

interface ImportUser {
  key: string;
  type: ServiceType;
  username: string;
  sourceId: string;
  profileName: string;
  profileKey: string;
  sourceService: string;
  comment: string;
  disabled: boolean;
  passwordAvailable: boolean;
  localAddress: string;
  remoteAddress: string;
  callerId: string;
  macAddress: string;
  server: string;
  limitUptime: string;
  limitBytesTotal: number;
  bytesIn: number;
  bytesOut: number;
  quotaReached: boolean;
  supported: boolean;
  reason: string | null;
  duplicate: boolean;
  replaceable: boolean;
  existingCustomerName: string | null;
  existingCustomerPhone: string | null;
  existingCustomerId: number | null;
  existingCustomerUpdatedAt: string | null;
}

interface ImportPreview {
  routerId: number;
  routerName: string;
  capturedAt: string;
  users: ImportUser[];
  profiles: ImportProfile[];
  plans: ImportPlan[];
}

interface ApiError {
  error?: string;
  code?: string;
}

interface UserEdit {
  name: string;
  phone: string;
  password: string;
}

type PackageChoice =
  | { mode: "existing"; profileKey: string; planId: number }
  | {
      mode: "create";
      profileKey: string;
      name: string;
      price: string;
      validityDays: string;
      speedDown: string;
      speedUp: string;
    };

async function importRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAdminApiToken();
  if (!token) throw new Error("Your admin session has expired. Sign in again.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(apiUrl(path), { ...init, headers, cache: "no-store" });
  const body = await parseJsonResponse<T & ApiError>(response);
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Request failed (HTTP ${response.status}).`);
  }
  return body;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      });
}

function profileHasRouterByteCap(profile: ImportProfile, selectedUsers: ImportUser[]): boolean {
  return selectedUsers.some(user =>
    user.profileKey === profile.key
    && user.type === "hotspot"
    && user.limitBytesTotal > 0,
  );
}

function matchingPlans(
  profile: ImportProfile,
  preview: ImportPreview,
  selectedUsers: ImportUser[],
): ImportPlan[] {
  const hasRouterByteCap = profileHasRouterByteCap(profile, selectedUsers);
  return preview.plans.filter(plan =>
    String(plan.type).toLowerCase() === profile.type
    && (!hasRouterByteCap || String(plan.data_cap_mode ?? "disconnect").toLowerCase() !== "throttle"),
  );
}

function defaultChoice(
  profile: ImportProfile,
  preview: ImportPreview,
  selectedUsers: ImportUser[],
): PackageChoice {
  const match = matchingPlans(profile, preview, selectedUsers).find(plan =>
    plan.name.trim().toLowerCase() === profile.name.trim().toLowerCase(),
  );
  if (match) {
    return { mode: "existing", profileKey: profile.key, planId: Number(match.id) };
  }
  return {
    mode: "create",
    profileKey: profile.key,
    name: `${preview.routerName} ${profile.type === "pppoe" ? "PPPoE" : "Hotspot"} ${profile.name}`.trim().slice(0, 100),
    price: "",
    validityDays: "",
    speedDown: "",
    speedUp: "",
  };
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function RouterUserImportModal({
  routerId,
  routerName,
  onClose,
}: {
  routerId: number;
  routerName: string;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [userEdits, setUserEdits] = useState<Record<string, UserEdit>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [packageChoices, setPackageChoices] = useState<Record<string, PackageChoice>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<{
    importedUsers: number;
    replacedUsers: number;
    createdPackages: number;
    suspendedUsers: number;
    quotaExhaustedUsers: number;
  } | null>(null);

  async function loadPreview() {
    setLoading(true);
    setError("");
    try {
      const data = await importRequest<ImportPreview>(
        `/api/router-user-snapshots/${routerId}/import-preview`,
      );
      setPreview(data);
      setSelected(Object.fromEntries(
        data.users.map(user => [user.key, user.supported && !user.duplicate]),
      ));
      setUserEdits(Object.fromEntries(
        data.users.map(user => [
          user.key,
          {
            name: user.existingCustomerName ?? user.username,
            phone: user.existingCustomerPhone ?? "",
            password: "",
          },
        ]),
      ));
      setPackageChoices(Object.fromEntries(
        data.profiles.map(profile => [
          profile.key,
          defaultChoice(profile, data, data.users.filter(user => user.supported && !user.duplicate)),
        ]),
      ));
      setNotice("");
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "The account import preview could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPreview();
  }, [routerId]);

  const selectedUsers = useMemo(
    () => preview?.users.filter(user => selected[user.key]) ?? [],
    [preview, selected],
  );
  const selectedReplacementCount = selectedUsers.filter(user => user.replaceable).length;
  const usedProfiles = useMemo(() => {
    if (!preview) return [];
    const used = new Set(selectedUsers.map(user => user.profileKey));
    return preview.profiles.filter(profile => used.has(profile.key));
  }, [preview, selectedUsers]);

  const snapshotAgeMs = preview ? Date.now() - new Date(preview.capturedAt).getTime() : Number.POSITIVE_INFINITY;
  const snapshotFresh = Number.isFinite(snapshotAgeMs) && snapshotAgeMs >= 0 && snapshotAgeMs <= 24 * 60 * 60 * 1000;

  const reviewComplete = Boolean(preview)
    && snapshotFresh
    && selectedUsers.length > 0
    && selectedUsers.every(user => {
      const edit = userEdits[user.key];
      return Boolean(
        user.supported
        && (!user.duplicate || user.replaceable)
        && edit?.name.trim()
        && edit.phone.trim()
        && (
          user.passwordAvailable
          || user.disabled
          || user.quotaReached
          || edit.password.length >= 8
        ),
      );
    })
    && usedProfiles.every(profile => {
      const choice = packageChoices[profile.key];
      if (!choice) return false;
      if (choice.mode === "existing") {
        return matchingPlans(profile, preview!, selectedUsers)
          .some(plan => Number(plan.id) === choice.planId);
      }
      const price = Number(choice.price);
      const validity = Number(choice.validityDays);
      const speedDown = Number(choice.speedDown);
      const speedUp = Number(choice.speedUp);
      return Boolean(
        choice.name.trim()
        && Number.isFinite(price) && price >= 0
        && Number.isInteger(validity) && validity >= 1 && validity <= 3650
        && Number.isFinite(speedDown) && speedDown > 0
        && Number.isFinite(speedUp) && speedUp > 0,
      );
    });

  async function refreshFromRouter() {
    setRefreshing(true);
    setError("");
    setNotice("");
    try {
      await importRequest(
        `/api/router-user-snapshots/${routerId}/sync`,
        { method: "POST", body: "{}" },
      );
      await loadPreview();
      setNotice("Router users and package profiles refreshed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The router backup could not be refreshed.");
    } finally {
      setRefreshing(false);
    }
  }

  async function submitImport() {
    if (!preview || !reviewComplete || importing) return;
    const confirmation = window.confirm(
      `Import ${selectedUsers.length} router user${selectedUsers.length === 1 ? "" : "s"} into ${routerName}? ${selectedReplacementCount > 0 ? `${selectedReplacementCount} matching account${selectedReplacementCount === 1 ? "" : "s"} will be updated in place; their account history and expiry stay, and active sessions will not be disconnected. New RADIUS settings apply at the next login.` : "No existing accounts will be replaced."}`,
    );
    if (!confirmation) return;

    setImporting(true);
    setError("");
    setNotice("");
    try {
      const packages = usedProfiles.map(profile => packageChoices[profile.key]!);
      const users = selectedUsers.map(user => {
        const edit = userEdits[user.key]!;
        return {
          key: user.key,
          name: edit.name.trim(),
          phone: edit.phone.trim(),
          ...(user.replaceable
            ? {
                replaceTargetId: user.existingCustomerId,
                replaceTargetUpdatedAt: user.existingCustomerUpdatedAt,
              }
            : {}),
          ...(!user.passwordAvailable && !user.disabled && !user.quotaReached
            ? { password: edit.password }
            : {}),
        };
      });
      const imported = await importRequest<{
        importedUsers: number;
        replacedUsers: number;
        createdPackages: number;
        suspendedUsers: number;
        quotaExhaustedUsers: number;
      }>(`/api/router-user-snapshots/${routerId}/import`, {
        method: "POST",
        body: JSON.stringify({ capturedAt: preview.capturedAt, users, packages }),
      });
      setResult(imported);
      setNotice("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The selected accounts could not be imported.");
    } finally {
      setImporting(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", minWidth: 0, boxSizing: "border-box",
    padding: "0.48rem 0.55rem", borderRadius: 6,
    border: "1px solid var(--isp-border)", background: "rgba(0,0,0,0.16)",
    color: "var(--isp-text)", fontSize: "0.75rem",
  };
  const secondaryButtonStyle: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    padding: "0.52rem 0.7rem", borderRadius: 7,
    border: "1px solid var(--isp-border)", background: "rgba(255,255,255,0.04)",
    color: "var(--isp-text)", fontSize: "0.75rem", fontWeight: 650, cursor: "pointer",
  };

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1200, padding: "1rem",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.72)",
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="router-user-import-title"
        onClick={event => event.stopPropagation()}
        style={{
          width: "100%", maxWidth: 920, maxHeight: "92vh", overflow: "hidden",
          display: "flex", flexDirection: "column", borderRadius: 12, padding: "1.15rem",
          background: "var(--isp-section)", border: "1px solid var(--isp-border)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h2 id="router-user-import-title" style={{ margin: 0, color: "var(--isp-text)", fontSize: "1rem" }}>
              Import MikroTik users
            </h2>
            <p style={{ margin: "0.3rem 0 0", color: "var(--isp-text-muted)", fontSize: "0.76rem" }}>
              {routerName} · add reviewed accounts to this ISP account
            </p>
          </div>
          <button
            type="button"
            aria-label="Close account import"
            onClick={onClose}
            style={{ border: 0, background: "transparent", color: "var(--isp-text-muted)", cursor: "pointer", padding: 4 }}
          >
            <X size={17} />
          </button>
        </header>

        <div style={{
          display: "flex", gap: 9, marginTop: "0.85rem", padding: "0.65rem 0.7rem",
          borderRadius: 8, color: "#a7f3d0", background: "rgba(16,185,129,0.08)",
          border: "1px solid rgba(16,185,129,0.2)", fontSize: "0.72rem", lineHeight: 1.5,
        }}>
          <ShieldCheck size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Router passwords are never shown in this preview. You must provide missing passwords, contact numbers,
            and package price, speed, and validity. Disabled users stay suspended; per-user Hotspot caps, usage
            counters, and profile details are preserved. Replacements keep the existing account, expiry, usage,
            and billing history; active sessions stay connected, and new RADIUS settings apply at the next login.
            New accounts do not copy billing history.
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: "0.75rem" }}>
          <div style={{ color: "var(--isp-text-muted)", fontSize: "0.72rem" }}>
            {preview
              ? `${preview.users.length} users · ${preview.profiles.length} profiles · backup ${formatDate(preview.capturedAt)}`
              : "Review source users and package profiles before importing."}
          </div>
          <button
            type="button"
            onClick={() => void refreshFromRouter()}
            disabled={refreshing || loading || importing}
            style={{ ...secondaryButtonStyle, opacity: refreshing || loading || importing ? 0.65 : 1 }}
          >
            {refreshing
              ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
              : <RefreshCw size={13} />}
            Refresh from router
          </button>
        </div>

        {loading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "1.5rem 0", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}>
            <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Loading the private import preview…
          </div>
        ) : error && !preview ? (
          <div style={{ marginTop: "0.85rem", padding: "0.9rem", borderRadius: 8, background: "rgba(248,113,113,0.08)", color: "#fecaca", fontSize: "0.77rem" }}>
            <AlertCircle size={14} style={{ verticalAlign: "middle", marginRight: 5 }} />{error}
            <p style={{ margin: "0.55rem 0 0", color: "var(--isp-text-muted)" }}>
              Refresh the router backup to capture its user profiles before importing.
            </p>
          </div>
        ) : result ? (
          <div style={{ marginTop: "1rem", padding: "1rem", borderRadius: 8, background: "rgba(16,185,129,0.08)", color: "#a7f3d0", fontSize: "0.82rem", lineHeight: 1.6 }}>
            <CheckCircle size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />
            Imported {result.importedUsers} users{result.replacedUsers > 0 ? `, replacing ${result.replacedUsers} existing accounts` : ""} and created {result.createdPackages} packages.
            {result.suspendedUsers > 0 && ` ${result.suspendedUsers} accounts were imported as suspended.`}
            {result.quotaExhaustedUsers > 0 && ` ${result.quotaExhaustedUsers} users at their data limit were imported as expired.`}
          </div>
        ) : preview ? (
          <>
            {!snapshotFresh && (
              <p role="alert" style={{ margin: "0.65rem 0 0", color: "#fbbf24", fontSize: "0.74rem" }}>
                This backup is older than 24 hours. Refresh it before importing.
              </p>
            )}
            {selectedReplacementCount > 0 && (
              <p role="status" style={{ margin: "0.65rem 0 0", padding: "0.55rem 0.65rem", borderRadius: 7, background: "rgba(251,191,36,0.08)", color: "#fde68a", fontSize: "0.72rem", lineHeight: 1.5 }}>
                {selectedReplacementCount} selected account{selectedReplacementCount === 1 ? "" : "s"} will be updated in place. Existing sessions and history stay intact; the new policy applies at the next login.
              </p>
            )}
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0, marginTop: "0.65rem", paddingRight: 3 }}>
              <h3 style={{ margin: "0 0 0.45rem", color: "var(--isp-text)", fontSize: "0.82rem" }}>
                Users
              </h3>
              <div style={{ display: "grid", gap: 7 }}>
                {preview.users.map(user => {
                  const edit = userEdits[user.key] ?? { name: user.username, phone: "", password: "" };
                  const blocked = !user.supported || (user.duplicate && !user.replaceable);
                  return (
                    <article key={user.key} style={{
                      padding: "0.7rem", borderRadius: 8,
                      border: "1px solid var(--isp-border-subtle)",
                      background: blocked ? "rgba(255,255,255,0.015)" : "rgba(255,255,255,0.025)",
                      opacity: blocked ? 0.75 : 1,
                    }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(selected[user.key])}
                          disabled={blocked || importing}
                          onChange={event => setSelected(current => ({ ...current, [user.key]: event.target.checked }))}
                          aria-label={`Select ${user.username}`}
                          style={{ marginTop: 4, accentColor: "var(--isp-accent)" }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                            <strong style={{ color: "var(--isp-text)", fontSize: "0.78rem" }}>{user.username || "(missing username)"}</strong>
                            <span style={{ color: "var(--isp-text-muted)", fontSize: "0.68rem" }}>
                              {user.type === "pppoe" ? "PPPoE" : "Hotspot"} · {user.profileName}
                            </span>
                            {user.replaceable && <span style={{ color: "#fde68a", fontSize: "0.66rem" }}>Existing account · replaceable</span>}
                            {user.disabled && <span style={{ color: "#fbbf24", fontSize: "0.66rem" }}>Disabled on router</span>}
                            {!user.disabled && user.quotaReached && <span style={{ color: "#fbbf24", fontSize: "0.66rem" }}>Data limit reached</span>}
                          </div>
                          <div style={{ marginTop: 3, color: "var(--isp-text-muted)", fontSize: "0.67rem", lineHeight: 1.45 }}>
                            {user.type === "pppoe"
                              ? `Service ${user.sourceService || "any"} · remote ${user.remoteAddress || "not set"} · caller ID ${user.callerId || "not set"}`
                              : `Usage ${formatBytes(user.bytesIn + user.bytesOut)} · limit ${user.limitBytesTotal ? formatBytes(user.limitBytesTotal) : "not set"} · uptime limit ${user.limitUptime || "not set"}`}
                            {user.comment ? ` · ${user.comment}` : ""}
                          </div>
                          {blocked ? (
                            <p style={{ margin: "0.35rem 0 0", color: user.duplicate ? "#fca5a5" : "#fbbf24", fontSize: "0.7rem" }}>
                              {user.reason ?? (user.duplicate ? "Username already exists and cannot be replaced." : "This user is not supported.")}
                            </p>
                          ) : (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 7, marginTop: 8 }}>
                              <label style={{ color: "var(--isp-text-muted)", fontSize: "0.67rem" }}>
                                Customer name
                                <input
                                  value={edit.name}
                                  onChange={event => setUserEdits(current => ({ ...current, [user.key]: { ...edit, name: event.target.value } }))}
                                  style={{ ...inputStyle, marginTop: 3 }}
                                  maxLength={160}
                                />
                              </label>
                              <label style={{ color: "var(--isp-text-muted)", fontSize: "0.67rem" }}>
                                Phone number
                                <input
                                  value={edit.phone}
                                  onChange={event => setUserEdits(current => ({ ...current, [user.key]: { ...edit, phone: event.target.value } }))}
                                  style={{ ...inputStyle, marginTop: 3 }}
                                  type="tel"
                                  maxLength={80}
                                  placeholder="Required for the account"
                                />
                              </label>
                              {!user.passwordAvailable && !user.disabled && !user.quotaReached && (
                                <label style={{ color: "var(--isp-text-muted)", fontSize: "0.67rem" }}>
                                  Set password
                                  <input
                                    value={edit.password}
                                    onChange={event => setUserEdits(current => ({ ...current, [user.key]: { ...edit, password: event.target.value } }))}
                                    style={{ ...inputStyle, marginTop: 3 }}
                                    type="password"
                                    autoComplete="new-password"
                                    minLength={8}
                                    maxLength={1024}
                                    placeholder="At least 8 characters"
                                  />
                                </label>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              {usedProfiles.length > 0 && (
                <>
                  <h3 style={{ margin: "1rem 0 0.45rem", color: "var(--isp-text)", fontSize: "0.82rem" }}>
                    Package mapping
                  </h3>
                  <div style={{ display: "grid", gap: 8 }}>
                    {usedProfiles.map(profile => {
                      const choice = packageChoices[profile.key] ?? defaultChoice(profile, preview, selectedUsers);
                      const profileHasByteCap = profileHasRouterByteCap(profile, selectedUsers);
                      const availablePlans = matchingPlans(profile, preview, selectedUsers);
                      return (
                        <article key={profile.key} style={{
                          padding: "0.75rem", borderRadius: 8,
                          border: "1px solid var(--isp-border-subtle)", background: "rgba(255,255,255,0.025)",
                        }}>
                          <div style={{ color: "var(--isp-text)", fontSize: "0.77rem", fontWeight: 700 }}>
                            {profile.type === "pppoe" ? "PPPoE" : "Hotspot"} profile: {profile.name}
                            <span style={{ marginLeft: 6, color: "var(--isp-text-muted)", fontSize: "0.67rem", fontWeight: 400 }}>
                              {profile.userCount} source users
                            </span>
                          </div>
                          <div style={{ marginTop: 4, color: "var(--isp-text-muted)", fontSize: "0.68rem", lineHeight: 1.45 }}>
                            {profile.profileAvailable
                              ? `RouterOS rate ${profile.rateLimit || "not set"} · session ${profile.sessionTimeout || "not set"}${profile.idleTimeout ? ` · idle ${profile.idleTimeout}` : ""}${profile.sharedUsers ? ` · shared users ${profile.sharedUsers}` : ""}`
                              : "The user references a profile that was not found in the backup; enter the package settings manually."}
                          </div>
                          {profileHasByteCap && (
                            <div style={{ marginTop: 4, color: "#fbbf24", fontSize: "0.67rem", lineHeight: 1.4 }}>
                              This profile includes per-user RouterOS byte limits. Use a disconnect-cap package; throttle packages cannot preserve those hard limits.
                            </div>
                          )}
                          <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 0.8fr) minmax(240px, 1.2fr)", gap: 8, marginTop: 9 }}>
                            <label style={{ color: "var(--isp-text-muted)", fontSize: "0.67rem" }}>
                              Package action
                              <select
                                value={choice.mode}
                                onChange={event => {
                                  const next: PackageChoice = event.target.value === "existing"
                                    ? {
                                        mode: "existing",
                                        profileKey: profile.key,
                                        planId: availablePlans[0] ? Number(availablePlans[0].id) : 0,
                                      }
                                    : {
                                        mode: "create",
                                        profileKey: profile.key,
                                        name: `${preview.routerName} ${profile.type === "pppoe" ? "PPPoE" : "Hotspot"} ${profile.name}`.trim().slice(0, 100),
                                        price: "",
                                        validityDays: "",
                                        speedDown: "",
                                        speedUp: "",
                                      };
                                  setPackageChoices(current => ({ ...current, [profile.key]: next }));
                                }}
                                style={{ ...inputStyle, marginTop: 3 }}
                              >
                                <option value="existing" disabled={availablePlans.length === 0}>Use an existing package</option>
                                <option value="create">Create a package from reviewed details</option>
                              </select>
                            </label>
                            {choice.mode === "existing" ? (
                              <label style={{ color: "var(--isp-text-muted)", fontSize: "0.67rem" }}>
                                Existing {profile.type} package
                                <select
                                  value={choice.planId || ""}
                                  onChange={event => setPackageChoices(current => ({
                                    ...current,
                                    [profile.key]: { mode: "existing", profileKey: profile.key, planId: Number(event.target.value) },
                                  }))}
                                  style={{ ...inputStyle, marginTop: 3 }}
                                >
                                  <option value="" disabled>Select a package</option>
                                  {availablePlans.map(plan => (
                                    <option key={plan.id} value={plan.id}>
                                      {plan.name} · {Number(plan.price).toLocaleString()} · {plan.validity} {plan.validity_unit}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : (
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 6 }}>
                                <label style={{ color: "var(--isp-text-muted)", fontSize: "0.67rem" }}>
                                  Package name
                                  <input
                                    value={choice.name}
                                    onChange={event => setPackageChoices(current => ({ ...current, [profile.key]: { ...choice, name: event.target.value } }))}
                                    style={{ ...inputStyle, marginTop: 3 }}
                                    maxLength={100}
                                  />
                                </label>
                                <label style={{ color: "var(--isp-text-muted)", fontSize: "0.67rem" }}>
                                  Price
                                  <input
                                    value={choice.price}
                                    onChange={event => setPackageChoices(current => ({ ...current, [profile.key]: { ...choice, price: event.target.value } }))}
                                    style={{ ...inputStyle, marginTop: 3 }}
                                    type="number"
                                    min="0"
                                    step="0.01"
                                  />
                                </label>
                                <label style={{ color: "var(--isp-text-muted)", fontSize: "0.67rem" }}>
                                  Speed down (Mbps)
                                  <input
                                    value={choice.speedDown}
                                    onChange={event => setPackageChoices(current => ({ ...current, [profile.key]: { ...choice, speedDown: event.target.value } }))}
                                    style={{ ...inputStyle, marginTop: 3 }}
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                  />
                                </label>
                                <label style={{ color: "var(--isp-text-muted)", fontSize: "0.67rem" }}>
                                  Speed up (Mbps)
                                  <input
                                    value={choice.speedUp}
                                    onChange={event => setPackageChoices(current => ({ ...current, [profile.key]: { ...choice, speedUp: event.target.value } }))}
                                    style={{ ...inputStyle, marginTop: 3 }}
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                  />
                                </label>
                                <label style={{ color: "var(--isp-text-muted)", fontSize: "0.67rem" }}>
                                  Validity (days)
                                  <input
                                    value={choice.validityDays}
                                    onChange={event => setPackageChoices(current => ({ ...current, [profile.key]: { ...choice, validityDays: event.target.value } }))}
                                    style={{ ...inputStyle, marginTop: 3 }}
                                    type="number"
                                    min="1"
                                    max="3650"
                                    step="1"
                                  />
                                </label>
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </>
        ) : null}

        {error && preview && (
          <p role="alert" style={{ margin: "0.65rem 0 0", color: "#f87171", fontSize: "0.74rem", lineHeight: 1.45 }}>
            <AlertCircle size={14} style={{ verticalAlign: "middle", marginRight: 5 }} />{error}
          </p>
        )}
        {notice && (
          <p role="status" style={{ margin: "0.55rem 0 0", color: "#4ade80", fontSize: "0.74rem" }}>
            <CheckCircle size={14} style={{ verticalAlign: "middle", marginRight: 5 }} />{notice}
          </p>
        )}

        <footer style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginTop: "0.8rem" }}>
          <div style={{ color: "var(--isp-text-muted)", fontSize: "0.7rem", alignSelf: "center" }}>
            {preview
              ? `${selectedUsers.length} selected · ${selectedReplacementCount} replacements · ${usedProfiles.length} package mappings`
              : ""}
          </div>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button type="button" onClick={onClose} style={secondaryButtonStyle}>
              {result ? "Done" : "Cancel"}
            </button>
            {!result && (
              <button
                type="button"
                onClick={() => void submitImport()}
                disabled={!reviewComplete || importing}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 0.85rem",
                  borderRadius: 7, border: "1px solid var(--isp-accent-border)",
                  background: "var(--isp-accent)", color: "#fff", fontSize: "0.76rem",
                  fontWeight: 700, cursor: !reviewComplete || importing ? "not-allowed" : "pointer",
                  opacity: !reviewComplete || importing ? 0.65 : 1,
                }}
              >
                {importing
                  ? <><Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Importing…</>
                  : <>Import {selectedUsers.length} selected</>}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
