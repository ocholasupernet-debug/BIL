import React, { useState } from "react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { Zap, Plus, Save, CheckCircle2, Play, Pause, Trash2, Clock, RefreshCw, Database, Mail, MessageSquare, X } from "lucide-react";

const C = { card: "rgba(255,255,255,0.04)", border: "rgba(99,102,241,0.15)", accent: "#6366f1", text: "#e2e8f0", muted: "#64748b", sub: "#94a3b8" };
const inp: React.CSSProperties = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 8, padding: "9px 14px", color: "#e2e8f0", fontSize: "0.82rem", width: "100%", boxSizing: "border-box", fontFamily: "inherit" };

interface Task { id: number; name: string; trigger: string; action: string; schedule: string; enabled: boolean; lastRun: string; status: "success" | "failed" | "pending"; }

const INIT_TASKS: Task[] = [
  { id: 1, name: "Daily Database Backup",       trigger: "Scheduled", action: "Backup DB to S3",          schedule: "0 2 * * *",      enabled: true,  lastRun: "Today 02:00",    status: "success" },
  { id: 2, name: "Auto-Suspend Overdue ISPs",   trigger: "Scheduled", action: "Suspend overdue accounts",  schedule: "0 8 * * *",      enabled: true,  lastRun: "Today 08:00",    status: "success" },
  { id: 3, name: "Send Payment Reminders",      trigger: "Scheduled", action: "Send SMS & email reminders", schedule: "0 9 * * *",     enabled: true,  lastRun: "Today 09:00",    status: "success" },
  { id: 4, name: "Router Status Sync",          trigger: "Scheduled", action: "Ping all routers",           schedule: "*/5 * * * *",    enabled: true,  lastRun: "5 min ago",      status: "success" },
  { id: 5, name: "Weekly Report Email",         trigger: "Scheduled", action: "Send ISP report email",      schedule: "0 8 * * 1",      enabled: true,  lastRun: "Mar 24 08:00",   status: "success" },
  { id: 6, name: "Voucher Expiry Cleanup",      trigger: "Scheduled", action: "Delete expired vouchers",    schedule: "0 3 * * *",      enabled: false, lastRun: "Mar 25 03:00",   status: "success" },
  { id: 7, name: "Log Rotation",               trigger: "Scheduled", action: "Archive logs older 90 days", schedule: "0 1 1 * *",      enabled: true,  lastRun: "Mar 1 01:00",    status: "success" },
  { id: 8, name: "Failed RADIUS Alert",         trigger: "Event",     action: "Alert via Slack + SMS",      schedule: "On RADIUS down", enabled: true,  lastRun: "Yesterday 15:30",status: "failed"  },
];

function StatusChip({ status }: { status: Task["status"] }) {
  const map = { success: { bg: "rgba(74,222,128,0.1)", color: "#4ade80", label: "Success" }, failed: { bg: "rgba(248,113,113,0.1)", color: "#f87171", label: "Failed" }, pending: { bg: "rgba(251,191,36,0.1)", color: "#fbbf24", label: "Pending" } };
  const s = map[status];
  return <span style={{ padding: "2px 8px", borderRadius: 8, fontSize: "0.67rem", fontWeight: 700, background: s.bg, color: s.color }}>{s.label}</span>;
}

