import React, { useState } from "react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { ShieldCheck, Check, X, Save, CheckCircle2 } from "lucide-react";

const C = { card: "rgba(255,255,255,0.04)", border: "rgba(99,102,241,0.15)", accent: "#6366f1", text: "#e2e8f0", muted: "#64748b", sub: "#94a3b8" };

const ROLES = ["Super Admin", "ISP Admin", "Sub Admin", "Reseller", "Support"];

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
  const [matrix, setMatrix] = useState(DEFAULT_MATRIX);
  const [saved, setSaved] = useState(false);

  const toggle = (role: string, perm: string) => {
    if (role === "Super Admin") return;
    setMatrix(m => ({ ...m, [role]: { ...m[role], [perm]: !m[role][perm] } }));
    setSaved(false);
  };

  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 2500); };

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 1200 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", margin: 0 }}>Roles & Permissions</h1>
            <p style={{ color: C.muted, margin: "4px 0 0", fontSize: "0.82rem" }}>Define what each role can access and do on the platform.</p>
          </div>
          <button onClick={save} style={{ display: "flex", alignItems: "center", gap: 8, background: saved ? "#065f46" : C.accent, border: "none", borderRadius: 10, padding: "10px 20px", color: "white", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", transition: "background 0.3s" }}>
            {saved ? <CheckCircle2 size={15} /> : <Save size={15} />} {saved ? "Saved!" : "Save Changes"}
          </button>
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
          {ROLES.map(r => (
            <div key={r} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: r === "Super Admin" ? "#6366f1" : r === "ISP Admin" ? "#8b5cf6" : r === "Sub Admin" ? "#2563EB" : r === "Reseller" ? "#f59e0b" : "#64748b" }} />
              <span style={{ fontSize: "0.72rem", color: C.sub, fontWeight: 600 }}>{r}</span>
            </div>
          ))}
        </div>

        {/* Matrix */}
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
                    <td colSpan={ROLES.length + 1} style={{ padding: "10px 20px 6px", background: "rgba(99,102,241,0.06)", borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
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
                                background: has ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.04)",
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                transition: "all 0.15s", opacity: locked ? 0.7 : 1,
                              }}
                            >
                              {has
                                ? <Check size={12} color="#a5b4fc" strokeWidth={3} />
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
        <p style={{ fontSize: "0.72rem", color: C.muted, margin: "12px 0 0" }}>
          Super Admin always has full access and cannot be restricted. Click any cell to toggle permission for that role.
        </p>
      </div>
    </SuperAdminLayout>
  );
}
