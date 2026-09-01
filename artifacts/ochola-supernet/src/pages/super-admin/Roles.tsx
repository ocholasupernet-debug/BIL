import React, { useEffect, useState } from "react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { Check, X, Save, CheckCircle2, Loader2 } from "lucide-react";

const C = { card: "rgba(255,255,255,0.04)", border: "var(--isp-accent-glow)", accent: "var(--isp-accent)", text: "#e2e8f0", muted: "#64748b", sub: "#94a3b8" };

const ROLES = ["Super Admin", "ISP Admin", "Sub Admin", "Reseller", "Support"];
const ROLE_KEYS = ["super_admin", "isp_admin", "sub_admin", "reseller", "support"];

const PERMISSIONS: { category: string; perms: string[] }[] = [
  { category: "Admins", perms: ["View Admins", "Create Admins", "Edit Admins", "Delete Admins", "Toggle Active"] },
  { category: "Customers", perms: ["View Customers", "Create Customers", "Edit Customers", "Delete Customers", "Export Customers"] },
  { category: "Routers", perms: ["View Routers", "Add Routers", "Edit Routers", "Delete Routers", "Push Config"] },
  { category: "Plans", perms: ["View Plans", "Create Plans", "Edit Plans", "Delete Plans"] },
  { category: "Vouchers", perms: ["View Vouchers", "Generate Vouchers", "Delete Vouchers", "Export Vouchers"] },
  { category: "Billing", perms: ["View Transactions", "Create Invoices", "Issue Refunds", "Configure Billing"] },
  { category: "Reports", perms: ["View Reports", "Export Reports", "Custom Reports"] },
  { category: "Settings", perms: ["View Settings", "Edit Settings", "Manage Gateways", "System Limits"] },
  { category: "Security", perms: ["View Logs", "Manage API Keys", "Manage Backups", "Automation"] },
];

const DEFAULT_MATRIX: Record<string, Record<string, boolean>> = {
  "Super Admin":  Object.fromEntries(PERMISSIONS.flatMap(c => c.perms).map(p => [p, true])),
  "ISP Admin":    Object.fromEntries(PERMISSIONS.flatMap(c => c.perms).map(p => [p, !["Manage Gateways","System Limits","Delete Admins","Manage Backups"].includes(p)])),
  "Sub Admin":    Object.fromEntries(PERMISSIONS.flatMap(c => c.perms).map(p => [p, ["View Customers","Edit Customers","View Routers","View Plans","View Vouchers","Generate Vouchers","View Reports","View Transactions"].includes(p)])),
  "Reseller":     Object.fromEntries(PERMISSIONS.flatMap(c => c.perms).map(p => [p, ["View Customers","Create Customers","View Plans","View Vouchers","Generate Vouchers","View Transactions"].includes(p)])),
  "Support":      Object.fromEntries(PERMISSIONS.flatMap(c => c.perms).map(p => [p, ["View Customers","View Routers","View Plans","View Vouchers","View Reports","View Transactions","View Logs"].includes(p)])),
};

