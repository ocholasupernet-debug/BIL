import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import {
  adminApiHeaders,
  useAdminRouterContext,
} from "@/lib/admin-router-context";
import {
  Wifi,
  Eye,
  EyeOff,
  Save,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Radio,
  Lock,
  Signal,
  Trash,
  Plus,
} from "lucide-react";

interface WirelessIface {
  id: string;
  name: string;
  ssid: string;
  disabled: boolean;
  band?: string;
  channel?: string;
  macAddress?: string;
  securityProfile?: string;
  mode?: string;
  managedByApp?: boolean;
  masterInterface?: string | null;
  securitySummary?: string;
  channelLabel?: string;
}
interface WirelessData {
  apiMode?: "legacy" | "wifi";
  interfaces: WirelessIface[];
  profiles: Array<{ id: string; name: string; wpa2PreSharedKey: string; mode?: string }>;
}
const inp: React.CSSProperties = {
  background: "var(--isp-input-bg,#0f1923)",
  border: "1px solid var(--isp-input-border,rgba(255,255,255,.1))",
  borderRadius: 8,
  padding: ".55rem .875rem",
  color: "var(--isp-text)",
  fontSize: ".875rem",
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};
const button: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: ".4rem",
  padding: ".55rem .9rem",
  borderRadius: 8,
  border: "none",
  fontWeight: 700,
  fontFamily: "inherit",
  cursor: "pointer",
};
function PasswordInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Wi-Fi password"
        style={{ ...inp, paddingRight: "2.5rem" }}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        style={{
          position: "absolute",
          right: 10,
          top: "50%",
          transform: "translateY(-50%)",
          background: "none",
          border: 0,
          color: "var(--isp-text-muted)",
          cursor: "pointer",
        }}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}
