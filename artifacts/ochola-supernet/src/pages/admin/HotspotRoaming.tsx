import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { adminApiHeaders } from "@/lib/admin-router-context";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Plus, RefreshCw, Router, ShieldCheck, Trash2, Wifi } from "lucide-react";

interface RouterOption {
  id: number;
  name: string;
  status?: string | null;
}

interface PortOption {
  id: number;
  router_id: number;
  interface_name: string;
}

interface RoamingRule {
  id: number;
  source_router_id: number;
  source_port_id: number | null;
  target_router_id: number;
  target_port_id: number | null;
  enabled: boolean;
  created_at: string;
  source_router_name: string;
  source_port_name: string | null;
  target_router_name: string;
  target_port_name: string | null;
}

interface RoamingContext {
  routers: RouterOption[];
  ports: PortOption[];
  rules: RoamingRule[];
}

interface LiveRoamingAssignment {
  routerId: number | null;
  routerName: string | null;
  portId: number | null;
  portName: string | null;
  planName: string | null;
  transactionId: number | null;
  purchasedAt: string | null;
  evidenceSource: "paid-transaction" | "prepaid-account";
}

interface LiveRoamingSession {
  key: string;
  username: string;
  macAddress: string | null;
  address: string | null;
  uptime: string | null;
  bytesUsed: number;
  connectedRouterId: number;
  connectedRouterName: string;
  connectedServerName: string | null;
  connectedPortId: number | null;
  connectedPortName: string | null;
  assignedSources: LiveRoamingAssignment[];
  status: "authorized" | "unapproved" | "needs_review";
  permissionId: number | null;
}

interface LiveRoamingUsersResponse {
  ok: true;
  sessions: LiveRoamingSession[];
  unavailableRouters: Array<{ id: number; name: string }>;
  checkedAt: string;
}

async function roamingApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(adminApiHeaders());
  if (init.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const body = await response.json().catch(() => null) as { error?: string } | T | null;
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body
      ? String(body.error ?? "")
      : "";
    throw new Error(error || `Roaming request failed (${response.status}).`);
  }
  return body as T;
}

function formatCheckedAt(value?: string | null): string {
  if (!value) return "Not checked yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not checked yet"
    : date.toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

function assignedServiceLabel(source: LiveRoamingAssignment): string {
  if (!source.routerName) return "Assigned router not recorded";
  const port = source.portName ?? (source.portId ? `Port #${source.portId}` : "All Hotspot ports");
  return `${source.routerName} · ${port}`;
}

function connectedServiceLabel(session: LiveRoamingSession): string {
  const service = session.connectedPortName
    ?? (session.connectedServerName ? `Hotspot server ${session.connectedServerName}` : "Hotspot service not identified");
  return `${session.connectedRouterName} · ${service}`;
}

const fieldStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 42,
  padding: "0.65rem 0.75rem",
  border: "1px solid var(--isp-border)",
  borderRadius: 9,
  background: "var(--isp-bg)",
  color: "var(--isp-text)",
  font: "inherit",
};

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--isp-border)",
  borderRadius: 14,
  background: "var(--isp-card)",
  padding: "1.1rem",
};

function serviceLabel(router: string, port: string | null): string {
  return port ? `${router} · ${port}` : `${router} · All Hotspot ports`;
}

