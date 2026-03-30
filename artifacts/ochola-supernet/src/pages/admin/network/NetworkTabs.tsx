import React from "react";
import { Link } from "wouter";
import {
  Server, Shield, PlusCircle, Activity, Database, Wifi, Users, Settings2, RotateCcw,
} from "lucide-react";

const TABS = [
  { id: "routers",           label: "Routers",         href: "/admin/network/routers",           icon: Server    },
  { id: "add-router",        label: "Add Router",      href: "/admin/network/add-router",        icon: PlusCircle},
  { id: "replace-router",    label: "Replace Router",  href: "/admin/network/replace-router",    icon: RotateCcw },
  { id: "pppoe",             label: "PPPoE",           href: "/admin/network/pppoe",             icon: Shield    },
  { id: "ppp",               label: "PPP",          href: "/admin/network/ppp",               icon: Users     },
  { id: "wireless",          label: "Wireless",     href: "/admin/network/wireless",          icon: Wifi      },
  { id: "queues",            label: "Queues",       href: "/admin/network/queues",            icon: Activity  },
  { id: "ip-pools",          label: "IP Pools",     href: "/admin/network/ip-pools",          icon: Database  },
  { id: "router-api-config", label: "API Config",   href: "/admin/network/router-api-config", icon: Settings2 },
];

export function NetworkTabs({ active }: { active: string }) {
  return (
    <div style={{ display: "flex", gap: "0.375rem", overflowX: "auto", paddingBottom: "0.25rem", flexShrink: 0 }}>
      {TABS.map((t) => {
        const isActive = active === t.id;
        return (
          <Link key={t.id} href={t.href}>
            <div style={{
              display: "flex", alignItems: "center", gap: "0.45rem",
              padding: "0.45rem 1rem", borderRadius: 8, fontSize: "0.8125rem", fontWeight: 600,
              whiteSpace: "nowrap", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
              background: isActive ? "rgba(6,182,212,0.1)" : "var(--isp-section)",
              border: isActive ? "1.5px solid rgba(6,182,212,0.35)" : "1px solid var(--isp-border)",
              color: isActive ? "#06b6d4" : "var(--isp-text-muted)",
              boxShadow: isActive ? "0 0 0 3px rgba(6,182,212,0.07)" : "none",
            }}>
              <t.icon style={{ width: 13, height: 13 }} />
              {t.label}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
