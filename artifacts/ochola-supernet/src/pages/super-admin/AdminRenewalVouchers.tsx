import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { Ban, Check, Copy, LoaderCircle, Ticket } from "lucide-react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";

type Account = { id: number; name: string; role: string };
type Redemption = {
  accountId: number; accountName: string; invoiceId: number; period: string;
  amountCovered: number; redeemedAt: string;
};
type Voucher = {
  id: number; benefit: string; targetAdminId: number | null; targetAdminName: string | null;
  createdBy: string; maxUses: number; redemptionCount: number; expiresAt: string | null;
  status: string; createdAt: string; revokedAt: string | null; revokedBy: string | null;
  redemptions: Redemption[];
};

const card: CSSProperties = {
  background: "var(--isp-card, #111b25)", border: "1px solid var(--isp-border, #293844)",
  borderRadius: 14, padding: 18, color: "var(--isp-text, #e8f0ef)",
};
const input: CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "var(--isp-inner-card, #0b141c)",
  border: "1px solid var(--isp-border, #293844)", borderRadius: 8, padding: "10px 11px",
  color: "var(--isp-text, #e8f0ef)", font: "inherit",
};
const button: CSSProperties = {
  border: 0, borderRadius: 8, padding: "10px 13px", fontWeight: 700,
  background: "#25a977", color: "#06150f", cursor: "pointer",
};

