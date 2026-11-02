import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Network, Plus, RefreshCw, Trash2, Pencil, Cable } from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { adminApiFetch } from "@/lib/api-client";
import { fetchAdminRouterManagementContext, type AdminContextRouter } from "@/lib/admin-router-context";

type Bridge = { name: string; running: boolean };
type RouterInterface = { id: string; name: string; type: string; running: boolean; disabled: boolean; macAddress: string; comment: string };
type BridgePort = { id: string; bridge: string; interface: string };
type Inventory = { ok: boolean; error?: string; routerName: string; connectedVia: string; bridges: Bridge[]; interfaces: RouterInterface[]; bridgePorts: BridgePort[] };

const panel: React.CSSProperties = {
  background: "var(--isp-card)", border: "1px solid var(--isp-border-subtle)",
  borderRadius: 12, padding: "1rem",
};
const input: React.CSSProperties = {
  background: "var(--isp-input-bg,rgba(255,255,255,.05))", color: "var(--isp-text)",
  border: "1px solid var(--isp-border)", borderRadius: 7, padding: ".55rem .7rem",
  font: "inherit", fontSize: ".82rem", minWidth: 0,
};
const button = (kind: "primary" | "quiet" | "danger" = "quiet"): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: ".4rem",
  borderRadius: 7, padding: ".48rem .7rem", font: "inherit", fontSize: ".78rem",
  fontWeight: 650, cursor: "pointer",
  color: kind === "primary" ? "#fff" : kind === "danger" ? "#fca5a5" : "var(--isp-text-muted)",
  background: kind === "primary" ? "var(--isp-accent)" : kind === "danger" ? "rgba(248,113,113,.08)" : "rgba(255,255,255,.04)",
  border: `1px solid ${kind === "danger" ? "rgba(248,113,113,.28)" : "var(--isp-border)"}`,
});

