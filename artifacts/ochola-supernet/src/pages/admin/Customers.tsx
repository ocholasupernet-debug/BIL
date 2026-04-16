import React, { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/badge";
import { supabase, ADMIN_ID, type DbCustomer } from "@/lib/supabase";
import {
  Search, Plus, Edit, Trash, Download, Loader2, Users,
  Wifi, Network, Globe, Eye, EyeOff, RefreshCw, X,
  CheckCircle2, AlertTriangle, Copy, ShieldCheck, RotateCcw, UploadCloud,
} from "lucide-react";
import { RouterSyncBar } from "@/components/ui/RouterSyncBar";

/* ══════════════════════════ Types ══════════════════════════ */
interface PlanLite { id: number; name: string; type: string; price: number; speed_down: number; speed_up: number; }
interface RouterLite { id: number; name: string; host: string; status: string; }

type CustomerType = "hotspot" | "pppoe" | "static";

interface NewCustomerForm {
  type: CustomerType;
  name: string;
  username: string;
  password: string;
  email: string;
  phone: string;
  plan_id: number | "";
  router_id: number | "";
  // hotspot extras
  mac_address: string;
  // pppoe extras
  pppoe_username: string;
  ip_assign: "dynamic" | "pool" | "static";
  ip_address: string;
  pppoe_service: string;
  // static extras
  subnet_mask: string;
  gateway_ip: string;
  // common
  expires_at: string;
  custom_fields: { name: string; value: string }[];
}

/* ══════════════════════════ Helpers ══════════════════════════ */
const TYPE_META: Record<CustomerType, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  hotspot: { label: "Hotspot", color: "var(--isp-accent)", bg: "var(--isp-accent-glow)",   icon: <Wifi    size={11} /> },
  pppoe:   { label: "PPPoE",   color: "var(--isp-accent)", bg: "var(--isp-accent-glow)",  icon: <Network size={11} /> },
  static:  { label: "Static",  color: "#34d399", bg: "rgba(16,185,129,0.12)",  icon: <Globe   size={11} /> },
};

const AVATAR_COLORS = ["var(--isp-accent)","#8b5cf6","#f59e0b","#10b981","#ec4899","#f87171","#60a5fa"];
function avatarColor(id: number) { return AVATAR_COLORS[id % AVATAR_COLORS.length]; }
function initials(name?: string | null): string {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}
function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
}
function genPassword(len = 10): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
function genUsername(name: string): string {
  const base = name.trim().split(" ")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  const num  = Math.floor(1000 + Math.random() * 9000);
  return `${base}${num}`;
}
function emptyForm(type: CustomerType = "hotspot"): NewCustomerForm {
  return {
    type, name: "", username: "", password: genPassword(), email: "", phone: "",
    plan_id: "", router_id: "", mac_address: "", pppoe_username: "", ip_assign: "dynamic",
    ip_address: "", pppoe_service: "internet", subnet_mask: "255.255.255.0", gateway_ip: "", expires_at: "",
    custom_fields: [],
  };
}

