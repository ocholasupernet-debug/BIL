import React, { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { usePlans, MOCK_PLANS } from "@/hooks/use-mock-api";
import { Plus, Wifi, Activity, Edit, Trash } from "lucide-react";

export default function Plans() {
  const [activeTab, setActiveTab] = useState('hotspot');
  const { data: plans = MOCK_PLANS } = usePlans(activeTab);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h1 className="text-2xl font-bold text-foreground">Packages / Plans</h1>
          <button className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add Plan
          </button>
        </div>

        <div className="flex overflow-x-auto pb-2 gap-2 hide-scrollbar">
          {['hotspot', 'pppoe', 'static'].map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors capitalize ${
                activeTab === t 
                  ? 'bg-primary/10 text-primary border border-primary/20' 
                  : 'bg-card border border-border text-muted-foreground hover:bg-white/5 hover:text-foreground'
              }`}
            >
              {t} Plans
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {plans.map((p) => (
            <div key={p.id} className="bg-card border border-border rounded-2xl overflow-hidden hover:border-primary/50 transition-colors group">
              <div className="h-1 bg-gradient-to-r from-primary to-blue-500" />
              <div className="p-5 border-b border-border flex justify-between items-center bg-background/50">
                <h3 className="font-bold text-foreground text-lg">{p.name}</h3>
                <Badge variant={p.active ? "success" : "default"}>{p.active ? "Active" : "Inactive"}</Badge>
              </div>
              <div className="p-6">
                <div className="flex items-end gap-2 mb-6">
                  <span className="text-3xl font-black text-foreground">Ksh {p.price}</span>
                  <span className="text-sm font-medium text-muted-foreground mb-1">/ {p.validity}</span>
                </div>
                
                <div className="space-y-3 mb-8">
                  <div className="flex items-center gap-3 text-sm text-slate-300">
                    <Wifi className="w-4 h-4 text-primary" /> {p.speed}
                    {p.burst && <Badge variant="violet" className="ml-auto">Burst</Badge>}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-slate-300">
                    <Activity className="w-4 h-4 text-primary" /> Data: {p.data}
                  </div>
                  <div className="text-xs text-muted-foreground mt-4 pt-4 border-t border-white/5">
                    {p.users} active subscribers
                  </div>
                </div>

                <div className="flex gap-3">
                  <button className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm font-semibold text-foreground hover:bg-white/10 transition">Edit</button>
                  <button className="flex-1 py-2.5 rounded-xl bg-destructive/10 border border-destructive/20 text-sm font-semibold text-destructive hover:bg-destructive/20 transition">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