export default function SuperAdminAutomation() {
  const [tasks, setTasks] = useState(INIT_TASKS);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", trigger: "Scheduled", action: "Backup DB", schedule: "0 2 * * *" });
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };
  const toggleTask = (id: number) => { setTasks(t => t.map(task => task.id === id ? { ...task, enabled: !task.enabled } : task)); showToast("Task updated"); };
  const deleteTask = (id: number) => { setTasks(t => t.filter(task => task.id !== id)); showToast("Task deleted"); };
  const addTask = () => {
    if (!form.name) return;
    setTasks(t => [...t, { id: Date.now(), ...form, enabled: true, lastRun: "Never", status: "pending" }]);
    setShowAdd(false); setForm({ name: "", trigger: "Scheduled", action: "Backup DB", schedule: "0 2 * * *" });
    showToast("Automation task added");
  };

  const actionIcons: Record<string, React.ElementType> = { "Backup": Database, "Send": Mail, "Alert": MessageSquare, "Ping": RefreshCw, "Delete": Trash2, "Archive": Database };
  const getIcon = (action: string) => {
    const key = Object.keys(actionIcons).find(k => action.startsWith(k));
    return key ? actionIcons[key] : Zap;
  };

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 1000 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", margin: 0 }}>Automation</h1>
            <p style={{ color: C.muted, margin: "4px 0 0", fontSize: "0.82rem" }}>Scheduled tasks and event-driven automation rules.</p>
          </div>
          <button onClick={() => setShowAdd(true)} style={{ display: "flex", alignItems: "center", gap: 8, background: C.accent, border: "none", borderRadius: 10, padding: "10px 18px", color: "white", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}>
            <Plus size={15} /> Add Task
          </button>
        </div>

        {/* Summary */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
          {[
            { label: "Total Tasks", value: tasks.length, color: "#6366f1" },
            { label: "Active", value: tasks.filter(t => t.enabled).length, color: "#4ade80" },
            { label: "Paused", value: tasks.filter(t => !t.enabled).length, color: "#fbbf24" },
            { label: "Last Failed", value: tasks.filter(t => t.status === "failed").length, color: "#f87171" },
          ].map(s => (
            <div key={s.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px" }}>
              <p style={{ fontSize: "0.65rem", color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>{s.label}</p>
              <p style={{ fontSize: "1.5rem", fontWeight: 800, color: s.color, margin: "4px 0 0" }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Tasks List */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {tasks.map(task => {
            const Icon = getIcon(task.action);
            return (
              <div key={task.id} style={{ background: C.card, border: `1px solid ${task.enabled ? "rgba(99,102,241,0.2)" : C.border}`, borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 38, height: 38, borderRadius: 9, background: task.enabled ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon size={16} color={task.enabled ? C.accent : C.muted} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, color: task.enabled ? "white" : C.muted, fontSize: "0.85rem" }}>{task.name}</span>
                    <span style={{ fontSize: "0.65rem", background: "rgba(99,102,241,0.1)", color: C.accent, padding: "1px 7px", borderRadius: 8, fontWeight: 700 }}>{task.trigger}</span>
                    <StatusChip status={task.status} />
                  </div>
                  <div style={{ display: "flex", gap: 16, marginTop: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.72rem", color: C.muted, display: "flex", alignItems: "center", gap: 4 }}>
                      <Clock size={10} /> {task.schedule}
                    </span>
                    <span style={{ fontSize: "0.72rem", color: C.sub }}>Action: {task.action}</span>
                    <span style={{ fontSize: "0.72rem", color: C.muted }}>Last: {task.lastRun}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button onClick={() => toggleTask(task.id)} style={{ background: task.enabled ? "rgba(251,191,36,0.1)" : "rgba(74,222,128,0.1)", border: `1px solid ${task.enabled ? "rgba(251,191,36,0.2)" : "rgba(74,222,128,0.2)"}`, borderRadius: 8, padding: "6px 12px", color: task.enabled ? "#fbbf24" : "#4ade80", cursor: "pointer", fontSize: "0.72rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                    {task.enabled ? <><Pause size={11} /> Pause</> : <><Play size={11} /> Enable</>}
                  </button>
                  <button onClick={() => deleteTask(task.id)} style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 8, padding: "6px 12px", color: "#f87171", cursor: "pointer", fontSize: "0.72rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                    <Trash2 size={11} /> Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add modal */}
        {showAdd && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#0f1629", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 16, width: "100%", maxWidth: 480 }}>
              <div style={{ padding: "18px 24px", borderBottom: "1px solid rgba(99,102,241,0.15)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, color: "white" }}>New Automation Task</span>
                <button onClick={() => setShowAdd(false)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={18} /></button>
              </div>
              <div style={{ padding: 24 }}>
                {[
                  { label: "Task Name", k: "name" as const, type: "text", placeholder: "Daily Backup" },
                  { label: "Schedule (Cron)", k: "schedule" as const, type: "text", placeholder: "0 2 * * *" },
                ].map(f => (
                  <div key={f.k} style={{ marginBottom: 14 }}>
                    <label style={{ display: "block", fontSize: "0.68rem", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>{f.label}</label>
                    <input style={inp} type={f.type} value={form[f.k]} onChange={e => setForm(x => ({ ...x, [f.k]: e.target.value }))} placeholder={f.placeholder} />
                  </div>
                ))}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: "0.68rem", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Trigger</label>
                  <select style={inp} value={form.trigger} onChange={e => setForm(x => ({ ...x, trigger: e.target.value }))}>
                    <option value="Scheduled">Scheduled (Cron)</option>
                    <option value="Event">Event-Driven</option>
                    <option value="Webhook">Webhook</option>
                  </select>
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: "block", fontSize: "0.68rem", fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Action</label>
                  <select style={inp} value={form.action} onChange={e => setForm(x => ({ ...x, action: e.target.value }))}>
                    <option>Backup DB to S3</option>
                    <option>Suspend overdue accounts</option>
                    <option>Send SMS & email reminders</option>
                    <option>Ping all routers</option>
                    <option>Send ISP report email</option>
                    <option>Delete expired vouchers</option>
                    <option>Archive logs</option>
                    <option>Alert via SMS</option>
                  </select>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button onClick={() => setShowAdd(false)} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "9px 18px", color: C.sub, cursor: "pointer", fontWeight: 600, fontSize: "0.82rem" }}>Cancel</button>
                  <button onClick={addTask} disabled={!form.name} style={{ background: C.accent, border: "none", borderRadius: 8, padding: "9px 20px", color: "white", cursor: "pointer", fontWeight: 700, fontSize: "0.82rem", opacity: !form.name ? 0.5 : 1 }}>Create Task</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {toast && (
          <div style={{ position: "fixed", bottom: 24, right: 24, background: "#022c22", border: "1px solid #4ade80", borderRadius: 10, padding: "12px 20px", color: "#4ade80", fontWeight: 600, fontSize: "0.82rem", zIndex: 300, display: "flex", alignItems: "center", gap: 8 }}>
            <CheckCircle2 size={14} /> {toast}
          </div>
        )}
      </div>
    </SuperAdminLayout>
  );
}