export default function AdminHotspotRoaming() {
  const queryClient = useQueryClient();
  const [sourceRouterId, setSourceRouterId] = useState("");
  const [sourcePortId, setSourcePortId] = useState("all");
  const [targetRouterId, setTargetRouterId] = useState("");
  const [targetPortId, setTargetPortId] = useState("all");
  const [message, setMessage] = useState("");

  const contextQuery = useQuery({
    queryKey: ["admin-hotspot-roaming"],
    queryFn: () => roamingApi<{ ok: true } & RoamingContext>("/api/admin/hotspot-roaming/context"),
  });
  const liveUsersQuery = useQuery({
    queryKey: ["admin-hotspot-roaming-live-users"],
    queryFn: () => roamingApi<LiveRoamingUsersResponse>("/api/admin/hotspot-roaming/live-users"),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const context = contextQuery.data;
  const sourcePorts = useMemo(
    () => context?.ports.filter(port => String(port.router_id) === sourceRouterId) ?? [],
    [context?.ports, sourceRouterId],
  );
  const targetPorts = useMemo(
    () => context?.ports.filter(port => String(port.router_id) === targetRouterId) ?? [],
    [context?.ports, targetRouterId],
  );

  const addRule = useMutation({
    mutationFn: () => roamingApi("/api/admin/hotspot-roaming/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceRouterId: Number(sourceRouterId),
        sourcePortId: sourcePortId === "all" ? null : Number(sourcePortId),
        targetRouterId: Number(targetRouterId),
        targetPortId: targetPortId === "all" ? null : Number(targetPortId),
      }),
    }),
    onSuccess: async () => {
      setMessage("Roaming permission granted.");
      setSourcePortId("all");
      setTargetPortId("all");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-hotspot-roaming"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-hotspot-roaming-live-users"] }),
      ]);
    },
    onError: error => setMessage(error instanceof Error ? error.message : "The permission could not be saved."),
  });

  const removeRule = useMutation({
    mutationFn: (id: number) => roamingApi(`/api/admin/hotspot-roaming/rules/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setMessage("Roaming permission removed.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-hotspot-roaming"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-hotspot-roaming-live-users"] }),
      ]);
    },
    onError: error => setMessage(error instanceof Error ? error.message : "The permission could not be removed."),
  });

  const routers = context?.routers ?? [];
  const rules = context?.rules ?? [];
  const liveSessions = liveUsersQuery.data?.sessions ?? [];
  const unavailableRouters = liveUsersQuery.data?.unavailableRouters ?? [];

  return (
    <AdminLayout>
      <div style={{ maxWidth: 1050, margin: "0 auto", padding: "1.25rem 1rem 3rem", color: "var(--isp-text)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 22 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "color-mix(in srgb, var(--isp-accent) 15%, transparent)", color: "var(--isp-accent)", display: "grid", placeItems: "center", flexShrink: 0 }}>
            <Wifi size={22} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: "1.45rem", fontWeight: 800 }}>Hotspot roaming</h1>
            <p style={{ margin: "0.35rem 0 0", color: "var(--isp-text-muted)", lineHeight: 1.5 }}>
              Grant a purchased Hotspot package access to other Wi-Fi services. No roaming is allowed until you add a permission.
            </p>
          </div>
        </div>

        <div style={{ ...cardStyle, display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 20, background: "color-mix(in srgb, var(--isp-accent) 5%, var(--isp-card))" }}>
          <ShieldCheck size={20} color="var(--isp-accent)" style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ fontSize: "0.86rem", lineHeight: 1.55, color: "var(--isp-text-muted)" }}>
            <strong style={{ color: "var(--isp-text)" }}>The purchased package keeps its shared data allowance.</strong>{" "}
            Usage is checked across the source MikroTik and every permitted destination. Before a roam, sessions on other MikroTik routers or a different Hotspot service are disconnected; the package's device limit still applies. If a router needed to verify usage is offline, login is blocked until it can be checked.
          </div>
        </div>

        <section style={{ ...cardStyle, marginBottom: 22 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
            <div>
              <h2 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "1rem", margin: 0 }}>
                <Wifi size={18} color="var(--isp-accent)" /> Live roaming users
              </h2>
              <p style={{ margin: "5px 0 0", color: "var(--isp-text-muted)", fontSize: "0.8rem", lineHeight: 1.5 }}>
                Each row compares the prepaid account’s assigned purchase router with the MikroTik the user is connected to now. This is read-only; it does not disconnect users.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void liveUsersQuery.refetch()}
              disabled={liveUsersQuery.isFetching}
              style={{ minHeight: 36, display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.45rem 0.7rem", color: "var(--isp-text)", background: "var(--isp-bg)", cursor: liveUsersQuery.isFetching ? "wait" : "pointer", opacity: liveUsersQuery.isFetching ? 0.65 : 1 }}
            >
              <RefreshCw size={14} className={liveUsersQuery.isFetching ? "animate-spin" : ""} />
              Refresh live users
            </button>
          </div>

          {unavailableRouters.length > 0 && (
            <div role="status" style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 12, padding: "0.7rem 0.8rem", borderRadius: 9, color: "#92400e", background: "color-mix(in srgb, #f59e0b 12%, var(--isp-card))", fontSize: "0.78rem", lineHeight: 1.45 }}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                Live checks could not reach {unavailableRouters.map(router => router.name).join(", ")}. The list may be incomplete until those routers are reachable.
              </span>
            </div>
          )}

          {liveUsersQuery.isLoading ? (
            <div style={{ padding: "1.2rem 0", color: "var(--isp-text-muted)", display: "flex", alignItems: "center", gap: 9 }}>
              <Loader2 size={17} className="animate-spin" /> Checking live Hotspot sessions and purchase assignments…
            </div>
          ) : liveUsersQuery.error ? (
            <div role="alert" style={{ color: "var(--isp-danger, #f87171)", fontSize: "0.86rem" }}>
              {liveUsersQuery.error instanceof Error ? liveUsersQuery.error.message : "Live roaming users could not be verified."}
            </div>
          ) : liveSessions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "1.5rem 1rem", color: "var(--isp-text-muted)" }}>
              <Router size={22} style={{ opacity: 0.55, marginBottom: 7 }} />
              <div style={{ fontSize: "0.86rem", fontWeight: 700, color: "var(--isp-text)" }}>
                {unavailableRouters.length ? "No roaming users found on reachable routers" : "No active users found on a different assigned router"}
              </div>
              <div style={{ marginTop: 4, fontSize: "0.76rem" }}>
                Only live sessions matched to an active Hotspot prepaid account are listed.
              </div>
            </div>
          ) : (
            <div style={{ overflowX: "auto", border: "1px solid var(--isp-border)", borderRadius: 10 }}>
              <table style={{ width: "100%", minWidth: 950, borderCollapse: "collapse", textAlign: "left", fontSize: "0.77rem" }}>
                <thead>
                  <tr style={{ background: "var(--isp-bg)" }}>
                    {["User / device", "Purchased or assigned on", "Connected now", "Roaming evidence"].map(label => (
                      <th key={label} style={{ padding: "0.7rem 0.75rem", color: "var(--isp-text-muted)", fontWeight: 750, borderBottom: "1px solid var(--isp-border)", whiteSpace: "nowrap" }}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {liveSessions.map(session => {
                    const statusStyle = session.status === "authorized"
                      ? { color: "#047857", background: "color-mix(in srgb, #10b981 13%, var(--isp-card))" }
                      : session.status === "unapproved"
                        ? { color: "var(--isp-danger, #b91c1c)", background: "color-mix(in srgb, #ef4444 12%, var(--isp-card))" }
                        : { color: "#92400e", background: "color-mix(in srgb, #f59e0b 13%, var(--isp-card))" };
                    return (
                      <tr key={session.key}>
                        <td style={{ padding: "0.75rem", borderBottom: "1px solid var(--isp-border)", verticalAlign: "top" }}>
                          <div style={{ color: "var(--isp-text)", fontWeight: 750 }}>{session.username}</div>
                          <div style={{ marginTop: 3, color: "var(--isp-text-muted)", whiteSpace: "nowrap" }}>
                            {[session.macAddress, session.address, session.uptime].filter(Boolean).join(" · ") || "Device details unavailable"}
                          </div>
                        </td>
                        <td style={{ padding: "0.75rem", borderBottom: "1px solid var(--isp-border)", verticalAlign: "top" }}>
                          <div style={{ display: "grid", gap: 7 }}>
                            {session.assignedSources.map((source, index) => (
                              <div key={`${source.routerId ?? "unknown"}:${source.portId ?? "all"}:${source.transactionId ?? index}`}>
                                <div style={{ color: "var(--isp-text)", fontWeight: 750 }}>{assignedServiceLabel(source)}</div>
                                <div style={{ marginTop: 3, color: "var(--isp-text-muted)" }}>
                                  {[source.planName, source.transactionId ? `Paid purchase #${source.transactionId}` : "Prepaid account assignment", ...(source.purchasedAt ? [formatCheckedAt(source.purchasedAt)] : [])].filter(Boolean).join(" · ")}
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td style={{ padding: "0.75rem", borderBottom: "1px solid var(--isp-border)", verticalAlign: "top" }}>
                          <div style={{ color: "var(--isp-text)", fontWeight: 750 }}>{connectedServiceLabel(session)}</div>
                          <div style={{ marginTop: 3, color: "var(--isp-text-muted)" }}>
                            {session.connectedServerName ? `Hotspot server: ${session.connectedServerName}` : "Hotspot server not reported"}
                          </div>
                        </td>
                        <td style={{ padding: "0.75rem", borderBottom: "1px solid var(--isp-border)", verticalAlign: "top" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0.3rem 0.5rem", borderRadius: 999, fontSize: "0.69rem", fontWeight: 800, whiteSpace: "nowrap", ...statusStyle }}>
                            {session.status === "authorized"
                              ? <><CheckCircle2 size={13} /> Approved roaming</>
                              : session.status === "unapproved"
                                ? <><AlertTriangle size={13} /> No matching permission</>
                                : <><AlertTriangle size={13} /> Evidence incomplete</>}
                          </span>
                          <div style={{ marginTop: 5, color: "var(--isp-text-muted)", lineHeight: 1.45 }}>
                            {session.status === "authorized"
                              ? `Permission #${session.permissionId} covers this assigned-to-current router path.`
                              : session.status === "unapproved"
                                ? "The account is active, but no enabled rule covers this assigned router and current router."
                                : "The account, plan, or live Hotspot port could not be linked safely."}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: 10, color: "var(--isp-text-muted)", fontSize: "0.72rem" }}>
            Last checked: {formatCheckedAt(liveUsersQuery.data?.checkedAt)} · Refreshes every minute while this page is open.
          </div>
        </section>

        <section style={{ ...cardStyle, marginBottom: 22 }}>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "1rem", margin: "0 0 6px" }}>
            <Plus size={18} color="var(--isp-accent)" /> Grant permission
          </h2>
          <p style={{ fontSize: "0.82rem", color: "var(--isp-text-muted)", margin: "0 0 18px", lineHeight: 1.5 }}>
            Choose where the purchase was made and which service can accept it. “All Hotspot ports” covers every active Hotspot port on that MikroTik.
          </p>

          {contextQuery.isLoading ? (
            <div style={{ padding: "1.5rem 0", color: "var(--isp-text-muted)", display: "flex", alignItems: "center", gap: 9 }}>
              <Loader2 size={17} className="animate-spin" /> Loading MikroTik services…
            </div>
          ) : contextQuery.error ? (
            <div role="alert" style={{ color: "var(--isp-danger, #f87171)", fontSize: "0.88rem" }}>
              {contextQuery.error instanceof Error ? contextQuery.error.message : "Roaming services could not be loaded."}
            </div>
          ) : routers.length === 0 ? (
            <div style={{ color: "var(--isp-text-muted)", fontSize: "0.88rem" }}>There are no available MikroTik routers yet.</div>
          ) : (
            <form onSubmit={event => { event.preventDefault(); setMessage(""); addRule.mutate(); }}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_34px_minmax(0,1fr)]" style={{ alignItems: "end" }}>
                <div style={{ display: "grid", gap: 10 }}>
                  <label style={{ display: "grid", gap: 6, fontSize: "0.78rem", fontWeight: 700 }}>
                    Purchased on
                    <select required value={sourceRouterId} onChange={event => { setSourceRouterId(event.target.value); setSourcePortId("all"); }} style={fieldStyle}>
                      <option value="">Choose source MikroTik</option>
                      {routers.map(router => <option key={router.id} value={router.id}>{router.name}</option>)}
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: "0.78rem", fontWeight: 700 }}>
                    Source Hotspot port
                    <select value={sourcePortId} onChange={event => setSourcePortId(event.target.value)} style={fieldStyle} disabled={!sourceRouterId}>
                      <option value="all">All Hotspot ports on this MikroTik</option>
                      {sourcePorts.map(port => <option key={port.id} value={port.id}>{port.interface_name}</option>)}
                    </select>
                  </label>
                </div>
                <ArrowRight size={21} color="var(--isp-text-muted)" style={{ marginBottom: 10, justifySelf: "center" }} />
                <div style={{ display: "grid", gap: 10 }}>
                  <label style={{ display: "grid", gap: 6, fontSize: "0.78rem", fontWeight: 700 }}>
                    Also usable on
                    <select required value={targetRouterId} onChange={event => { setTargetRouterId(event.target.value); setTargetPortId("all"); }} style={fieldStyle}>
                      <option value="">Choose destination MikroTik</option>
                      {routers.map(router => <option key={router.id} value={router.id}>{router.name}</option>)}
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: "0.78rem", fontWeight: 700 }}>
                    Destination Hotspot port
                    <select value={targetPortId} onChange={event => setTargetPortId(event.target.value)} style={fieldStyle} disabled={!targetRouterId}>
                      <option value="all">All Hotspot ports on this MikroTik</option>
                      {targetPorts.map(port => <option key={port.id} value={port.id}>{port.interface_name}</option>)}
                    </select>
                  </label>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
                <button type="submit" disabled={addRule.isPending || !sourceRouterId || !targetRouterId} style={{ minHeight: 40, border: 0, borderRadius: 9, padding: "0.65rem 1rem", background: "var(--isp-accent)", color: "white", fontWeight: 750, cursor: "pointer", opacity: addRule.isPending || !sourceRouterId || !targetRouterId ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {addRule.isPending ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                  Grant roaming access
                </button>
                {message && <span role="status" style={{ fontSize: "0.84rem", color: message.toLowerCase().includes("could not") || message.toLowerCase().includes("already") ? "var(--isp-danger, #f87171)" : "var(--isp-text-muted)" }}>{message}</span>}
              </div>
            </form>
          )}
        </section>

        <section style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "1rem", margin: 0 }}>
              <Router size={18} color="var(--isp-accent)" /> Active permissions
            </h2>
            <span style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)" }}>{rules.length} {rules.length === 1 ? "permission" : "permissions"}</span>
          </div>
          {contextQuery.isLoading ? (
            <p style={{ color: "var(--isp-text-muted)", fontSize: "0.86rem" }}>Loading permissions…</p>
          ) : rules.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--isp-text-muted)" }}>
              <Wifi size={24} style={{ opacity: 0.55, marginBottom: 8 }} />
              <div style={{ fontWeight: 700, color: "var(--isp-text)" }}>Roaming is off</div>
              <div style={{ fontSize: "0.82rem", marginTop: 4 }}>Add a permission above to let customers use a purchase on another Hotspot service.</div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 9 }}>
              {rules.map(rule => (
                <div key={rule.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: "0.8rem 0.85rem", border: "1px solid var(--isp-border)", borderRadius: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: "0.86rem", fontWeight: 700 }}>
                      <span>{serviceLabel(rule.source_router_name, rule.source_port_name)}</span>
                      <ArrowRight size={16} color="var(--isp-text-muted)" />
                      <span>{serviceLabel(rule.target_router_name, rule.target_port_name)}</span>
                    </div>
                    <div style={{ marginTop: 4, color: "var(--isp-text-muted)", fontSize: "0.74rem" }}>
                      {rule.source_port_id ? "Purchases from this port" : "Purchases from any Hotspot port on this MikroTik"} can roam to {rule.target_port_id ? "this port" : "any active Hotspot port"}.
                    </div>
                  </div>
                  <button type="button" aria-label={`Remove permission from ${rule.source_router_name} to ${rule.target_router_name}`} disabled={removeRule.isPending} onClick={() => {
                    if (window.confirm("Remove this roaming permission? New logins will be blocked, but an existing session may continue until it disconnects.")) removeRule.mutate(rule.id);
                  }} style={{ minHeight: 36, display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.45rem 0.65rem", color: "var(--isp-danger, #f87171)", background: "transparent", cursor: "pointer" }}>
                    <Trash2 size={15} /> Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}