/* ══════════════════════════ DB helpers ══════════════════════════ */
async function fetchCustomers(): Promise<DbCustomer[]> {
  const { data, error } = await supabase.from("isp_customers").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
async function fetchPlans(): Promise<PlanLite[]> {
  const { data, error } = await supabase.from("isp_plans").select("id,name,type,price,speed_down,speed_up").eq("admin_id", ADMIN_ID).order("type").order("price");
  if (error) throw error;
  return data ?? [];
}
async function fetchRouters(): Promise<RouterLite[]> {
  const { data, error } = await supabase.from("isp_routers").select("id,name,host,status").eq("admin_id", ADMIN_ID);
  if (error) throw error;
  return data ?? [];
}

async function createCustomer(form: NewCustomerForm, plans: PlanLite[]): Promise<void> {
  const plan = plans.find(p => p.id === form.plan_id);
  const radUsername = form.type === "pppoe" ? (form.pppoe_username || form.username) : form.username;

  // 1. Insert to isp_customers
  const { error: custErr } = await supabase.from("isp_customers").insert({
    admin_id:      ADMIN_ID,
    name:          form.name || null,
    username:      form.username || null,
    password:      form.password,
    email:         form.email || null,
    phone:         form.phone || null,
    type:          form.type,
    plan_id:       form.plan_id || null,
    status:        "active",
    ip_address:    form.ip_address || null,
    mac_address:   form.mac_address || null,
    pppoe_username: form.type === "pppoe" ? (form.pppoe_username || form.username) : null,
    expires_at:    form.expires_at ? new Date(form.expires_at).toISOString() : null,
    custom_fields: form.custom_fields.length > 0
      ? Object.fromEntries(form.custom_fields.filter(f => f.value.trim()).map(f => [f.name, f.value]))
      : null,
  });
  if (custErr) throw custErr;

  // 2. RADIUS: core auth entry
  const radRows: { username: string; attribute: string; op: string; value: string }[] = [
    { username: radUsername, attribute: "Cleartext-Password", op: ":=", value: form.password },
  ];

  // Type-specific RADIUS attributes
  if (form.type === "static" && form.ip_address) {
    radRows.push({ username: radUsername, attribute: "Framed-IP-Address",  op: ":=", value: form.ip_address });
    radRows.push({ username: radUsername, attribute: "Framed-IP-Netmask",  op: ":=", value: form.subnet_mask || "255.255.255.0" });
    if (form.gateway_ip)
      radRows.push({ username: radUsername, attribute: "Framed-Route", op: ":=", value: form.gateway_ip });
  }
  if (form.type === "pppoe" && form.ip_assign === "static" && form.ip_address) {
    radRows.push({ username: radUsername, attribute: "Framed-IP-Address", op: ":=", value: form.ip_address });
  }
  if (form.type === "hotspot" && form.mac_address) {
    radRows.push({ username: radUsername, attribute: "Calling-Station-Id", op: ":=", value: form.mac_address });
  }
  if (form.expires_at) {
    radRows.push({ username: radUsername, attribute: "Expiration", op: ":=", value: new Date(form.expires_at).toDateString() });
  }

  const { error: radErr } = await supabase.from("radcheck").insert(radRows);
  if (radErr) throw radErr;

  // 3. RADIUS: plan group linkage
  if (plan) {
    await supabase.from("radusergroup").insert({ username: radUsername, groupname: plan.name, priority: 1 });
  }
}

async function deleteCustomer(c: DbCustomer): Promise<void> {
  const radUsername = c.pppoe_username || c.username;
  await supabase.from("isp_customers").delete().eq("id", c.id);
  if (radUsername) {
    await supabase.from("radcheck").delete().eq("username", radUsername);
    await supabase.from("radusergroup").delete().eq("username", radUsername);
  }
}

/* ══════════════════════════ Form Field ══════════════════════════ */
function Field({ label, required, children, hint }: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}{required && <span style={{ color: "#f87171", marginLeft: 2 }}>*</span>}
      </span>
      {children}
      {hint && <span style={{ fontSize: "0.68rem", color: "var(--isp-text-sub)" }}>{hint}</span>}
    </label>
  );
}

const inp: React.CSSProperties = {
  background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8,
  padding: "0.575rem 0.875rem", color: "var(--isp-text)", fontSize: "0.875rem", fontFamily: "inherit", width: "100%", boxSizing: "border-box",
};
const sel: React.CSSProperties = { ...inp };