export default function SuperAdminRoles() {
  const [matrix, setMatrix] = useState<Record<string, Record<string, boolean>>>({});
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const authHeaders = () => ({
    "Content-Type": "application/json",
    "x-sa-token": localStorage.getItem("ochola_superadmin_token") || "",
  });

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/super-admin/roles", { headers: authHeaders(), cache: "no-store" });
      const data = await response.json() as { matrix?: Record<string, Record<string, boolean>>; error?: string };
      if (!response.ok || !data.matrix) throw new Error(data.error || "Roles and permissions could not be loaded.");
      setMatrix(Object.fromEntries(ROLES.map((role, index) => [role, data.matrix?.[ROLE_KEYS[index]] ?? {}])));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Roles and permissions could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const toggle = (role: string, perm: string) => {
    if (role === "Super Admin") return;
    setMatrix(m => ({ ...m, [role]: { ...m[role], [perm]: !m[role]?.[perm] } }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const apiMatrix = Object.fromEntries(ROLES.map((role, index) => [ROLE_KEYS[index], matrix[role] ?? {}]));
      const response = await fetch("/api/super-admin/roles", { method: "PUT", headers: authHeaders(), body: JSON.stringify({ matrix: apiMatrix }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Roles and permissions could not be saved.");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Roles and permissions could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 1200 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", margin: 0 }}>Roles & Permissions</h1>
            <p style={{ color: C.muted, margin: "4px 0 0", fontSize: "0.82rem" }}>Define what each role can access and do on the platform.</p>
          </div>
          <button disabled={loading || saving} onClick={() => void save()} style={{ display: "flex", alignItems: "center", gap: 8, background: saved ? "#065f46" : C.accent, border: "none", borderRadius: 10, padding: "10px 20px", color: "white", fontWeight: 700, fontSize: "0.82rem", cursor: loading || saving ? "wait" : "pointer", opacity: loading || saving ? 0.65 : 1, transition: "background 0.3s" }}>
            {saving ? <Loader2 size={15} className="spin" /> : saved ? <CheckCircle2 size={15} /> : <Save size={15} />} {saving ? "Saving…" : saved ? "Saved!" : "Save Changes"}
          </button>
        </div>
        {error && <div role="alert" style={{ marginBottom: 16, padding: "0.75rem 1rem", borderRadius: 10, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "#fca5a5", fontSize: "0.78rem" }}>{error}</div>}

        {/* Legend */}
        <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
          {ROLES.map(r => (
            <div key={r} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: r === "Super Admin" ? "var(--isp-accent)" : r === "ISP Admin" ? "#8b5cf6" : r === "Sub Admin" ? "var(--isp-accent)" : r === "Reseller" ? "#f59e0b" : "#64748b" }} />
              <span style={{ fontSize: "0.72rem", color: C.sub, fontWeight: 600 }}>{r}</span>
            </div>
          ))}
        </div>

        {/* Matrix */}
        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: C.muted }}><Loader2 size={22} className="spin" /> <p>Loading permissions…</p></div>
        ) : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                <th style={{ textAlign: "left", padding: "14px 20px", color: C.muted, fontWeight: 700, fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.06em", minWidth: 200 }}>Permission</th>
                {ROLES.map(r => (
                  <th key={r} style={{ textAlign: "center", padding: "14px 16px", color: "white", fontWeight: 700, fontSize: "0.72rem", minWidth: 110 }}>
                    {r}
                    {r === "Super Admin" && <div style={{ fontSize: "0.6rem", color: C.accent, fontWeight: 600, marginTop: 2 }}>Full Access</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map(({ category, perms }) => (
                <React.Fragment key={category}>
                  <tr>
                    <td colSpan={ROLES.length + 1} style={{ padding: "10px 20px 6px", background: "var(--isp-accent-glow)", borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
                      <span style={{ fontSize: "0.65rem", fontWeight: 800, color: C.accent, textTransform: "uppercase", letterSpacing: "0.08em" }}>{category}</span>
                    </td>
                  </tr>
                  {perms.map(perm => (
                    <tr key={perm} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <td style={{ padding: "11px 20px", color: C.sub }}>{perm}</td>
                      {ROLES.map(role => {
                        const has = matrix[role]?.[perm] ?? false;
                        const locked = role === "Super Admin";
                        return (
                          <td key={role} style={{ textAlign: "center", padding: "11px 16px" }}>
                            <button
                              onClick={() => toggle(role, perm)}
                              title={locked ? "Super Admin has full access" : undefined}
                              style={{
                                width: 26, height: 26, borderRadius: 6, border: "none", cursor: locked ? "not-allowed" : "pointer",
                                background: has ? "var(--isp-accent-glow)" : "rgba(255,255,255,0.04)",
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                transition: "all 0.15s", opacity: locked ? 0.7 : 1,
                              }}
                            >
                              {has
                                ? <Check size={12} color="var(--isp-accent)" strokeWidth={3} />
                                : <X size={10} color="#64748b" strokeWidth={2.5} />
                              }
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        )}
        <p style={{ fontSize: "0.72rem", color: C.muted, margin: "12px 0 0" }}>
          Super Admin always has full access and cannot be restricted. Click any cell to toggle permission for that role.
        </p>
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </SuperAdminLayout>
  );
}
