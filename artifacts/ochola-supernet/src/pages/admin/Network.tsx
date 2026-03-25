import React, { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useLocation } from "wouter";
import { Server, Wifi, Activity, Terminal, Shield, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function Network() {
  const [location] = useLocation();
  // Extract tab from URL query params manually since wouter doesn't have useSearchParams built-in easily
  const searchParams = new URLSearchParams(window.location.search);
  const tab = searchParams.get('tab') || 'routers';
  const [activeTab, setActiveTab] = useState(tab);

  const tabs = [
    { id: 'routers', name: 'Routers', icon: Server },
    { id: 'pppoe-sign-in', name: 'PPPoE Sign In', icon: Shield },
    { id: 'self-install', name: 'Self Install', icon: Terminal },
    { id: 'queues', name: 'Queues', icon: Activity },
    { id: 'ip-pool', name: 'IP Pool', icon: Server },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h1 className="text-2xl font-bold text-foreground capitalize">Network — {activeTab.replace(/-/g, ' ')}</h1>
          {activeTab === 'routers' && (
            <button className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:-translate-y-0.5 transition flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Router
            </button>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="flex overflow-x-auto pb-2 gap-2 hide-scrollbar">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
                activeTab === t.id 
                  ? 'bg-primary/10 text-primary border border-primary/20' 
                  : 'bg-card border border-border text-muted-foreground hover:bg-white/5 hover:text-foreground'
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.name}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'routers' && (
          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-background/80 text-muted-foreground text-xs uppercase font-semibold border-b border-border">
                  <tr>
                    <th className="px-6 py-4">Name</th>
                    <th className="px-6 py-4">IP Address</th>
                    <th className="px-6 py-4">Model</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Uptime</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr className="hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4 font-bold text-foreground">Router 01 — Nairobi HQ</td>
                    <td className="px-6 py-4 font-mono text-muted-foreground">192.168.1.1</td>
                    <td className="px-6 py-4 text-muted-foreground">RB4011iGS+5HacQ2HnD</td>
                    <td className="px-6 py-4"><Badge variant="success">Online</Badge></td>
                    <td className="px-6 py-4 text-muted-foreground">14d 3h</td>
                    <td className="px-6 py-4 text-right"><button className="text-xs font-semibold text-primary hover:underline">Connect</button></td>
                  </tr>
                  <tr className="hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4 font-bold text-foreground">Router 02 — Karen Branch</td>
                    <td className="px-6 py-4 font-mono text-muted-foreground">192.168.2.1</td>
                    <td className="px-6 py-4 text-muted-foreground">RB2011UiAS-2HnD</td>
                    <td className="px-6 py-4"><Badge variant="success">Online</Badge></td>
                    <td className="px-6 py-4 text-muted-foreground">7d 12h</td>
                    <td className="px-6 py-4 text-right"><button className="text-xs font-semibold text-primary hover:underline">Connect</button></td>
                  </tr>
                  <tr className="hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4 font-bold text-foreground">Router 03 — Westlands</td>
                    <td className="px-6 py-4 font-mono text-muted-foreground">10.0.3.1</td>
                    <td className="px-6 py-4 text-muted-foreground">hEX S</td>
                    <td className="px-6 py-4"><Badge variant="danger">Offline</Badge></td>
                    <td className="px-6 py-4 text-muted-foreground">—</td>
                    <td className="px-6 py-4 text-right"><button className="text-xs font-semibold text-muted-foreground cursor-not-allowed">Connect</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'self-install' && (
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm max-w-3xl">
            <h3 className="text-lg font-bold text-foreground mb-2">Hotspot Self-Install Script</h3>
            <p className="text-sm text-muted-foreground mb-4">Copy this script and paste it into your MikroTik terminal to automatically configure the hotspot portal.</p>
            
            <div className="bg-[#080c10] border border-white/10 rounded-xl p-4 relative group">
              <button className="absolute top-3 right-3 px-3 py-1 bg-white/10 hover:bg-white/20 text-xs font-semibold rounded-lg text-white transition opacity-0 group-hover:opacity-100">Copy</button>
              <pre className="font-mono text-xs text-emerald-400 whitespace-pre-wrap leading-relaxed">
{`/ip hotspot profile add name=hsprof1 hotspot-address=192.168.1.1 dns-name=hotspot.isplatty.org login-by=http-chap,http-pap use-radius=yes
/ip hotspot add name=hotspot1 interface=bridge1 profile=hsprof1 address-pool=hspool idle-timeout=none
/ip pool add name=hspool ranges=192.168.2.2-192.168.2.254
/radius add service=hotspot address=10.0.0.1 secret=supersecret`}
              </pre>
            </div>
          </div>
        )}

        {/* Other tabs can be similarly stubbed to show UI */}
        {(activeTab === 'queues' || activeTab === 'ip-pool' || activeTab === 'pppoe-sign-in') && (
          <div className="bg-card border border-border rounded-2xl p-12 text-center shadow-sm">
            <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-bold text-foreground mb-2">Coming Soon</h3>
            <p className="text-sm text-muted-foreground">This feature module is currently under active development.</p>
          </div>
        )}

      </div>
    </AdminLayout>
  );
}