export default function AdminRenewalVouchers() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [targetAdminId, setTargetAdminId] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const token = () => localStorage.getItem("ochola_superadmin_token") || "";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const headers = { "x-sa-token": token() };
      const [accountResponse, voucherResponse] = await Promise.all([
        fetch("/api/super-admin/admin-renewal-vouchers/accounts", { headers }),
        fetch("/api/super-admin/admin-renewal-vouchers", { headers }),
      ]);
      const [accountData, voucherData] = await Promise.all([accountResponse.json(), voucherResponse.json()]);
      if (!accountResponse.ok || !accountData.ok) throw new Error(accountData.error || "Eligible accounts could not be loaded.");
      if (!voucherResponse.ok || !voucherData.ok) throw new Error(voucherData.error || "Renewal vouchers could not be loaded.");
      setAccounts(accountData.accounts ?? []);
      setVouchers(voucherData.vouchers ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Renewal vouchers could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setError(""); setGeneratedCode(""); setCopied(false);
    try {
      const response = await fetch("/api/super-admin/admin-renewal-vouchers", {
        method: "POST",
        headers: { "x-sa-token": token(), "Content-Type": "application/json" },
        body: JSON.stringify({
          targetAdminId: targetAdminId || null,
          maxUses: Number(maxUses),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Voucher could not be created.");
      setGeneratedCode(data.voucher.code);
      setTargetAdminId(""); setMaxUses("1"); setExpiresAt("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Voucher could not be created.");
    } finally { setSaving(false); }
  };

  const revoke = async (voucher: Voucher) => {
    if (!window.confirm("Revoke this voucher? It can no longer be redeemed.")) return;
    setError("");
    try {
      const response = await fetch(`/api/super-admin/admin-renewal-vouchers/${voucher.id}/revoke`, {
        method: "POST", headers: { "x-sa-token": token() },
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Voucher could not be revoked.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Voucher could not be revoked."); }
  };

  return <SuperAdminLayout>
    <main style={{ display: "grid", gap: 16, maxWidth: 1100, margin: "0 auto", padding: "20px 16px 40px" }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 24 }}>Admin Renewal Vouchers</h1>
        <p style={{ color: "var(--isp-muted, #94a3a7)", margin: "7px 0 0", fontSize: 14 }}>
          Vouchers cover one existing monthly platform renewal invoice. They do not apply to Hotspot or PPPoE customer vouchers.
        </p>
      </header>
      {error && <div role="alert" style={{ ...card, borderColor: "#b64c4c", color: "#ffb4aa" }}>{error}</div>}
      <section style={card}>
        <h2 style={{ margin: "0 0 12px", fontSize: 17 }}>Generate a voucher</h2>
        <form onSubmit={create} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, alignItems: "end" }}>
          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>Eligible admin account
            <select value={targetAdminId} onChange={e => setTargetAdminId(e.target.value)} style={input}>
              <option value="">Any eligible admin</option>
              {accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.role}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>Maximum uses
            <input style={input} type="number" min="1" max="10000" value={maxUses} onChange={e => setMaxUses(e.target.value)} required />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>Expiry date and time (optional)
            <input style={input} type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
          </label>
          <button style={button} type="submit" disabled={saving || loading}>{saving ? "Generating…" : "Generate secure code"}</button>
        </form>
        <p style={{ color: "var(--isp-muted, #94a3a7)", fontSize: 12, margin: "10px 0 0" }}>
          Each redemption settles one current monthly admin invoice at its existing fee. The original renewal fee remains recorded; voucher-covered amounts are excluded from cash revenue.
        </p>
        {generatedCode && <div role="status" style={{ marginTop: 14, padding: 12, borderRadius: 10, border: "1px solid #287e60", background: "rgba(37,169,119,.1)" }}>
          <strong>Copy this code now. It will not be shown again.</strong>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, alignItems: "center" }}>
            <code style={{ overflowWrap: "anywhere" }}>{generatedCode}</code>
            <button type="button" style={button} onClick={() => { void navigator.clipboard.writeText(generatedCode); setCopied(true); }}>
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy code"}
            </button>
          </div>
        </div>}
      </section>
      <section style={card}>
        <h2 style={{ margin: "0 0 12px", fontSize: 17 }}>Voucher register</h2>
        {loading ? <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--isp-muted)" }}><LoaderCircle size={16} className="animate-spin" /> Loading vouchers…</div>
          : vouchers.length === 0 ? <p style={{ color: "var(--isp-muted, #94a3a7)" }}>No admin renewal vouchers have been created.</p>
          : <div style={{ display: "grid", gap: 10 }}>
            {vouchers.map(voucher => <article key={voucher.id} style={{ border: "1px solid var(--isp-border, #293844)", borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, alignItems: "start" }}>
                <div>
                  <strong>{voucher.benefit}</strong>
                  <div style={{ color: "var(--isp-muted, #94a3a7)", fontSize: 12, marginTop: 4 }}>
                    {voucher.targetAdminName ? `For ${voucher.targetAdminName}` : "Any eligible admin"} · {voucher.redemptionCount}/{voucher.maxUses} uses ·
                    {" "}Expires {voucher.expiresAt ? new Date(voucher.expiresAt).toLocaleString() : "never"} · {voucher.status}
                  </div>
                  <div style={{ color: "var(--isp-muted, #94a3a7)", fontSize: 11, marginTop: 3 }}>Created by {voucher.createdBy} · {new Date(voucher.createdAt).toLocaleString()}</div>
                </div>
                {voucher.status === "active" && <button type="button" onClick={() => void revoke(voucher)} aria-label="Revoke voucher"
                  style={{ ...button, background: "#773d3d", color: "white", display: "inline-flex", gap: 6, alignItems: "center" }}><Ban size={14} /> Revoke</button>}
              </div>
              {voucher.redemptions.length > 0 && <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: "pointer" }}>Redemption history ({voucher.redemptions.length})</summary>
                <div style={{ display: "grid", gap: 6, marginTop: 8, fontSize: 12 }}>
                  {voucher.redemptions.map(row => <div key={row.invoiceId} style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
                    <span>{row.accountName} · {row.period} · KSh {row.amountCovered.toLocaleString("en-KE")}</span>
                    <time>{new Date(row.redeemedAt).toLocaleString()}</time>
                  </div>)}
                </div>
              </details>}
            </article>)}
          </div>}
      </section>
    </main>
  </SuperAdminLayout>;
}