function errorText(body: unknown, status: number) {
  if (body && typeof body === "object") {
    const b = body as { error?: unknown; detail?: unknown; message?: unknown };
    for (const value of [b.error, b.detail, b.message])
      if (typeof value === "string" && value.trim()) return value;
  }
  return `Request failed (${status})`;
}
function WirelessCard({
  iface,
  profiles,
  routerId,
  onChanged,
  readOnly,
}: {
  iface: WirelessIface;
  profiles: WirelessData["profiles"];
  routerId: number;
  onChanged: () => void;
  readOnly: boolean;
}) {
  const profile =
    profiles.find((p) => p.name === iface.securityProfile) ?? null;
  const existingSecurityMode = profile?.mode === "none" ? "open" : "wpa2";
  const [ssid, setSsid] = useState(iface.ssid ?? "");
  const [password, setPassword] = useState(profile?.wpa2PreSharedKey ?? "");
  const [securityMode, setSecurityMode] = useState<"open" | "wpa2">(existingSecurityMode);
  const [disabled, setDisabled] = useState(!!iface.disabled);
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setSsid(iface.ssid ?? "");
    setPassword(profile?.wpa2PreSharedKey ?? "");
    setSecurityMode(existingSecurityMode);
    setDisabled(!!iface.disabled);
  }, [iface.ssid, iface.disabled, profile?.wpa2PreSharedKey, profile?.mode]);
  const dirty =
    ssid !== (iface.ssid ?? "") ||
    securityMode !== existingSecurityMode ||
    (securityMode === "wpa2" && password !== (profile?.wpa2PreSharedKey ?? ""));
  const save = async () => {
    if (securityMode === "wpa2" && securityMode !== existingSecurityMode &&
        (new TextEncoder().encode(password).length < 8 || new TextEncoder().encode(password).length > 63)) {
      setState({ ok: false, text: "Enter a WPA2 password of 8–63 bytes to enable Wi-Fi security." });
      return;
    }
    if (securityMode === "wpa2" && password !== (profile?.wpa2PreSharedKey ?? "") &&
        (password.length < 8 || new TextEncoder().encode(password).length > 63)) {
      setState({ ok: false, text: "WPA2 passwords must be 8–63 bytes." });
      return;
    }
    setBusy(true);
    setState(null);
    try {
      const body: Record<string, unknown> = { interfaceId: iface.id };
      if (ssid !== iface.ssid) body.ssid = ssid;
      if (securityMode !== existingSecurityMode) body.securityMode = securityMode;
      if (securityMode === "wpa2" && password !== (profile?.wpa2PreSharedKey ?? ""))
        body.password = password;
      const response = await fetch(`/api/router/${routerId}/wireless`, {
        method: "PATCH",
        headers: { ...adminApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorText(json, response.status));
      setState({ ok: true, text: "Saved successfully" });
      onChanged();
    } catch (e) {
      setState({
        ok: false,
        text: e instanceof Error ? e.message : "Save failed",
      });
    } finally {
      setBusy(false);
    }
  };
  const toggleDisabled = async () => {
    const nextDisabled = !disabled;
    if (
      nextDisabled &&
      !iface.masterInterface &&
      !window.confirm(
        "This is a physical/master radio. Disabling it will stop all wireless networks on this radio. Continue?",
      )
    )
      return;
    setBusy(true);
    setState(null);
    try {
      const response = await fetch(`/api/router/${routerId}/wireless`, {
        method: "PATCH",
        headers: { ...adminApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ interfaceId: iface.id, disabled: nextDisabled }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorText(json, response.status));
      setDisabled(nextDisabled);
      setState({
        ok: true,
        text: nextDisabled ? "WLAN disabled" : "WLAN enabled",
      });
      onChanged();
    } catch (e) {
      setState({
        ok: false,
        text: e instanceof Error ? e.message : "Could not change WLAN state",
      });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete WLAN ${iface.ssid || iface.name}?`)) return;
    setBusy(true);
    setState(null);
    try {
      const response = await fetch(`/api/router/${routerId}/wireless`, {
        method: "DELETE",
        headers: { ...adminApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ interfaceId: iface.id }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorText(json, response.status));
      onChanged();
    } catch (e) {
      setState({
        ok: false,
        text: e instanceof Error ? e.message : "Delete failed",
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      style={{
        background: "var(--isp-section)",
        border: "1px solid var(--isp-border)",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: ".875rem 1.25rem",
          background: disabled
            ? "rgba(248,113,113,.05)"
            : "rgba(37,99,235,.04)",
          borderBottom: "1px solid var(--isp-border-subtle)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          <Radio
            size={17}
            style={{ color: disabled ? "#f87171" : "var(--isp-accent)" }}
          />
          <div style={{ minWidth: 0 }}>
            <strong style={{ color: "var(--isp-text)" }}>{iface.name}</strong>
            <div
              style={{
                color: "var(--isp-text-muted)",
                fontSize: ".7rem",
                overflowWrap: "anywhere",
              }}
            >
              {iface.ssid || "SSID not set"} · {iface.band || "Band unknown"} ·
              {" "}{iface.channelLabel || "ch"} {iface.channel || "auto"} · {iface.macAddress || "MAC unavailable"} ·
              {" "}{iface.mode || "ap-bridge"} · {readOnly ? (iface.securitySummary || "Security unknown") : existingSecurityMode === "open" ? "Open Wi-Fi" : "WPA2"}
            </div>
          </div>
          <span
            style={{
              color: disabled ? "#f87171" : "#4ade80",
              fontSize: ".72rem",
              whiteSpace: "nowrap",
            }}
          >
            <Signal size={12} /> {disabled ? "Off" : "Broadcasting"}
          </span>
        </div>
        {iface.managedByApp && !readOnly && (
          <button
            onClick={remove}
            disabled={busy}
            style={{
              ...button,
              padding: ".35rem .55rem",
              background: "rgba(248,113,113,.1)",
              color: "#f87171",
            }}
          >
            <Trash size={13} /> Delete
          </button>
        )}
      </div>
      <div
        style={{ padding: "1.125rem 1.25rem", display: "grid", gap: "1rem" }}
      >
        <label
          style={{
            color: "var(--isp-text-muted)",
            fontSize: ".72rem",
            fontWeight: 700,
          }}
        >
          NETWORK NAME (SSID)
          <input
            value={ssid}
            onChange={(e) => setSsid(e.target.value)}
            readOnly={readOnly}
            style={{ ...inp, marginTop: ".4rem" }}
          />
        </label>
        {!readOnly && <label
          style={{
            color: "var(--isp-text-muted)",
            fontSize: ".72rem",
            fontWeight: 700,
          }}
        >
          WI-FI SECURITY
          <select
            value={securityMode}
            onChange={(event) => setSecurityMode(event.target.value as "open" | "wpa2")}
            style={{ ...inp, marginTop: ".4rem" }}
          >
            <option value="wpa2">WPA2 password</option>
            <option value="open">Open network (no Wi-Fi password)</option>
          </select>
        </label>}
        {!readOnly && (securityMode === "wpa2" ? <label
          style={{
            color: "var(--isp-text-muted)",
            fontSize: ".72rem",
            fontWeight: 700,
          }}
        >
          <Lock size={11} /> PASSWORD
          <PasswordInput value={password} onChange={setPassword} />
          {!profile && (
            <span
              style={{
                display: "block",
                marginTop: ".35rem",
                fontSize: ".72rem",
                fontWeight: 400,
              }}
            >
              No matching profile was returned. Saving a new password creates
              a separate profile for this WLAN.
            </span>
          )}
        </label> : (
          <p style={{ margin: 0, color: "#fbbf24", fontSize: ".78rem", lineHeight: 1.5 }}>
            This network will have no Wi-Fi encryption or password. Anyone nearby can connect.
          </p>
        ))}
        {readOnly && (
          <p style={{ margin: 0, color: "var(--isp-text-muted)", fontSize: ".78rem", lineHeight: 1.5 }}>
            This router uses the newer WiFi menu. WLANs are shown read-only; changes are not supported here yet.
          </p>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: ".75rem",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={toggleDisabled}
            disabled={busy || readOnly}
            style={{
              ...button,
              background: disabled
                ? "rgba(74,222,128,.12)"
                : "rgba(248,113,113,.1)",
              color: disabled ? "#4ade80" : "#f87171",
            }}
          >
            <Signal size={14} /> {disabled ? "Enable WLAN" : "Disable WLAN"}
          </button>
          <button
            onClick={save}
            disabled={readOnly || !dirty || busy}
            style={{
              ...button,
              background: dirty ? "var(--isp-accent)" : "rgba(255,255,255,.06)",
              color: dirty ? "white" : "var(--isp-text-muted)",
            }}
          >
            {busy ? <Loader2 size={14} /> : <Save size={14} />} Save Changes
          </button>
          {state && (
            <span
              style={{
                color: state.ok ? "#4ade80" : "#f87171",
                fontSize: ".8rem",
              }}
            >
              {state.ok ? (
                <CheckCircle2 size={14} />
              ) : (
                <AlertTriangle size={14} />
              )}{" "}
              {state.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
export default function Wireless() {
  const {
    data: context,
    isLoading: loadingRouters,
    error: routerError,
  } = useAdminRouterContext();
  const routers = context?.routers ?? [];
  const [selectedRouterId, setSelectedRouterId] = useState<number | null>(null);
  useEffect(() => {
    if (routers.length && selectedRouterId === null)
      setSelectedRouterId(routers[0].id);
  }, [routers, selectedRouterId]);
  const router = routers.find((r) => r.id === selectedRouterId) ?? null;
  const query = useQuery<WirelessData>({
    queryKey: ["wireless", selectedRouterId],
    enabled: !!selectedRouterId,
    retry: 0,
    queryFn: async () => {
      const res = await fetch(`/api/router/${selectedRouterId}/wireless`, {
        headers: adminApiHeaders(),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorText(body, res.status));
      return body as WirelessData;
    },
  });
  const data = query.data;
  const physical = useMemo(
    () => data?.interfaces.filter((i) => !i.masterInterface) ?? [],
    [data],
  );
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [ssid, setSsid] = useState("");
  const [masterInterfaceId, setMasterInterfaceId] = useState("");
  const [password, setPassword] = useState("");
  const [addSecurityMode, setAddSecurityMode] = useState<"open" | "wpa2">("wpa2");
  const [addError, setAddError] = useState("");
  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setAddError("");
    if (!name.trim() || !ssid.trim()) {
      setAddError("Interface name and SSID are required.");
      return;
    }
    if (addSecurityMode === "wpa2" &&
        (new TextEncoder().encode(password).length < 8 || new TextEncoder().encode(password).length > 63)) {
      setAddError("WPA2 password must be 8–63 bytes.");
      return;
    }
    if (!masterInterfaceId) {
      setAddError("Choose a physical radio.");
      return;
    }
    try {
      const res = await fetch(`/api/router/${selectedRouterId}/wireless`, {
        method: "POST",
        headers: { ...adminApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          ssid,
          masterInterfaceId,
          securityMode: addSecurityMode,
          ...(addSecurityMode === "wpa2" ? { password } : {}),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorText(body, res.status));
      setAdding(false);
      setName("");
      setSsid("");
      setPassword("");
      setAddSecurityMode("wpa2");
      setMasterInterfaceId("");
      query.refetch();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "WLAN creation failed");
    }
  };
  return (
    <AdminLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <h1
          style={{ fontSize: "1.25rem", color: "var(--isp-text)", margin: 0 }}
        >
          Wireless
        </h1>
        <NetworkTabs active="wireless" />
        <div
          style={{
            maxWidth: 720,
            background: "var(--isp-section)",
            border: "1px solid var(--isp-border)",
            borderRadius: 12,
            padding: ".875rem 1.25rem",
            display: "flex",
            gap: ".75rem",
          }}
        >
          <strong
            style={{ color: "var(--isp-text-muted)", fontSize: ".72rem" }}
          >
            ROUTER
          </strong>
          <select
            value={selectedRouterId ?? ""}
            onChange={(e) => setSelectedRouterId(Number(e.target.value))}
            style={{ ...inp, flex: 1 }}
            disabled={loadingRouters}
          >
            {routers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} — {r.host || r.vpn_ip || "no IP"}
              </option>
            ))}
          </select>
          {router && (
            <button
              onClick={() => query.refetch()}
              style={{
                ...button,
                background: "rgba(255,255,255,.05)",
                color: "var(--isp-text-muted)",
              }}
            >
              <RefreshCw size={13} /> Refresh
            </button>
          )}
        </div>
        {!loadingRouters && !routerError && routers.length === 0 && (
          <div
            style={{
              maxWidth: 720,
              color: "var(--isp-text-muted)",
              padding: "2rem 1rem",
              textAlign: "center",
            }}
          >
            No routers are available for this account.
          </div>
        )}
        {(routerError || query.error) && (
          <div
            style={{
              color: "#f87171",
              background: "rgba(248,113,113,.07)",
              padding: "1rem",
              borderRadius: 10,
            }}
          >
            <AlertTriangle size={15} />{" "}
            {(routerError || (query.error as Error)).message}
          </div>
        )}
        {data && (
          <div
            style={{
              maxWidth: 720,
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}
          >
            <button
              onClick={() => setAdding((v) => !v)}
              disabled={physical.length === 0 || data.apiMode === "wifi"}
              style={{
                ...button,
                alignSelf: "flex-start",
                background: "var(--isp-accent)",
                color: "white",
              }}
            >
              <Plus size={15} /> Add WLAN
            </button>
            <p
              style={{
                margin: "-.5rem 0 0",
                color: "var(--isp-text-muted)",
                fontSize: ".76rem",
              }}
            >
              {data.apiMode === "wifi"
                ? "This router uses the newer WiFi menu. WLAN inventory is available here, but changes are read-only."
                : "Delete is available only for app-managed virtual WLANs. Physical radios and WLANs managed outside the app cannot be deleted here."}
            </p>
            {data.interfaces.length === 0 && (
              <div
                style={{
                  padding: "2rem 1rem",
                  textAlign: "center",
                  color: "var(--isp-text-muted)",
                  background: "var(--isp-section)",
                  border: "1px solid var(--isp-border)",
                  borderRadius: 14,
                }}
              >
                <Wifi size={28} style={{ opacity: 0.4 }} />
                <p style={{ margin: ".6rem 0 0", fontWeight: 600 }}>
                  No wireless interfaces found.
                </p>
              </div>
            )}
            {physical.length === 0 && data.interfaces.length > 0 && (
              <div
                style={{
                  padding: ".75rem 1rem",
                  color: "#fbbf24",
                  background: "rgba(251,191,36,.07)",
                  border: "1px solid rgba(251,191,36,.22)",
                  borderRadius: 10,
                  fontSize: ".78rem",
                }}
              >
                No physical radios are available for creating a WLAN.
              </div>
            )}
            {adding && data.apiMode !== "wifi" && (
              <form
                onSubmit={add}
                style={{
                  background: "var(--isp-section)",
                  border: "1px solid var(--isp-border)",
                  borderRadius: 12,
                  padding: "1rem",
                  display: "grid",
                  gap: ".75rem",
                }}
              >
                <strong style={{ color: "var(--isp-text)" }}>Add WLAN</strong>
                <input
                  required
                  minLength={1}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Interface name"
                  style={inp}
                />
                <input
                  required
                  minLength={1}
                  value={ssid}
                  onChange={(e) => setSsid(e.target.value)}
                  placeholder="SSID"
                  style={inp}
                />
                <select
                  required
                  value={masterInterfaceId}
                  onChange={(e) => setMasterInterfaceId(e.target.value)}
                  style={inp}
                >
                  <option value="">Choose physical radio</option>
                  {physical.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} {i.band ? `— ${i.band}` : ""}
                    </option>
                  ))}
                </select>
                <label
                  style={{
                    color: "var(--isp-text-muted)",
                    fontSize: ".72rem",
                    fontWeight: 700,
                  }}
                >
                  WI-FI SECURITY
                  <select
                    value={addSecurityMode}
                    onChange={(event) => setAddSecurityMode(event.target.value as "open" | "wpa2")}
                    style={{ ...inp, marginTop: ".4rem" }}
                  >
                    <option value="wpa2">WPA2 password</option>
                    <option value="open">Open network (no Wi-Fi password)</option>
                  </select>
                </label>
                {addSecurityMode === "wpa2" ? <div>
                  <PasswordInput value={password} onChange={setPassword} />
                  <p
                    style={{
                      margin: ".3rem 0 0",
                      color: "var(--isp-text-muted)",
                      fontSize: ".72rem",
                    }}
                  >
                    Use 8–63 bytes.
                  </p>
                </div> : (
                  <p style={{ margin: 0, color: "#fbbf24", fontSize: ".78rem", lineHeight: 1.5 }}>
                    This network will be open without Wi-Fi encryption. Anyone nearby can connect.
                  </p>
                )}
                {addError && (
                  <span style={{ color: "#f87171", fontSize: ".8rem" }}>
                    {addError}
                  </span>
                )}
                <button
                  style={{
                    ...button,
                    background: "var(--isp-accent)",
                    color: "white",
                    justifyContent: "center",
                  }}
                >
                  Create WLAN
                </button>
              </form>
            )}
            {data.interfaces.map((i) => (
              <WirelessCard
                key={i.id}
                iface={i}
                profiles={data.profiles}
                routerId={selectedRouterId!}
                onChanged={() => query.refetch()}
                readOnly={data.apiMode === "wifi"}
              />
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
