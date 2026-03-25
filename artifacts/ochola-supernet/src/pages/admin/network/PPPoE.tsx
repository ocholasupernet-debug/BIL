import React from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { NetworkTabs } from "./NetworkTabs";
import { Activity } from "lucide-react";

export default function PPPoE() {
  return (
    <AdminLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--isp-text)", margin: 0 }}>Network — PPPoE Sign In</h1>
        <NetworkTabs active="pppoe" />
        <div style={{ borderRadius: 10, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "4rem 2rem", textAlign: "center" }}>
          <Activity style={{ width: 44, height: 44, color: "var(--isp-text-sub)", margin: "0 auto 1rem", opacity: 0.5 }} />
          <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--isp-text)", margin: "0 0 0.5rem" }}>Coming Soon</h3>
          <p style={{ fontSize: "0.8125rem", color: "var(--isp-text-muted)", margin: 0 }}>PPPoE Sign In module is under active development.</p>
        </div>
      </div>
    </AdminLayout>
  );
}
