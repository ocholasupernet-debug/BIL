import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { adminApiHeaders } from "@/lib/admin-router-context";
import { AlertCircle, Check, Coins, Gift, Loader2, RefreshCw, Search, ShieldCheck, Users } from "lucide-react";

type LoyaltyPlan = {
  id: number;
  name: string;
  type: string;
  price: number;
  pointsAwarded: number | null;
  redemptionPoints: number | null;
};
type LoyaltyUser = {
  phone: string;
  name: string;
  points: number;
  accountCount: number;
  status: string;
  lastActivityAt: string | null;
};
type LoyaltyContext = {
  ok: true;
  settings: { kesPerPoint: number | null };
  plans: LoyaltyPlan[];
  users: LoyaltyUser[];
};

async function loyaltyApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(adminApiHeaders());
  if (init.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const payload = await response.json().catch(() => null) as ({ error?: string } & T) | null;
  if (!response.ok || (payload && "ok" in payload && payload.ok === false)) {
    throw new Error(payload?.error || `Loyalty request failed (${response.status}).`);
  }
  return payload as T;
}

const inputStyle: React.CSSProperties = {
  width: "100%", minHeight: 42, padding: "0.65rem 0.75rem", border: "1px solid var(--isp-border)",
  borderRadius: 9, background: "var(--isp-bg)", color: "var(--isp-text)", font: "inherit",
};
const cardStyle: React.CSSProperties = {
  border: "1px solid var(--isp-border)", borderRadius: 14, background: "var(--isp-card)",
  padding: "1.15rem", boxShadow: "var(--shadow-card)",
};
const fmt = (value: number) => new Intl.NumberFormat("en-KE", { maximumFractionDigits: 2 }).format(value);