/* ══════════════════════════ Custom Fields ══════════════════════════ */
function CustomFieldsSection({ fields, setFields }: { fields: { name: string; value: string }[]; setFields: (fn: (prev: { name: string; value: string }[]) => { name: string; value: string }[]) => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");

  const addField = () => {
    if (!newFieldName.trim()) return;
    setFields(prev => [...prev, { name: newFieldName.trim(), value: "" }]);
    setNewFieldName("");
    setShowAdd(false);
  };

  const updateValue = (index: number, value: string) => {
    setFields(prev => prev.map((f, i) => i === index ? { ...f, value } : f));
  };

  const removeField = (index: number) => {
    setFields(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <>
      <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--isp-accent)", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid var(--isp-border-subtle)", paddingBottom: "0.375rem", marginTop: "0.25rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        Custom Fields
        <button type="button" onClick={() => setShowAdd(true)} style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(37,99,235,0.1)", border: "1px solid var(--isp-accent-border)", borderRadius: 6, padding: "2px 8px", color: "var(--isp-accent)", fontSize: "0.68rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
          <Plus size={10} /> Add Field
        </button>
      </div>

      {showAdd && (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <span style={{ display: "block", fontSize: "0.68rem", fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: 4, textTransform: "uppercase" }}>Field Name</span>
            <input
              style={inp}
              value={newFieldName}
              onChange={e => setNewFieldName(e.target.value)}
              placeholder="e.g. National ID, Address Bill, etc."
              onKeyDown={e => e.key === "Enter" && addField()}
            />
          </div>
          <button type="button" onClick={addField} style={{ padding: "0.575rem 1rem", borderRadius: 8, background: "var(--isp-accent)", border: "none", color: "white", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
            Add
          </button>
          <button type="button" onClick={() => setShowAdd(false)} style={{ padding: "0.575rem 0.75rem", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>
            Cancel
          </button>
        </div>
      )}

      {fields.length === 0 && !showAdd && (
        <p style={{ fontSize: "0.75rem", color: "var(--isp-text-sub)", margin: 0, fontStyle: "italic" }}>
          No custom fields added. Use custom fields for extra data like ID numbers, building name, installment info, etc.
        </p>
      )}

      {fields.map((field, i) => (
        <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <span style={{ display: "block", fontSize: "0.68rem", fontWeight: 700, color: "var(--isp-text-muted)", marginBottom: 4, textTransform: "uppercase" }}>
              {field.name}
            </span>
            <input
              style={inp}
              value={field.value}
              onChange={e => updateValue(i, e.target.value)}
              placeholder={`Enter ${field.name}`}
            />
          </div>
          <button type="button" onClick={() => removeField(i)}
            style={{ padding: "0.5rem", borderRadius: 6, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171", cursor: "pointer", flexShrink: 0, display: "flex" }}>
            <X size={14} />
          </button>
        </div>
      ))}
    </>
  );
}

/* ══════════════════════════ Add / Edit Modal ══════════════════════════ */
function CustomerModal({
  plans, routers, editing, onClose, onSave,
}: {
  plans: PlanLite[];
  routers: RouterLite[];
  editing?: DbCustomer | null;
  onClose: () => void;
  onSave: (form: NewCustomerForm) => void;
}) {
  const isEdit = !!editing;
  const [form, setForm] = useState<NewCustomerForm>(() => {
    if (editing) {
      const type = (editing.type ?? "hotspot") as CustomerType;
      return {
        ...emptyForm(type),
        name:          editing.name ?? "",
        username:      editing.username ?? "",
        password:      editing.password ?? "",
        email:         editing.email ?? "",
        phone:         editing.phone ?? "",
        plan_id:       editing.plan_id ?? "",
        mac_address:   editing.mac_address ?? "",
        pppoe_username:editing.pppoe_username ?? "",
        ip_address:    editing.ip_address ?? "",
        expires_at:    editing.expires_at ? editing.expires_at.slice(0, 10) : "",
        custom_fields: (editing as any).custom_fields
          ? Object.entries((editing as any).custom_fields).map(([name, value]) => ({ name, value: String(value) }))
          : [],
      };
    }
    return emptyForm("hotspot");
  });

  const [showPw,    setShowPw]    = useState(false);
  const [saving,    setSaving]    = useState(false);

  const hotspotPlans = plans.filter(p => p.type === "hotspot");
  const pppoePlans   = plans.filter(p => p.type === "pppoe");
  const allPlans     = form.type === "pppoe" ? pppoePlans : form.type === "hotspot" ? hotspotPlans : plans;
  const selectedPlan = plans.find(p => p.id === form.plan_id);

  const set = (k: keyof NewCustomerForm, v: string | number) =>
    setForm(f => ({ ...f, [k]: v }));

  const setType = (t: CustomerType) => {
    setForm(f => ({ ...emptyForm(t), password: f.password }));
  };

  const handleNameBlur = () => {
    if (form.name && !form.username) set("username", genUsername(form.name));
    if (form.name && !form.pppoe_username) set("pppoe_username", genUsername(form.name));
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    if (form.type !== "pppoe" && !form.username.trim()) return;
    if (form.type === "pppoe" && !form.pppoe_username.trim() && !form.username.trim()) return;
    setSaving(true);
    onSave(form);
  };

  const tabs: CustomerType[] = ["hotspot", "pppoe", "static"];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 16, width: "100%", maxWidth: 580, maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 32px 80px rgba(0,0,0,0.6)", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--isp-border-subtle)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--isp-accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Users size={18} style={{ color: "white" }} />
            </div>
            <div>
              <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--isp-text)" }}>{isEdit ? "Edit Customer" : "Add Customer"}</div>
              <div style={{ fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>
                {isEdit ? `Editing: ${editing?.name ?? editing?.username}` : "Register a new customer to the network"}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.4rem", color: "var(--isp-text-muted)", cursor: "pointer", display: "flex", alignItems: "center" }}>
            <X size={16} />
          </button>
        </div>

        {/* Type Tabs — only when adding */}
        {!isEdit && (
          <div style={{ display: "flex", gap: "0.5rem", padding: "1rem 1.5rem 0", flexShrink: 0 }}>
            {tabs.map(t => {
              const m = TYPE_META[t];
              const active = form.type === t;
              return (
                <button key={t} onClick={() => setType(t)}
                  style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.35rem", padding: "0.625rem 0.5rem", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", border: active ? `1.5px solid ${m.color}` : "1.5px solid var(--isp-border)", background: active ? m.bg : "rgba(255,255,255,0.02)", transition: "all 0.15s" }}>
                  <span style={{ color: active ? m.color : "var(--isp-text-sub)", display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.8rem", fontWeight: 700 }}>
                    {m.icon} {m.label}
                  </span>
                  <span style={{ fontSize: "0.65rem", color: active ? m.color : "var(--isp-text-sub)", opacity: 0.8 }}>
                    {t === "hotspot" ? "Voucher / MAC" : t === "pppoe" ? "Dial-up / DSL" : "Fixed IP"}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Scrollable body */}
        <div style={{ overflowY: "auto", padding: "1.25rem 1.5rem", flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

            {/* ─── IDENTITY ─── */}
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--isp-accent)", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid var(--isp-border-subtle)", paddingBottom: "0.375rem" }}>
              Identity
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.875rem" }}>
              <Field label="Full Name" required>
                <input style={inp} value={form.name} placeholder="e.g. John Kamau"
                  onChange={e => set("name", e.target.value)}
                  onBlur={handleNameBlur} />
              </Field>
              <Field label="Phone Number">
                <input style={inp} value={form.phone} placeholder="+254 7XX XXX XXX"
                  onChange={e => set("phone", e.target.value)} />
              </Field>
            </div>

            <Field label="Email Address">
              <input style={inp} type="email" value={form.email} placeholder="customer@email.com"
                onChange={e => set("email", e.target.value)} />
            </Field>

            {/* ─── CONNECTION ─── */}
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--isp-accent)", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid var(--isp-border-subtle)", paddingBottom: "0.375rem", marginTop: "0.25rem" }}>
              {form.type === "hotspot" ? "Hotspot Credentials" : form.type === "pppoe" ? "PPPoE Credentials" : "Static IP Credentials"}
            </div>

            {/* Hotspot fields */}
            {form.type === "hotspot" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.875rem" }}>
                  <Field label="Username" required hint="Used to log in to the hotspot portal">
                    <input style={inp} value={form.username} placeholder="e.g. john1234"
                      onChange={e => set("username", e.target.value)} />
                  </Field>
                  <Field label="Password" required>
                    <div style={{ position: "relative" }}>
                      <input style={{ ...inp, paddingRight: "2.5rem" }} type={showPw ? "text" : "password"} value={form.password}
                        onChange={e => set("password", e.target.value)} />
                      <button type="button" onClick={() => setShowPw(s => !s)}
                        style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--isp-text-sub)", cursor: "pointer" }}>
                        {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </Field>
                </div>
                <Field label="MAC Address (optional)" hint="Lock this account to a specific device MAC">
                  <input style={inp} value={form.mac_address} placeholder="AA:BB:CC:DD:EE:FF"
                    onChange={e => set("mac_address", e.target.value.toUpperCase())} />
                </Field>
              </>
            )}

            {/* PPPoE fields */}
            {form.type === "pppoe" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.875rem" }}>
                  <Field label="PPPoE Username" required hint="Dial-up username (sent by client router)">
                    <input style={inp} value={form.pppoe_username} placeholder="e.g. john1234"
                      onChange={e => set("pppoe_username", e.target.value)} />
                  </Field>
                  <Field label="Password" required>
                    <div style={{ position: "relative" }}>
                      <input style={{ ...inp, paddingRight: "2.5rem" }} type={showPw ? "text" : "password"} value={form.password}
                        onChange={e => set("password", e.target.value)} />
                      <button type="button" onClick={() => setShowPw(s => !s)}
                        style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--isp-text-sub)", cursor: "pointer" }}>
                        {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </Field>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.875rem" }}>
                  <Field label="Service Name" hint="MikroTik ppp service-name">
                    <input style={inp} value={form.pppoe_service} placeholder="internet"
                      onChange={e => set("pppoe_service", e.target.value)} />
                  </Field>
                  <Field label="IP Assignment">
                    <select style={sel} value={form.ip_assign} onChange={e => set("ip_assign", e.target.value as "dynamic" | "pool" | "static")}>
                      <option value="dynamic">Dynamic (auto)</option>
                      <option value="pool">IP Pool</option>
                      <option value="static">Fixed IP</option>
                    </select>
                  </Field>
                </div>
                {form.ip_assign === "static" && (
                  <Field label="Fixed Remote IP Address" required hint="IP to assign to the client WAN interface">
                    <input style={inp} value={form.ip_address} placeholder="e.g. 10.10.1.50"
                      onChange={e => set("ip_address", e.target.value)} />
                  </Field>
                )}
              </>
            )}

            {/* Static fields */}
            {form.type === "static" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.875rem" }}>
                  <Field label="Username" required>
                    <input style={inp} value={form.username} placeholder="e.g. john_static"
                      onChange={e => set("username", e.target.value)} />
                  </Field>
                  <Field label="Password" required>
                    <div style={{ position: "relative" }}>
                      <input style={{ ...inp, paddingRight: "2.5rem" }} type={showPw ? "text" : "password"} value={form.password}
                        onChange={e => set("password", e.target.value)} />
                      <button type="button" onClick={() => setShowPw(s => !s)}
                        style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--isp-text-sub)", cursor: "pointer" }}>
                        {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </Field>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.875rem" }}>
                  <Field label="IP Address" required hint="Static IP to assign to this client">
                    <input style={inp} value={form.ip_address} placeholder="e.g. 192.168.1.100"
                      onChange={e => set("ip_address", e.target.value)} />
                  </Field>
                  <Field label="Subnet Mask">
                    <input style={inp} value={form.subnet_mask} placeholder="255.255.255.0"
                      onChange={e => set("subnet_mask", e.target.value)} />
                  </Field>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.875rem" }}>
                  <Field label="MAC Address (optional)" hint="Bind IP to this device">
                    <input style={inp} value={form.mac_address} placeholder="AA:BB:CC:DD:EE:FF"
                      onChange={e => set("mac_address", e.target.value.toUpperCase())} />
                  </Field>
                  <Field label="Gateway IP (optional)">
                    <input style={inp} value={form.gateway_ip} placeholder="e.g. 192.168.1.1"
                      onChange={e => set("gateway_ip", e.target.value)} />
                  </Field>
                </div>
              </>
            )}

            {/* ─── PLAN & ROUTER ─── */}
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--isp-accent)", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid var(--isp-border-subtle)", paddingBottom: "0.375rem", marginTop: "0.25rem" }}>
              Plan & Router
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.875rem" }}>
              <Field label={`${form.type === "pppoe" ? "PPPoE" : form.type === "hotspot" ? "Hotspot" : ""} Plan`} required>
                <select style={sel} value={form.plan_id} onChange={e => set("plan_id", Number(e.target.value))}>
                  <option value="">— Select plan —</option>
                  {allPlans.map(p => (
                    <option key={p.id} value={p.id}>{p.name} · Ksh {p.price}{p.speed_down ? ` · ${p.speed_down}/${p.speed_up}Mbps` : ""}</option>
                  ))}
                </select>
              </Field>
              <Field label="Router" required>
                <select style={sel} value={form.router_id} onChange={e => set("router_id", Number(e.target.value))}>
                  <option value="">— Select router —</option>
                  {routers.map(r => (
                    <option key={r.id} value={r.id}>{r.name} ({r.status === "online" ? "🟢" : "🔴"} {r.host})</option>
                  ))}
                </select>
              </Field>
            </div>

            {/* Plan preview */}
            {selectedPlan && (
              <div style={{ background: "rgba(37,99,235,0.06)", border: "1px solid rgba(37,99,235,0.18)", borderRadius: 8, padding: "0.75rem 1rem", display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                {[
                  ["Plan",     selectedPlan.name],
                  ["Price",    `Ksh ${selectedPlan.price}`],
                  ...(selectedPlan.speed_down ? [["Speed", `${selectedPlan.speed_down}↓ / ${selectedPlan.speed_up}↑ Mbps`]] : []),
                ].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: "0.62rem", color: "var(--isp-accent)", fontWeight: 700, textTransform: "uppercase" }}>{k}</div>
                    <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--isp-text)" }}>{v}</div>
                  </div>
                ))}
              </div>
            )}

            {/* ─── OPTIONAL ─── */}
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--isp-accent)", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid var(--isp-border-subtle)", paddingBottom: "0.375rem", marginTop: "0.25rem" }}>
              Optional
            </div>

            <Field label="Account Expiry Date" hint="Leave blank for no expiry">
              <input style={inp} type="date" value={form.expires_at}
                onChange={e => set("expires_at", e.target.value)} />
            </Field>

            {/* Password regenerate */}
            <button type="button"
              onClick={() => set("password", genPassword())}
              style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "rgba(255,255,255,0.04)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.5rem 0.875rem", color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit", alignSelf: "flex-start" }}>
              <RotateCcw size={12} /> Regenerate Password
            </button>

            {/* ─── CUSTOM FIELDS ─── */}
            <CustomFieldsSection
              fields={form.custom_fields}
              setFields={(fn) => setForm(f => ({ ...f, custom_fields: fn(f.custom_fields) }))}
            />

          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", gap: "0.75rem", padding: "1.125rem 1.5rem", borderTop: "1px solid var(--isp-border-subtle)", flexShrink: 0 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "0.7rem", borderRadius: 10, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer", fontFamily: "inherit" }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving || !form.name.trim()}
            style={{ flex: 2, padding: "0.7rem", borderRadius: 10, background: saving || !form.name.trim() ? "var(--isp-accent-border)" : "var(--isp-accent)", border: "none", color: "white", fontWeight: 700, fontSize: "0.875rem", cursor: saving || !form.name.trim() ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
            {saving ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <ShieldCheck size={15} />}
            {saving ? "Saving…" : isEdit ? "Save Changes" : `Add ${TYPE_META[form.type].label} Customer`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════ Delete Confirm ══════════════════════════ */
function DeleteModal({ customer, onClose, onConfirm, loading }: { customer: DbCustomer; onClose: () => void; onConfirm: () => void; loading: boolean }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 14, width: "100%", maxWidth: 420, padding: "1.75rem", boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(248,113,113,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <AlertTriangle size={18} style={{ color: "#f87171" }} />
          </div>
          <div>
            <div style={{ fontWeight: 700, color: "var(--isp-text)" }}>Delete Customer</div>
            <div style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)" }}>This action cannot be undone</div>
          </div>
        </div>
        <p style={{ fontSize: "0.875rem", color: "var(--isp-text-muted)", marginBottom: "1.25rem", lineHeight: 1.5 }}>
          Remove <strong style={{ color: "var(--isp-text)" }}>{customer.name ?? customer.username}</strong> from the system?
          This will delete their account and all associated RADIUS data.
        </p>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button onClick={onClose} style={{ flex: 1, padding: "0.65rem", borderRadius: 8, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", color: "var(--isp-text-muted)", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button onClick={onConfirm} disabled={loading}
            style={{ flex: 1, padding: "0.65rem", borderRadius: 8, background: loading ? "rgba(248,113,113,0.4)" : "rgba(239,68,68,0.9)", border: "none", color: "white", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.375rem" }}>
            {loading ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Trash size={14} />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════ Main Page ══════════════════════════ */
export default function Customers() {
  const qc = useQueryClient();
  const [showAdd,      setShowAdd]      = useState(false);
  const [editing,      setEditing]      = useState<DbCustomer | null>(null);
  const [deleting,     setDeleting]     = useState<DbCustomer | null>(null);
  const [searchTerm,   setSearchTerm]   = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType,   setFilterType]   = useState("all");
  const [toast,        setToast]        = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const { data: adminInfo } = useQuery({
    queryKey: ["admin_info", ADMIN_ID],
    queryFn: async () => {
      const { data } = await supabase.from("isp_admins").select("name").eq("id", ADMIN_ID).single();
      return data as { name: string } | null;
    },
  });
  const companyName = adminInfo?.name ?? "ISP";

  const { data: customers = [], isLoading, refetch } = useQuery({ queryKey: ["isp_customers", ADMIN_ID], queryFn: fetchCustomers, refetchInterval: 60_000 });
  const { data: plans    = [] } = useQuery({ queryKey: ["isp_plans_all", ADMIN_ID],  queryFn: fetchPlans   });
  const { data: routers  = [] } = useQuery({ queryKey: ["isp_routers", ADMIN_ID],    queryFn: fetchRouters });

  /* ─── Mutations ─── */
  const createMutation = useMutation({
    mutationFn: (form: NewCustomerForm) => createCustomer(form, plans),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["isp_customers"] });
      setShowAdd(false);
      setEditing(null);
      showToast("Customer created successfully");
    },
    onError: (e: Error) => showToast(`Error: ${e.message}`, false),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCustomer,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["isp_customers"] });
      setDeleting(null);
      showToast("Customer deleted");
    },
    onError: (e: Error) => showToast(`Error: ${e.message}`, false),
  });

  /* ─── Stats ─── */
  const total    = customers.length;
  const active   = customers.filter(c => c.status === "active").length;
  const expired  = customers.filter(c => c.status === "expired").length;
  const hotspots = customers.filter(c => c.type === "hotspot").length;
  const pppoes   = customers.filter(c => c.type === "pppoe").length;
  const statics  = customers.filter(c => c.type === "static").length;

  /* ─── Filter ─── */
  const planMap = useMemo(() => {
    const m: Record<number, string> = {};
    plans.forEach(p => { m[p.id] = p.name; });
    return m;
  }, [plans]);

  const filtered = useMemo(() => {
    return customers.filter(c => {
      const term = searchTerm.toLowerCase();
      const matchSearch = !searchTerm ||
        (c.name ?? "").toLowerCase().includes(term) ||
        (c.username ?? "").toLowerCase().includes(term) ||
        (c.pppoe_username ?? "").toLowerCase().includes(term) ||
        (c.phone ?? "").includes(searchTerm) ||
        (c.ip_address ?? "").includes(searchTerm) ||
        (c.email ?? "").toLowerCase().includes(term);
      const matchStatus = filterStatus === "all" || c.status === filterStatus;
      const matchType   = filterType   === "all" || c.type   === filterType;
      return matchSearch && matchStatus && matchType;
    });
  }, [customers, searchTerm, filterStatus, filterType]);

  return (
    <AdminLayout>
      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes slideIn { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
        .crow:hover { background: rgba(255,255,255,0.03) !important; }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 24, zIndex: 2000, display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.75rem 1.25rem", borderRadius: 10, background: toast.ok ? "rgba(34,197,94,0.15)" : "rgba(248,113,113,0.15)", border: `1px solid ${toast.ok ? "rgba(34,197,94,0.3)" : "rgba(248,113,113,0.3)"}`, color: toast.ok ? "#4ade80" : "#f87171", fontWeight: 600, fontSize: "0.875rem", boxShadow: "0 8px 32px rgba(0,0,0,0.3)", animation: "slideIn 0.2s ease" }}>
          {toast.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {toast.msg}
        </div>
      )}

      {/* Modals */}
      {(showAdd || editing) && (
        <CustomerModal
          plans={plans} routers={routers}
          editing={editing}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSave={form => createMutation.mutate(form)}
        />
      )}
      {deleting && (
        <DeleteModal
          customer={deleting}
          loading={deleteMutation.isPending}
          onClose={() => setDeleting(null)}
          onConfirm={() => deleteMutation.mutate(deleting)}
        />
      )}

      <div className="space-y-5">

        {/* ─── Header ─── */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Customers</h1>
            <p style={{ fontSize: "0.75rem", color: "var(--isp-text-muted)", marginTop: "0.2rem" }}>
              {isLoading ? "Loading…" : `${total} total · ${hotspots} hotspot · ${pppoes} PPPoE · ${statics} static`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => refetch()} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-semibold hover:bg-white/10 transition flex items-center gap-2 text-muted-foreground">
              <RefreshCw className="w-3.5 h-3.5" style={{ animation: isLoading ? "spin 1s linear infinite" : "none" }} />
            </button>
            <button className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-semibold hover:bg-white/10 transition flex items-center gap-2">
              <Download className="w-4 h-4" /> Export
            </button>
            <button onClick={() => setShowAdd(true)}
              className="px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2"
              style={{ background: "var(--isp-accent)", border: "none", color: "white", cursor: "pointer", boxShadow: "0 4px 12px var(--isp-accent-border)", borderRadius: 12 }}>
              <Plus className="w-4 h-4" /> Add Customer
            </button>
          </div>
        </div>

        {/* ─── Stat Cards ─── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Customers" value={String(total)}   color="cyan"  />
          <StatCard label="Active"          value={String(active)}  color="green" />
          <StatCard label="Expired"         value={String(expired)} color="red"   />
          <div style={{ borderRadius: 12, background: "var(--isp-section)", border: "1px solid var(--isp-border)", padding: "1rem 1.25rem" }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--isp-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>By Type</div>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              {([["hotspot", hotspots], ["pppoe", pppoes], ["static", statics]] as [CustomerType, number][]).map(([t, n]) => {
                const m = TYPE_META[t];
                return (
                  <div key={t} style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                    <span style={{ fontSize: "0.7rem", color: m.color }}>{m.icon}</span>
                    <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--isp-text)" }}>{n}</span>
                    <span style={{ fontSize: "0.7rem", color: "var(--isp-text-muted)" }}>{m.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ─── Sync to Router ─── */}
        <RouterSyncBar
          label="Sync Customers to Router"
          description="Push all hotspot customers as MikroTik hotspot users, and PPPoE customers as PPPoE secrets — direct via API, no terminal needed."
          icon={<UploadCloud size={18} />}
          endpoint="/api/admin/sync/users"
          color="var(--isp-accent)"
          buildPayload={() => ({
            users: customers.map(c => ({
              username:      c.username ?? "",
              password:      c.password ?? "",
              type:          c.type ?? "hotspot",
              plan_name:     c.plan_id ? (planMap[c.plan_id] ?? "default") : "default",
              pppoe_username: c.pppoe_username ?? undefined,
              mac_address:   c.mac_address ?? undefined,
              ip_address:    c.ip_address ?? undefined,
              comment:       `${companyName} customer #${c.id}`,
            })),
          })}
        />

        {/* ─── Table ─── */}
        <div style={{ background: "var(--isp-section)", border: "1px solid var(--isp-border)", borderRadius: 14, overflow: "hidden" }}>

          {/* Filter bar */}
          <div style={{ display: "flex", gap: "0.75rem", padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--isp-border-subtle)", flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ position: "relative", flex: "1 1 220px", minWidth: 200 }}>
              <Search size={14} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--isp-text-muted)" }} />
              <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search name, username, phone, IP…"
                style={{ width: "100%", boxSizing: "border-box", background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.5rem 0.75rem 0.5rem 2rem", color: "var(--isp-text)", fontSize: "0.8125rem", fontFamily: "inherit" }} />
            </div>
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
              style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.5rem 0.75rem", color: "var(--isp-text)", fontSize: "0.8125rem", fontFamily: "inherit" }}>
              <option value="all">All Types</option>
              <option value="hotspot">Hotspot</option>
              <option value="pppoe">PPPoE</option>
              <option value="static">Static</option>
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              style={{ background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "0.5rem 0.75rem", color: "var(--isp-text)", fontSize: "0.8125rem", fontFamily: "inherit" }}>
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--isp-border-subtle)" }}>
                  {["Customer", "Type", "Contact", "Plan", "IP / MAC", "Expires", "Status", "Actions"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "0.75rem 1.25rem", color: "var(--isp-text-sub)", fontWeight: 600, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={8} style={{ textAlign: "center", padding: "3.5rem", color: "var(--isp-text-muted)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Loading customers…
                    </div>
                  </td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: "center", padding: "4rem" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem" }}>
                      <div style={{ width: 56, height: 56, borderRadius: 14, background: "rgba(37,99,235,0.07)", border: "1.5px dashed rgba(37,99,235,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Users size={24} style={{ color: "var(--isp-accent)", opacity: 0.5 }} />
                      </div>
                      <div>
                        <p style={{ fontWeight: 600, color: "var(--isp-text)", marginBottom: "0.25rem" }}>
                          {customers.length === 0 ? "No customers yet" : "No customers match your search"}
                        </p>
                        <p style={{ fontSize: "0.8rem", color: "var(--isp-text-muted)" }}>
                          {customers.length === 0 ? "Click Add Customer to register your first client." : "Try changing your search or filters."}
                        </p>
                      </div>
                      {customers.length === 0 && (
                        <button onClick={() => setShowAdd(true)}
                          style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.5rem 1.25rem", borderRadius: 8, background: "var(--isp-accent)", border: "none", color: "white", fontWeight: 700, fontSize: "0.8125rem", cursor: "pointer", fontFamily: "inherit" }}>
                          <Plus size={14} /> Add Customer
                        </button>
                      )}
                    </div>
                  </td></tr>
                ) : filtered.map(c => {
                  const color = avatarColor(c.id);
                  const name  = c.name ?? c.username ?? c.pppoe_username ?? `#${c.id}`;
                  const typeM = TYPE_META[(c.type ?? "hotspot") as CustomerType] ?? TYPE_META.hotspot;
                  const statusVal = c.status ?? "active";
                  const loginId   = c.type === "pppoe" ? (c.pppoe_username ?? c.username) : c.username;
                  return (
                    <tr key={c.id} className="crow" style={{ borderBottom: "1px solid var(--isp-border-subtle)" }}>
                      {/* Customer */}
                      <td style={{ padding: "0.75rem 1.25rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                          <div style={{ width: 32, height: 32, borderRadius: "50%", background: `${color}22`, color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.7rem", flexShrink: 0 }}>
                            {initials(name)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: "var(--isp-text)" }}>{name}</div>
                            {loginId && loginId !== name && (
                              <div style={{ fontSize: "0.68rem", color: "var(--isp-text-muted)", fontFamily: "monospace" }}>{loginId}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* Type */}
                      <td style={{ padding: "0.75rem 1.25rem" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.7rem", padding: "0.2rem 0.6rem", borderRadius: 20, fontWeight: 700, background: typeM.bg, color: typeM.color }}>
                          {typeM.icon} {typeM.label}
                        </span>
                      </td>
                      {/* Contact */}
                      <td style={{ padding: "0.75rem 1.25rem", color: "var(--isp-text-muted)", fontSize: "0.78rem" }}>
                        <div>{c.phone ?? "—"}</div>
                        {c.email && <div style={{ fontSize: "0.68rem", opacity: 0.7 }}>{c.email}</div>}
                      </td>
                      {/* Plan */}
                      <td style={{ padding: "0.75rem 1.25rem", color: "var(--isp-text-muted)", fontSize: "0.8rem" }}>
                        {c.plan_id ? planMap[c.plan_id] ?? `#${c.plan_id}` : "—"}
                      </td>
                      {/* IP / MAC */}
                      <td style={{ padding: "0.75rem 1.25rem" }}>
                        {c.ip_address && <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--isp-accent)" }}>{c.ip_address}</div>}
                        {c.mac_address && <div style={{ fontFamily: "monospace", fontSize: "0.68rem", color: "var(--isp-text-muted)" }}>{c.mac_address}</div>}
                        {!c.ip_address && !c.mac_address && <span style={{ color: "var(--isp-text-sub)", fontSize: "0.75rem" }}>—</span>}
                      </td>
                      {/* Expires */}
                      <td style={{ padding: "0.75rem 1.25rem", color: "var(--isp-text-muted)", fontSize: "0.75rem" }}>
                        {fmtDate(c.expires_at)}
                      </td>
                      {/* Status */}
                      <td style={{ padding: "0.75rem 1.25rem" }}>
                        <Badge variant={statusVal === "active" ? "success" : statusVal === "expired" ? "danger" : "warning"}>
                          {statusVal}
                        </Badge>
                      </td>
                      {/* Actions */}
                      <td style={{ padding: "0.75rem 1.25rem" }}>
                        <div style={{ display: "flex", gap: "0.25rem" }}>
                          <button title="Edit" onClick={() => setEditing(c)}
                            style={{ padding: "0.35rem", borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "var(--isp-text-muted)", cursor: "pointer" }}>
                            <Edit size={13} />
                          </button>
                          <button title="Delete" onClick={() => setDeleting(c)}
                            style={{ padding: "0.35rem", borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "var(--isp-text-muted)", cursor: "pointer" }}>
                            <Trash size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!isLoading && customers.length > 0 && (
            <div style={{ padding: "0.625rem 1.25rem", borderTop: "1px solid var(--isp-border-subtle)", fontSize: "0.75rem", color: "var(--isp-text-muted)" }}>
              Showing {filtered.length} of {customers.length} customer{customers.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
