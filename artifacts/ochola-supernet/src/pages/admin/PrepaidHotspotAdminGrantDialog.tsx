import React, { useMemo, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, UserRound, Wifi, X } from "lucide-react";
import { ADMIN_ID, getAdminApiToken } from "@/lib/supabase";
import { apiUrl } from "@/lib/api-client";

export interface AdminHotspotGrantPlan {
  id: number;
  name: string;
  type: string;
  price: number;
  speed_down: number;
  speed_up: number;
  speed_down_unit?: string;
  speed_up_unit?: string;
  router_id?: number | null;
  port_id?: number | null;
  is_active?: boolean;
}

export interface AdminHotspotGrantRouter {
  id: number;
  name: string;
  status?: string;
}

interface ExistingHotspotMatch {
  id: number;
  name: string | null;
  phone: string | null;
  username: string | null;
  mac_address: string | null;
  plan_id: number | null;
  router_id: number | null;
  port_id: number | null;
  status: string;
  expires_at: string | null;
  matchType: "device" | "name" | "device_and_name";
  eligible: boolean;
  reason: string | null;
}

interface GrantResult {
  customerId: number;
  username: string;
  password?: string;
  expiresAt: string;
  connectionMessage: string;
  connected: boolean;
  created: boolean;
  listRefreshWarning?: string;
}

function localDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "unknown"
    : date.toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

