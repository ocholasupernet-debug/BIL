import React from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { Plus } from "lucide-react";

const ROUTERS = [
  { name: "Router 01 — Nairobi HQ",  ip: "192.168.1.1", model: "RB4011iGS+5HacQ2HnD", online: true,  uptime: "14d 3h"  },
  { name: "Router 02 — Karen Branch", ip: "192.168.2.1", model: "RB2011UiAS-2HnD",      online: true,  uptime: "7d 12h"  },
  { name: "Router 03 — Westlands",   ip: "10.0.3.1",    model: "hEX S",                online: false, uptime: "—"       },
];

export default function Routers() {
  return (
    <AdminLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>Network — Routers</h1>
          <button style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "#06b6d4", border: "none", borderRadius: 8, padding: "0.5rem 1rem", color: "white", fontWeight: 700, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
            <Plus style={{ width: 15, height: 15 }} /> Add Router
          </button>
        </div>

        <NetworkTabs active="routers" />

        <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--isp-border-subtle)" }}>
                  {["Name", "IP Address", "Model", "Status", "Uptime", "Actions"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "0.75rem 1.25rem", color: "var(--isp-text-sub)", fontWeight: 600, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROUTERS.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--isp-border-subtle)" }}>
                    <td style={{ padding: "0.75rem 1.25rem", color: "var(--isp-text)", fontWeight: 600 }}>{r.name}</td>
                    <td style={{ padding: "0.75rem 1.25rem", color: "var(--isp-text-muted)", fontFamily: "monospace", fontSize: "0.75rem" }}>{r.ip}</td>
                    <td style={{ padding: "0.75rem 1.25rem", color: "var(--isp-text-muted)" }}>{r.model}</td>
                    <td style={{ padding: "0.75rem 1.25rem" }}>
                      <span style={{ fontSize: "0.7rem", padding: "0.2rem 0.625rem", borderRadius: 20, fontWeight: 700, background: r.online ? "rgba(34,197,94,0.1)" : "rgba(248,113,113,0.1)", color: r.online ? "#22c55e" : "#f87171" }}>
                        {r.online ? "Online" : "Offline"}
                      </span>
                    </td>
                    <td style={{ padding: "0.75rem 1.25rem", color: "var(--isp-text-muted)", fontFamily: "monospace", fontSize: "0.75rem" }}>{r.uptime}</td>
                    <td style={{ padding: "0.75rem 1.25rem" }}>
                      <button style={{ fontSize: "0.75rem", color: r.online ? "#06b6d4" : "var(--isp-text-sub)", background: "none", border: "none", cursor: r.online ? "pointer" : "not-allowed", fontWeight: 600, fontFamily: "inherit" }}>
                        Connect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
