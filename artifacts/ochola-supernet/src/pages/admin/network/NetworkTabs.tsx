import React from "react";
import { Link } from "wouter";
import { Server, Shield, Terminal, Activity } from "lucide-react";

const TABS = [
  { id: "routers",      label: "Routers",      href: "/admin/network/routers",      icon: Server   },
  { id: "pppoe",        label: "PPPoE Sign In", href: "/admin/network/pppoe",        icon: Shield   },
  { id: "self-install", label: "Self Install",  href: "/admin/network/self-install", icon: Terminal },
  { id: "queues",       label: "Queues",        href: "/admin/network/queues",       icon: Activity },
  { id: "ippool",       label: "IP Pool",       href: "/admin/network/ippool",       icon: Server   },
];

export function NetworkTabs({ active }: { active: string }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto", paddingBottom: "0.25rem" }}>
      {TABS.map((t) => {
        const isActive = active === t.id;
        return (
          <Link key={t.id} href={t.href}>
            <div style={{
              display: "flex", alignItems: "center", gap: "0.5rem",
              padding: "0.45rem 1rem", borderRadius: 8, fontSize: "0.8125rem", fontWeight: 600,
              whiteSpace: "nowrap", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
              background: isActive ? "rgba(6,182,212,0.1)" : "var(--isp-section)",
              border: isActive ? "1px solid rgba(6,182,212,0.3)" : "1px solid var(--isp-border)",
              color: isActive ? "#06b6d4" : "var(--isp-text-muted)",
            }}>
              <t.icon style={{ width: 14, height: 14 }} />
              {t.label}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