export function PrepaidHotspotAdminGrantDialog({
  plans,
  routers,
  onClose,
  onCreated,
}: {
  plans: AdminHotspotGrantPlan[];
  routers: AdminHotspotGrantRouter[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [macAddress, setMacAddress] = useState("");
  const [routerId, setRouterId] = useState("");
  const [planId, setPlanId] = useState("");
  const [matches, setMatches] = useState<ExistingHotspotMatch[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [result, setResult] = useState<GrantResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const directHotspotPlans = useMemo(
    () => plans.filter(plan =>
      plan.type.toLowerCase() === "hotspot"
      && plan.router_id === Number(routerId)
      && plan.port_id == null
      && plan.is_active !== false,
    ),
    [plans, routerId],
  );
  const selectedPlan = directHotspotPlans.find(plan => String(plan.id) === planId);
  const selectedMatch = matches.find(match => String(match.id) === selectedMatchId);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "0.62rem 0.7rem",
    borderRadius: 7,
    background: "var(--isp-input-bg)",
    border: "1px solid var(--isp-border)",
    color: "var(--isp-text)",
    font: "inherit",
    fontSize: "0.8rem",
  };

  async function authenticatedFetch(url: string, init: RequestInit) {
    const token = getAdminApiToken();
    if (!token) throw new Error("Your admin session has expired. Sign in again before granting access.");
    const response = await fetch(apiUrl(url), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    return { response, payload };
  }

  async function reconnect(customerId: number) {
    try {
      const { response, payload } = await authenticatedFetch(`/api/customers/${customerId}/hotspot-reconnect`, {
        method: "POST",
        body: JSON.stringify({ adminId: ADMIN_ID }),
      });
      const status = String(payload?.status ?? "");
      if (response.ok && (status === "connected" || status === "already_connected")) {
        return { connected: true, message: "The router confirmed that the TV is connected." };
      }
      return {
        connected: false,
        message: String(payload?.message ?? "The account is active, but the router has not confirmed a live TV session yet."),
      };
    } catch {
      return {
        connected: false,
        message: "The account is active on MikroTik. The live TV connection could not be checked; use Reconnect on the account row when the TV is on Wi‑Fi.",
      };
    }
  }

  async function finishGrant(grant: Omit<GrantResult, "connectionMessage" | "connected">) {
    setResult({
      ...grant,
      connectionMessage: "MikroTik confirmed the grant. Checking the TV connection…",
      connected: false,
    });
    let listRefreshWarning: string | undefined;
    try {
      await onCreated();
    } catch {
      listRefreshWarning = "The grant succeeded, but the Prepaid Users list could not refresh. Reload the page to see the updated account.";
    }
    const connection = await reconnect(grant.customerId);
    setResult({
      ...grant,
      connectionMessage: connection.message,
      connected: connection.connected,
      ...(listRefreshWarning ? { listRefreshWarning } : {}),
    });
  }

  async function checkAndGrant() {
    setError("");
    setResult(null);
    setMatches([]);
    setSelectedMatchId("");
    setSaving(true);
    try {
      const { response, payload } = await authenticatedFetch("/api/customers/hotspot-admin-grant", {
        method: "POST",
        body: JSON.stringify({
          adminId: ADMIN_ID,
          name: name.trim(),
          phone: phone.trim(),
          macAddress: macAddress.trim(),
          routerId: Number(routerId),
          planId: Number(planId),
        }),
      });
      if (
        response.status === 409
        && payload?.code === "HOTSPOT_ADMIN_GRANT_MATCHES"
        && Array.isArray(payload.matches)
      ) {
        const found = payload.matches as ExistingHotspotMatch[];
        setMatches(found);
        const eligible = found.filter(match => match.eligible);
        if (eligible.length === 1) setSelectedMatchId(String(eligible[0].id));
        if (!found.length) throw new Error("The account could not be matched safely.");
        return;
      }
      if (!response.ok) {
        const savedPendingAccount = typeof payload?.customerId === "number";
        if (savedPendingAccount) await onCreated();
        const retryMessage = savedPendingAccount
          ? ` A pending prepaid row #${payload?.customerId} was retained${payload?.username ? ` for ${String(payload.username)}` : ""}; refresh and repair that same row instead of creating another account.`
          : "";
        throw new Error(`${String(payload?.error ?? "The Hotspot grant could not be saved.")}${retryMessage}`);
      }
      if (
        typeof payload?.customerId !== "number"
        || typeof payload.username !== "string"
        || typeof payload.password !== "string"
        || typeof payload.expiresAt !== "string"
        || payload.mikrotikSynced !== true
      ) {
        throw new Error("The server did not confirm the MikroTik account. Refresh Prepaid Users before retrying.");
      }
      await finishGrant({
        customerId: payload.customerId,
        username: payload.username,
        password: payload.password,
        expiresAt: payload.expiresAt,
        created: true,
      });
    } catch (grantError) {
      setError(grantError instanceof Error ? grantError.message : "The Hotspot grant could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function grantExistingAccount() {
    if (!selectedMatch || !selectedPlan) return;
    setError("");
    setResult(null);
    setSaving(true);
    try {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { response, payload } = await authenticatedFetch(`/api/customers/${selectedMatch.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          adminId: ADMIN_ID,
          name: name.trim(),
          phone: phone.trim() || selectedMatch.phone,
          type: "hotspot",
          plan_id: selectedPlan.id,
          router_id: Number(routerId),
          mac_address: macAddress.trim(),
          status: "active",
          expires_at: expiresAt,
        }),
      });
      if (!response.ok) throw new Error(String(payload?.error ?? "The existing account could not be updated."));
      if (payload?.mikrotikSynced !== true) {
        throw new Error("The server did not confirm the MikroTik update. Refresh this account before retrying.");
      }
      await finishGrant({
        customerId: selectedMatch.id,
        username: selectedMatch.username ?? "existing Hotspot login",
        expiresAt,
        created: false,
      });
    } catch (grantError) {
      setError(grantError instanceof Error ? grantError.message : "The selected account could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = name.trim().length > 0
    && macAddress.trim().length > 0
    && Boolean(routerId && planId && selectedPlan)
    && !saving;

  return (
    <div
      className="prepaid-modal-backdrop"
      onClick={event => { if (event.target === event.currentTarget && !saving) onClose(); }}
    >
      <div className="prepaid-modal prepaid-admin-grant-modal" role="dialog" aria-modal="true" aria-labelledby="hotspot-admin-grant-title">
        <div className="prepaid-modal-heading">
          <div>
            <h2 id="hotspot-admin-grant-title">Grant Hotspot access</h2>
            <p>30 days · applied to MikroTik · no payment transaction is created</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close Hotspot grant" className="prepaid-icon-button">
            <X size={15} />
          </button>
        </div>

        {!result ? (
          <>
            <div className="prepaid-admin-grant-content">
              <div className="prepaid-form-grid">
                <label>
                  Customer name
                  <input autoFocus style={inputStyle} value={name} maxLength={100} onChange={event => { setName(event.target.value); setMatches([]); setSelectedMatchId(""); }} />
                </label>
                <label>
                  Phone number (optional)
                  <input style={inputStyle} type="tel" value={phone} maxLength={40} onChange={event => setPhone(event.target.value)} />
                </label>
                <label style={{ gridColumn: "1 / -1" }}>
                  TV device MAC address
                  <input
                    style={inputStyle}
                    autoCapitalize="characters"
                    autoComplete="off"
                    placeholder="38:BE:AB:7F:16:A4"
                    value={macAddress}
                    onChange={event => { setMacAddress(event.target.value.toUpperCase()); setMatches([]); setSelectedMatchId(""); }}
                  />
                  <span className="prepaid-help">This associates the prepaid record with the TV. Router login is still required for the device to authenticate.</span>
                </label>
                <label>
                  Router
                  <select style={inputStyle} value={routerId} onChange={event => { setRouterId(event.target.value); setPlanId(""); setMatches([]); }}>
                    <option value="">Choose a router</option>
                    {routers.map(router => <option key={router.id} value={router.id}>{router.name}</option>)}
                  </select>
                </label>
                <label>
                  Direct Hotspot plan
                  <select style={inputStyle} value={planId} onChange={event => setPlanId(event.target.value)}>
                    <option value="">Choose a plan</option>
                    {directHotspotPlans.map(plan => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name} · {plan.speed_down} {plan.speed_down_unit ?? "Mbps"} · {plan.speed_up} {plan.speed_up_unit ?? "Mbps"}
                      </option>
                    ))}
                  </select>
                  {directHotspotPlans.length === 0 && routerId && (
                    <span className="prepaid-help">No active direct Hotspot plan is assigned to this router.</span>
                  )}
                </label>
                <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "flex-start", padding: "0.65rem 0.75rem", border: "1px solid var(--isp-border)", borderRadius: 8, color: "var(--isp-text-muted)", fontSize: "0.74rem" }}>
                  <Wifi size={15} style={{ flexShrink: 0, marginTop: 1, color: "var(--isp-accent)" }} />
                  Grant length is fixed at 30 days. A matching account is selected for in-place update; duplicate records are never created automatically.
                </div>
              </div>

              {matches.length > 0 && (
                <section aria-label="Matching Hotspot accounts" style={{ marginTop: 14, display: "grid", gap: 8 }}>
                  <div style={{ fontSize: "0.76rem", fontWeight: 700, color: "var(--isp-text)" }}>
                    Existing matching records
                  </div>
                  {matches.map(match => (
                    <label
                      key={match.id}
                      style={{
                        display: "flex",
                        gap: 9,
                        alignItems: "flex-start",
                        padding: "0.7rem",
                        borderRadius: 8,
                        border: `1px solid ${selectedMatchId === String(match.id) ? "var(--isp-accent)" : "var(--isp-border)"}`,
                        opacity: match.eligible ? 1 : 0.62,
                        fontSize: "0.74rem",
                      }}
                    >
                      <input
                        type="radio"
                        name="hotspot-grant-existing"
                        disabled={!match.eligible || saving}
                        checked={selectedMatchId === String(match.id)}
                        onChange={() => setSelectedMatchId(String(match.id))}
                      />
                      <span style={{ minWidth: 0 }}>
                        <strong style={{ display: "block", color: "var(--isp-text)" }}>
                          {match.username || "Missing username"} · #{match.id}
                        </strong>
                        <span style={{ display: "block", color: "var(--isp-text-muted)" }}>
                          {match.name || "Unnamed"} · {match.status} · expiry {match.expires_at ? localDate(match.expires_at) : "not set"}
                        </span>
                        {match.reason && <span style={{ display: "block", color: "#fca5a5", marginTop: 3 }}>{match.reason}</span>}
                      </span>
                    </label>
                  ))}
                  <p className="prepaid-help" style={{ margin: 0 }}>
                    Choosing an eligible record updates that account in place and keeps its login credentials. Records on another router or with a different MAC must be resolved separately.
                  </p>
                </section>
              )}
              {error && <div role="alert" style={{ color: "#fca5a5", fontSize: "0.75rem", marginTop: 12 }}>{error}</div>}
            </div>
            <div className="prepaid-modal-actions">
              <button type="button" onClick={onClose} disabled={saving} className="prepaid-secondary-button">Cancel</button>
              {matches.length > 0 ? (
                <button type="button" onClick={() => void grantExistingAccount()} disabled={saving || !selectedMatch?.eligible || !selectedPlan} className="prepaid-primary-button">
                  {saving ? <Loader2 size={13} className="prepaid-spin" /> : <CheckCircle2 size={13} />}
                  Apply grant to selected account
                </button>
              ) : (
                <button type="button" onClick={() => void checkAndGrant()} disabled={!canSubmit} className="prepaid-primary-button">
                  {saving ? <Loader2 size={13} className="prepaid-spin" /> : <Wifi size={13} />}
                  {saving ? "Checking and provisioning…" : "Check and grant"}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="prepaid-admin-grant-content">
              <div role="status" aria-live="polite" style={{ display: "grid", gap: 12, marginTop: 14 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "0.8rem", border: "1px solid rgba(34,197,94,.38)", borderRadius: 10, background: "rgba(34,197,94,.08)" }}>
                  <span style={{ display: "grid", placeItems: "center", flex: "0 0 34px", width: 34, height: 34, borderRadius: "50%", color: "var(--isp-green)", background: "rgba(34,197,94,.16)" }}>
                    <CheckCircle2 size={20} />
                  </span>
                  <span style={{ display: "grid", gap: 3 }}>
                    <strong style={{ color: "var(--isp-green)", fontSize: "0.9rem" }}>Hotspot access granted successfully</strong>
                    <span style={{ color: "var(--isp-text-muted)", fontSize: "0.72rem" }}>
                      {result.created ? "A new prepaid account was created." : "The existing prepaid account was updated."}
                    </span>
                  </span>
                </div>
                <p style={{ margin: 0, color: "var(--isp-text-muted)", fontSize: "0.78rem", lineHeight: 1.5 }}>
                  MikroTik confirmed the 30-day {selectedPlan?.name ?? "Hotspot"} grant. Expires {localDate(result.expiresAt)}.
                </p>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "0.65rem 0.75rem", border: `1px solid ${result.connected ? "rgba(34,197,94,.32)" : "var(--isp-border)"}`, borderRadius: 8, color: result.connected ? "var(--isp-green)" : "var(--isp-text-muted)", fontSize: "0.76rem" }}>
                  <Wifi size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{result.connected ? "The TV is connected to the internet." : result.connectionMessage}</span>
                </div>
                <div style={{ display: "grid", gap: 8, padding: "0.8rem", border: "1px solid var(--isp-border)", borderRadius: 8, background: "var(--isp-input-bg)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--isp-text)", fontSize: "0.78rem" }}>
                    <UserRound size={14} /> <strong>Username:</strong> <span>{result.username}</span>
                  </div>
                  {result.password && (
                    <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--isp-text)", fontSize: "0.78rem", overflowWrap: "anywhere" }}>
                      <KeyRound size={14} /> <strong>New password:</strong> <code>{result.password}</code>
                    </div>
                  )}
                </div>
                {result.listRefreshWarning && (
                  <div role="alert" style={{ padding: "0.65rem 0.75rem", border: "1px solid rgba(245,158,11,.4)", borderRadius: 8, background: "rgba(245,158,11,.08)", color: "#fbbf24", fontSize: "0.74rem" }}>
                    {result.listRefreshWarning}
                  </div>
                )}
                {!result.connected && (
                  <p className="prepaid-help" style={{ margin: 0 }}>
                    The prepaid account is active even though no live session was confirmed. Keep the TV connected to this router and use its existing Hotspot sign-in if it does not connect automatically.
                  </p>
                )}
              </div>
            </div>
            <div className="prepaid-modal-actions">
              <button type="button" onClick={onClose} className="prepaid-primary-button">Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