export default function Bridges() {
  const [routerId, setRouterId] = useState("");
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newBridge, setNewBridge] = useState("");
  const [addPort, setAddPort] = useState<Record<string, string>>({});

  const { data: routers = [], isLoading: routersLoading } = useQuery<AdminContextRouter[]>({
    queryKey: ["bridge-management-routers"],
    queryFn: async () => (await fetchAdminRouterManagementContext()).routers
      .filter(router => !["setup", "awaiting_ports", "awaiting_sync", "awaiting_connection"].includes(router.status)),
    staleTime: 15_000,
  });

  async function load() {
    if (!routerId || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await adminApiFetch(`/api/router/${routerId}/bridge-management/inventory`, {
        method: "POST", cache: "no-store", body: JSON.stringify({}),
      });
      const body = await response.json() as Inventory;
      if (!response.ok || !body.ok) throw new Error(body.error || `Could not load router (${response.status}).`);
      setInventory(body);
      setAddPort({});
    } catch (e) {
      setInventory(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function mutate(path: "bridges" | "ports", body: Record<string, string>) {
    if (!routerId || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await adminApiFetch(`/api/router/${routerId}/bridge-management/${path}`, {
        method: "POST", body: JSON.stringify(body),
      });
      const result = await response.json() as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || `Change failed (${response.status}).`);
      setNotice(result.message || "Change saved and verified on the router.");
      await loadAfterMutation();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function loadAfterMutation() {
    try {
      const response = await adminApiFetch(`/api/router/${routerId}/bridge-management/inventory`, {
        method: "POST", cache: "no-store", body: JSON.stringify({}),
      });
      const body = await response.json() as Inventory;
      if (!response.ok || !body.ok) throw new Error(body.error || "Could not verify the updated router state.");
      setInventory(body); setAddPort({});
    } catch (e) {
      setInventory(null);
      setError(`Change was accepted, but the latest state could not be reloaded: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  }

  async function createBridge() {
    const name = newBridge.trim();
    if (!name) return;
    await mutate("bridges", { action: "create", name });
    setNewBridge("");
  }

  async function renameBridge(name: string) {
    const newName = window.prompt(`Rename bridge "${name}" to:`, name);
    if (!newName || newName.trim() === name) return;
    await mutate("bridges", { action: "rename", name, newName: newName.trim() });
  }

  async function deleteBridge(name: string) {
    if (!window.confirm(`Delete the empty bridge "${name}"? Used or managed bridges cannot be deleted.`)) return;
    await mutate("bridges", { action: "delete", name });
  }

  const physicalPorts = (inventory?.interfaces ?? []).filter(iface =>
    ["ether", "sfp"].includes(iface.type.toLowerCase()) && iface.name.toLowerCase() !== "ether1",
  );
  const claimed = new Set((inventory?.bridgePorts ?? []).map(port => port.interface));
  const unassigned = physicalPorts.filter(port => !claimed.has(port.name));

  return (
    <AdminLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 1100 }}>
        <header>
          <h1 style={{ color: "var(--isp-text)", fontSize: "1.35rem", margin: "0 0 .35rem" }}>Bridge & Ports</h1>
          <p style={{ color: "var(--isp-text-muted)", margin: 0, fontSize: ".85rem" }}>
            Load a router to inspect and manage its bridges and port memberships.
          </p>
        </header>
        <NetworkTabs active="bridges" />
        <section style={{ ...panel, display: "flex", gap: ".65rem", alignItems: "center", flexWrap: "wrap" }}>
          <label htmlFor="bridge-router" style={{ color: "var(--isp-text-muted)", fontSize: ".8rem", fontWeight: 650 }}>Router</label>
          <select id="bridge-router" value={routerId} onChange={event => {
            setRouterId(event.target.value); setInventory(null); setError(""); setNotice("");
          }} style={{ ...input, minWidth: 240 }}>
            <option value="">{routersLoading ? "Loading routers…" : "Select a router"}</option>
            {routers.map(router => <option key={router.id} value={router.id}>{router.name}</option>)}
          </select>
          <button type="button" style={button("primary")} disabled={!routerId || busy} onClick={load}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {busy ? "Working…" : inventory ? "Reload" : "Load"}
          </button>
          {inventory?.connectedVia && <span style={{ fontSize: ".75rem", color: "var(--isp-text-muted)" }}>Router link: {inventory.connectedVia}</span>}
        </section>

        {error && <div role="alert" style={{ ...panel, borderColor: "rgba(248,113,113,.35)", color: "#fca5a5", display: "flex", gap: ".55rem", alignItems: "flex-start" }}><AlertTriangle size={16} />{error}</div>}
        {notice && <div role="status" style={{ ...panel, borderColor: "rgba(34,197,94,.3)", color: "#4ade80", display: "flex", gap: ".55rem", alignItems: "center" }}><Check size={16} />{notice}</div>}

        {!inventory && !busy && !error && <div style={{ ...panel, textAlign: "center", color: "var(--isp-text-muted)", padding: "2.5rem 1rem" }}>
          <Network size={25} style={{ marginBottom: ".65rem", opacity: .75 }} />
          <div>Select a router, then click Load to fetch live RouterOS bridge data.</div>
        </div>}

        {inventory && (
          <>
            <section style={{ ...panel, display: "flex", gap: ".6rem", alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <strong style={{ color: "var(--isp-text)" }}>{inventory.routerName}</strong>
                <div style={{ color: "var(--isp-text-muted)", fontSize: ".75rem", marginTop: ".2rem" }}>Live bridge inventory from the selected router</div>
              </div>
              <input aria-label="New bridge name" placeholder="New bridge name" value={newBridge} onChange={event => setNewBridge(event.target.value)} style={input} maxLength={64} />
              <button type="button" style={button("primary")} disabled={busy || !newBridge.trim()} onClick={createBridge}><Plus size={14} />Add bridge</button>
            </section>

            {inventory.bridges.length === 0 && <div style={panel}>No bridges were returned by this router.</div>}
            {inventory.bridges.map(bridge => {
              const members = inventory.bridgePorts.filter(port => port.bridge === bridge.name);
              const available = unassigned;
              return (
                <section key={bridge.name} style={panel}>
                  <div style={{ display: "flex", alignItems: "center", gap: ".6rem", flexWrap: "wrap", marginBottom: ".8rem" }}>
                    <Network size={17} color="var(--isp-accent)" />
                    <strong style={{ color: "var(--isp-text)", flex: 1 }}>{bridge.name}</strong>
                    <span style={{ fontSize: ".72rem", color: bridge.running ? "#4ade80" : "var(--isp-text-muted)" }}>{bridge.running ? "Running" : "Not running"}</span>
                    <button type="button" style={button()} disabled={busy} onClick={() => renameBridge(bridge.name)}><Pencil size={13} />Edit</button>
                    <button type="button" style={button("danger")} disabled={busy} onClick={() => deleteBridge(bridge.name)}><Trash2 size={13} />Delete</button>
                  </div>
                  <div style={{ display: "flex", gap: ".55rem", alignItems: "center", flexWrap: "wrap", marginBottom: ".8rem" }}>
                    <select aria-label={`Select port to add to ${bridge.name}`} value={addPort[bridge.name] ?? ""} onChange={event => setAddPort(current => ({ ...current, [bridge.name]: event.target.value }))} style={input}>
                      <option value="">Select an unassigned physical port</option>
                      {available.map(port => <option key={port.name} value={port.name}>{port.name}{port.running ? " · running" : ""}</option>)}
                    </select>
                    <button type="button" style={button("primary")} disabled={busy || !addPort[bridge.name]} onClick={() => {
                      const name = addPort[bridge.name];
                      if (name && window.confirm(`Add ${name} to ${bridge.name}? This changes live network traffic.`)) {
                        void mutate("ports", { action: "add", bridge: bridge.name, interfaceName: name });
                      }
                    }}><Plus size={13} />Add port</button>
                  </div>
                  <div style={{ borderTop: "1px solid var(--isp-border-subtle)" }}>
                    {members.length === 0 ? <p style={{ color: "var(--isp-text-muted)", fontSize: ".8rem", margin: ".8rem 0 0" }}>No ports assigned.</p> : members.map(member => (
                      <PortMembershipRow key={member.id || `${member.bridge}-${member.interface}`} member={member} bridges={inventory.bridges}
                        busy={busy} onMove={toBridge => {
                          if (window.confirm(`Move ${member.interface} from ${bridge.name} to ${toBridge}? Connectivity on this port may be interrupted.`)) {
                            void mutate("ports", { action: "move", bridge: toBridge, fromBridge: bridge.name, interfaceName: member.interface });
                          }
                        }}
                        onRemove={() => {
                          if (window.confirm(`Remove ${member.interface} from ${bridge.name}? The interface itself will not be deleted, but connected users may lose service.`)) {
                            void mutate("ports", { action: "remove", bridge: bridge.name, interfaceName: member.interface });
                          }
                        }} />
                    ))}
                  </div>
                </section>
              );
            })}
            <div style={{ color: "var(--isp-text-muted)", fontSize: ".74rem", lineHeight: 1.5 }}>
              Only free Ethernet/SFP ports can be added. Moving or removing a port affects live connectivity and always asks for confirmation. Managed/system bridges and bridges with dependencies are protected from rename or deletion.
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}

function PortMembershipRow({ member, bridges, busy, onMove, onRemove }: {
  member: BridgePort;
  bridges: Bridge[];
  busy: boolean;
  onMove: (bridge: string) => void;
  onRemove: () => void;
}) {
  const [target, setTarget] = useState("");
  return <div style={{ display: "flex", alignItems: "center", gap: ".55rem", flexWrap: "wrap", padding: ".7rem 0", borderBottom: "1px solid var(--isp-border-subtle)" }}>
    <Cable size={14} color="var(--isp-text-muted)" />
    <span style={{ color: "var(--isp-text)", fontWeight: 600, flex: 1 }}>{member.interface}</span>
    <select aria-label={`Change bridge for ${member.interface}`} value={target} onChange={event => setTarget(event.target.value)} style={{ ...input, padding: ".38rem .55rem" }}>
      <option value="">Change bridge…</option>
      {bridges.filter(bridge => bridge.name !== member.bridge).map(bridge => <option key={bridge.name} value={bridge.name}>{bridge.name}</option>)}
    </select>
    <button type="button" style={button()} disabled={busy || !target} onClick={() => onMove(target)}>Update</button>
    <button type="button" style={button("danger")} disabled={busy} onClick={onRemove}><Trash2 size={13} />Remove</button>
  </div>;
}