export default function LoyaltyPoints() {
  const client = useQueryClient();
  const [ratioDraft, setRatioDraft] = useState("");
  const [ratioEdited, setRatioEdited] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const query = useQuery({
    queryKey: ["admin-loyalty-context"],
    queryFn: () => loyaltyApi<LoyaltyContext>("/api/admin/loyalty/context"),
  });
  const context = query.data;
  const saveRatio = useMutation({
    mutationFn: (kesPerPoint: number | null) => loyaltyApi("/api/admin/loyalty/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kesPerPoint }),
    }),
    onSuccess: async () => {
      setNotice("Earning ratio saved.");
      setRatioEdited(false);
      await client.invalidateQueries({ queryKey: ["admin-loyalty-context"] });
    },
    onError: error => setNotice(error instanceof Error ? error.message : "The ratio could not be saved."),
  });
  const savePlan = useMutation({
    mutationFn: ({ id, pointsAwarded, redemptionPoints }: { id: number; pointsAwarded: number | null; redemptionPoints: number | null }) =>
      loyaltyApi(`/api/admin/loyalty/plans/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pointsAwarded, redemptionPoints }),
      }),
    onSuccess: async () => {
      setNotice("Plan loyalty rules saved.");
      await client.invalidateQueries({ queryKey: ["admin-loyalty-context"] });
    },
    onError: error => setNotice(error instanceof Error ? error.message : "Plan rules could not be saved."),
  });
  const users = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (context?.users ?? []).filter(user => !needle || `${user.name} ${user.phone}`.toLowerCase().includes(needle));
  }, [context?.users, search]);
  const ratio = context?.settings.kesPerPoint;

  return (
    <AdminLayout>
      <main style={{ maxWidth: 1180, margin: "0 auto", padding: "1.4rem 1rem 3.5rem", color: "var(--isp-text)" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 24 }}>
          <div style={{ display: "flex", gap: 13 }}>
            <div style={{ width: 46, height: 46, display: "grid", placeItems: "center", flexShrink: 0, borderRadius: 13, background: "color-mix(in srgb, var(--isp-green) 14%, var(--isp-card))", color: "var(--isp-green)" }}>
              <Coins size={23} />
            </div>
            <div>
              <div style={{ color: "var(--isp-text-sub)", fontSize: 11, fontWeight: 800, letterSpacing: ".13em", textTransform: "uppercase", marginBottom: 5 }}>Billing / Customer rewards</div>
              <h1 style={{ fontSize: "1.55rem", fontWeight: 800, margin: 0 }}>Loyalty points</h1>
              <p style={{ color: "var(--isp-text-muted)", margin: "6px 0 0", lineHeight: 1.5, maxWidth: 650 }}>Set how Hotspot customers earn points and which plans can be purchased with a full points redemption.</p>
            </div>
          </div>
          <button type="button" onClick={() => void query.refetch()} aria-label="Refresh loyalty data" style={{ ...inputStyle, width: 42, minHeight: 42, padding: 0, display: "grid", placeItems: "center", cursor: "pointer" }}><RefreshCw size={16} /></button>
        </header>

        {notice && <div role="status" style={{ display: "flex", gap: 9, alignItems: "center", padding: "11px 13px", borderRadius: 10, marginBottom: 16, border: "1px solid var(--isp-border)", background: "var(--isp-card)", color: notice.toLowerCase().includes("could not") || notice.toLowerCase().includes("failed") ? "var(--isp-danger, #b5473c)" : "var(--isp-green)" }}>
          {notice.toLowerCase().includes("could not") || notice.toLowerCase().includes("failed") ? <AlertCircle size={17} /> : <Check size={17} />}{notice}
          <button type="button" onClick={() => setNotice("")} style={{ marginLeft: "auto", border: 0, background: "transparent", color: "inherit", cursor: "pointer" }}>Dismiss</button>
        </div>}

        {query.isLoading ? (
          <div aria-label="Loading loyalty settings" style={{ display: "grid", gap: 14 }}>
            {[110, 240, 280].map(height => <div key={height} style={{ height, borderRadius: 14, background: "linear-gradient(90deg, var(--isp-card), var(--isp-inner-card), var(--isp-card))", border: "1px solid var(--isp-border)" }} />)}
          </div>
        ) : query.error ? (
          <section style={{ ...cardStyle, textAlign: "center", padding: "3rem 1rem" }} role="alert">
            <AlertCircle size={25} color="var(--isp-danger, #b5473c)" />
            <h2 style={{ margin: "10px 0 5px", fontSize: "1rem" }}>Loyalty settings unavailable</h2>
            <p style={{ color: "var(--isp-text-muted)" }}>{query.error instanceof Error ? query.error.message : "Could not load tenant loyalty data."}</p>
            <button type="button" className="btn btn-primary" onClick={() => void query.refetch()}>Try again</button>
          </section>
        ) : context ? (
          <>
            <section className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(260px,.9fr)]" style={{ marginBottom: 18 }}>
              <div style={{ ...cardStyle, background: "linear-gradient(125deg, color-mix(in srgb, var(--isp-green) 11%, var(--isp-card)), var(--isp-card) 65%)" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 15 }}><Coins size={19} color="var(--isp-green)" /><h2 style={{ fontSize: "1rem", margin: 0 }}>Spend-based earning</h2></div>
                <p style={{ color: "var(--isp-text-muted)", fontSize: ".85rem", lineHeight: 1.55, margin: "0 0 15px" }}>One point is earned for each configured amount spent on an eligible Hotspot purchase. Partial points are kept and added to the customer’s balance. A plan-specific award overrides this ratio.</p>
                <form onSubmit={event => { event.preventDefault(); const parsed = Number(ratioDraft); if (ratioDraft.trim() && (!Number.isFinite(parsed) || parsed < 0)) { setNotice("Enter a valid KSh amount, or leave the ratio disabled."); return; } saveRatio.mutate(ratioDraft.trim() && parsed > 0 ? parsed : null); }} style={{ display: "flex", alignItems: "end", gap: 10, flexWrap: "wrap" }}>
                  <label style={{ display: "grid", gap: 6, fontSize: ".77rem", fontWeight: 700, flex: "1 1 190px" }}>KSh spent per point
                    <input type="number" min="0.01" step="0.01" value={ratioEdited ? ratioDraft : ratio ? String(ratio) : ""} placeholder="Disabled" onChange={event => { setRatioDraft(event.target.value); setRatioEdited(true); }} style={inputStyle} />
                  </label>
                  <button type="submit" disabled={saveRatio.isPending} className="btn btn-primary" style={{ minHeight: 42 }}>{saveRatio.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save ratio</button>
                  {ratio && <button type="button" className="btn btn-ghost" onClick={() => { setRatioDraft(""); setRatioEdited(false); saveRatio.mutate(null); }}>Disable</button>}
                </form>
                <div style={{ fontSize: ".75rem", color: "var(--isp-text-sub)", marginTop: 10 }}>{ratio ? `Current: KSh ${fmt(ratio)} spent earns 1 point.` : "Spend-based earning is currently disabled."} For example, KSh 10 per point earns 0.5 points on a KSh 5 plan. Points are added after payment is confirmed and the Hotspot account is saved. Plan-specific awards override the ratio.</div>
              </div>
              <div style={{ ...cardStyle, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center", background: "color-mix(in srgb, var(--isp-accent) 12%, var(--isp-card))", color: "var(--isp-accent)" }}><Users size={18} /></div><span style={{ fontWeight: 750 }}>Customer balances</span></div>
                <div style={{ marginTop: 15, display: "flex", alignItems: "baseline", gap: 8 }}><strong style={{ fontSize: "2rem", letterSpacing: "-.04em" }}>{fmt(context.users.length)}</strong><span style={{ fontSize: ".82rem", color: "var(--isp-text-muted)" }}>Hotspot phone accounts</span></div>
                <div style={{ borderTop: "1px solid var(--isp-border)", marginTop: 15, paddingTop: 13, color: "var(--isp-text-muted)", fontSize: ".79rem", display: "flex", justifyContent: "space-between" }}><span>Points held across accounts</span><strong style={{ color: "var(--isp-text)" }}>{fmt(context.users.reduce((sum, user) => sum + (Number(user.points) || 0), 0))}</strong></div>
              </div>
            </section>

            <section style={{ ...cardStyle, marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}><Gift size={19} color="var(--isp-green)" /><h2 style={{ margin: 0, fontSize: "1rem" }}>Hotspot plan rules</h2></div>
              <p style={{ color: "var(--isp-text-muted)", fontSize: ".82rem", margin: "0 0 16px", lineHeight: 1.5 }}>Leave award blank to use the spend ratio. Plan awards may be fractional; enter 0 to stop earning. Redemption defaults to the plan price in whole points (KSh 5 = 5 points); enter another cost to override it, or 0 to disable point redemption for that plan.</p>
              {context.plans.length === 0 ? <div style={{ padding: "1.5rem", textAlign: "center", border: "1px dashed var(--isp-border)", borderRadius: 10, color: "var(--isp-text-muted)" }}>No Hotspot plans are available to configure.</div> : (
                <div style={{ display: "grid", gap: 9 }}>
                  {context.plans.map(plan => <PlanRuleRow key={plan.id} plan={plan} busy={savePlan.isPending} onSave={(values) => savePlan.mutate({ id: plan.id, ...values })} />)}
                </div>
              )}
            </section>

            <section style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
                <div><div style={{ display: "flex", gap: 9, alignItems: "center" }}><Users size={18} color="var(--isp-accent)" /><h2 style={{ margin: 0, fontSize: "1rem" }}>Customer point balances</h2></div><p style={{ color: "var(--isp-text-muted)", fontSize: ".78rem", margin: "5px 0 0" }}>Balances and Hotspot account counts across this tenant.</p></div>
                <label style={{ position: "relative", width: "min(100%, 270px)" }}><Search size={15} style={{ position: "absolute", left: 11, top: 13, color: "var(--isp-text-sub)" }} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find name or phone" aria-label="Search customers" style={{ ...inputStyle, paddingLeft: 34 }} /></label>
              </div>
              {users.length === 0 ? <div style={{ padding: "2rem 1rem", textAlign: "center", border: "1px dashed var(--isp-border)", borderRadius: 10, color: "var(--isp-text-muted)" }}>{search ? "No customers match that search." : "Customer balances will appear here as customers earn points."}</div> : (
                <div style={{ overflowX: "auto" }}><table className="isp-table" style={{ minWidth: 620 }}><thead><tr><th style={{ textAlign: "left" }}>Customer</th><th style={{ textAlign: "right" }}>Points</th><th style={{ textAlign: "right" }}>Hotspot accounts</th><th style={{ textAlign: "left" }}>Status</th><th style={{ textAlign: "right" }}>Last activity</th></tr></thead>
                  <tbody>{users.map(user => <tr key={user.phone}><td><div style={{ fontWeight: 700 }}>{user.name || "Customer"}</div><div style={{ color: "var(--isp-text-muted)", fontSize: ".77rem", marginTop: 2 }}>{user.phone}</div></td><td style={{ textAlign: "right" }}><strong style={{ color: "var(--isp-green)" }}>{fmt(Number(user.points) || 0)}</strong></td><td style={{ textAlign: "right" }}>{fmt(Number(user.accountCount) || 0)}</td><td><span className={`isp-badge ${user.status.toLowerCase() === "active" ? "isp-badge-green" : "isp-badge-gray"}`}>{user.status || "Unknown"}</span></td><td style={{ textAlign: "right", color: "var(--isp-text-muted)", fontSize: ".79rem" }}>{user.lastActivityAt ? new Date(user.lastActivityAt).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "—"}</td></tr>)}</tbody>
                </table></div>
              )}
            </section>
          </>
        ) : null}
        <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--isp-text-sub)", fontSize: ".74rem", marginTop: 14 }}><ShieldCheck size={14} /> Loyalty changes apply to this tenant’s Hotspot checkout. Fractional points carry forward until enough are earned to redeem a plan.</div>
      </main>
    </AdminLayout>
  );
}

function PlanRuleRow({ plan, busy, onSave }: { plan: LoyaltyPlan; busy: boolean; onSave: (values: { pointsAwarded: number | null; redemptionPoints: number | null }) => void }) {
  const [award, setAward] = useState(plan.pointsAwarded == null ? "" : String(plan.pointsAwarded));
  const [redemption, setRedemption] = useState(plan.redemptionPoints == null ? "" : String(plan.redemptionPoints));
  const changed = award !== (plan.pointsAwarded == null ? "" : String(plan.pointsAwarded)) || redemption !== (plan.redemptionPoints == null ? "" : String(plan.redemptionPoints));
  return <form onSubmit={event => {
    event.preventDefault();
    const validAward = !award.trim() || (
      Number.isFinite(Number(award))
      && Number(award) >= 0
      && Number(award) <= 2_147_483_647
      && Math.abs(Number(award) * 100 - Math.round(Number(award) * 100)) <= 1e-7
    );
    const validRedemption = !redemption.trim() || (
      Number.isSafeInteger(Number(redemption))
      && Number(redemption) >= 0
      && Number(redemption) <= 2_147_483_647
    );
    const valid = validAward && validRedemption;
    if (!valid) return;
    onSave({ pointsAwarded: award.trim() ? Number(award) : null, redemptionPoints: redemption.trim() ? Number(redemption) : null });
  }} className="loyalty-plan-rule" style={{ display: "grid", gridTemplateColumns: "minmax(150px,1fr) minmax(120px,.7fr) minmax(120px,.7fr) auto", alignItems: "center", gap: 10, padding: "11px 12px", border: "1px solid var(--isp-border)", borderRadius: 10 }}>
    <div style={{ minWidth: 0 }}><strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: ".86rem" }}>{plan.name}</strong><span style={{ display: "block", color: "var(--isp-text-muted)", fontSize: ".74rem", marginTop: 3 }}>KSh {fmt(Number(plan.price) || 0)} · {plan.type}</span></div>
    <label style={{ fontSize: ".69rem", fontWeight: 700, color: "var(--isp-text-muted)" }}>Award points<input type="number" min="0" max="2147483647" step="0.01" value={award} onChange={event => setAward(event.target.value)} placeholder="Use ratio" style={{ ...inputStyle, marginTop: 5 }} /></label>
     <label style={{ fontSize: ".69rem", fontWeight: 700, color: "var(--isp-text-muted)" }}>Full redemption cost<input type="number" min="0" step="1" value={redemption} onChange={event => setRedemption(event.target.value)} placeholder={`Auto: ${Math.ceil(Number(plan.price) || 0)} points`} style={{ ...inputStyle, marginTop: 5 }} /></label>
    <button type="submit" disabled={busy || !changed} className="btn btn-ghost" style={{ minHeight: 40, justifyContent: "center", opacity: changed ? 1 : .55 }}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Save</button>
  </form>;
}
