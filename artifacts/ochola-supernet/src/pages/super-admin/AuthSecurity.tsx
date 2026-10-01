import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Save, ShieldCheck } from "lucide-react";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";

type Role = "isp_admin" | "reseller";
type OtpChannel = "whatsapp" | "sms" | "email";
type Policy = {
  otp: { allEnabled: boolean; channels: Record<OtpChannel, boolean> };
  passwordReauth: Record<Role, Record<string, boolean>>;
};
type CatalogPage = { key: string; label: string; description?: string };
type CatalogSection = { label: string; pages: CatalogPage[] };

const EMPTY_POLICY: Policy = {
  otp: { allEnabled: false, channels: { whatsapp: false, sms: false, email: false } },
  passwordReauth: { isp_admin: {}, reseller: {} },
};

function tokenHeaders(json = false): HeadersInit {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    "x-sa-token": localStorage.getItem("ochola_superadmin_token") || "",
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || "The security settings could not be loaded.");
  return data as T;
}

export default function SuperAdminAuthSecurity() {
  const [policy, setPolicy] = useState<Policy>(EMPTY_POLICY);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const query = useQuery({
    queryKey: ["super-admin-auth-security"],
    queryFn: async () => parseResponse<{ policy: Policy; catalog: CatalogSection[] }>(
      await fetch("/api/super-admin/auth-security-policy", { headers: tokenHeaders() }),
    ),
  });

  useEffect(() => {
    if (query.data?.policy) setPolicy(query.data.policy);
  }, [query.data]);

  const catalog = query.data?.catalog ?? [];
  const setOtp = (change: { allEnabled?: boolean; channels?: Partial<Record<OtpChannel, boolean>> }) => setPolicy(current => ({
    ...current,
    otp: { ...current.otp, ...change, channels: { ...current.otp.channels, ...(change.channels ?? {}) } },
  }));
  const setPagePolicy = (role: Role, key: string, enabled: boolean) => setPolicy(current => ({
    ...current,
    passwordReauth: {
      ...current.passwordReauth,
      [role]: { ...current.passwordReauth[role], [key]: enabled },
    },
  }));

  const save = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const data = await parseResponse<{ policy: Policy }>(
        await fetch("/api/super-admin/auth-security-policy", {
          method: "PUT",
          headers: tokenHeaders(true),
          body: JSON.stringify(policy),
        }),
      );
      setPolicy(data.policy);
      setMessage("Security settings saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The security settings could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SuperAdminLayout>
      <div style={{ maxWidth: 1180, display: "grid", gap: 22 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <ShieldCheck size={26} color="var(--isp-accent)" />
          <div>
            <h1 style={{ color: "var(--isp-text)", fontSize: 24, margin: 0 }}>OTP and password security</h1>
            <p style={{ color: "var(--isp-text-muted)", margin: "5px 0 0", fontSize: 14 }}>Control verification channels and require a current-password check for selected pages.</p>
          </div>
        </header>

        {query.isLoading && <p style={{ color: "var(--isp-text-muted)" }}>Loading security policy…</p>}
        {query.error && <p role="alert" style={{ color: "#dc2626" }}>{(query.error as Error).message}</p>}

        <section style={{ background: "var(--isp-card)", border: "1px solid var(--isp-border)", borderRadius: 14, padding: 20 }}>
          <h2 style={{ color: "var(--isp-text)", fontSize: 17, marginTop: 0 }}>One-time password channels</h2>
          <label style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--isp-text)", fontWeight: 700, margin: "12px 0 18px" }}>
            <input type="checkbox" checked={policy.otp.allEnabled} onChange={event => setOtp({ allEnabled: event.target.checked })} />
            Enable OTP globally
          </label>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            {(["whatsapp", "sms"] as OtpChannel[]).map(channel => (
              <label key={channel} style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--isp-text)", textTransform: "capitalize" }}>
                <input type="checkbox" checked={policy.otp.channels[channel]} onChange={event => setOtp({ channels: { [channel]: event.target.checked } })} />
                {channel}
              </label>
            ))}
            <label style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--isp-text-muted)" }}>
              <input type="checkbox" checked={false} disabled />
              Email (not available yet)
            </label>
          </div>
          <p style={{ color: "var(--isp-text-muted)", fontSize: 13, marginBottom: 0 }}>OTP is off by default. Both the global switch and a channel switch must be enabled. This only controls OTP verification, not ordinary SMS or WhatsApp support messages. Password recovery by OTP is disabled; only Super Admin can reset account passwords.</p>
        </section>

        <section style={{ background: "var(--isp-card)", border: "1px solid var(--isp-border)", borderRadius: 14, padding: 20 }}>
          <h2 style={{ color: "var(--isp-text)", fontSize: 17, marginTop: 0 }}>Require password again by role and page</h2>
          <p style={{ color: "var(--isp-text-muted)", fontSize: 13 }}>When enabled, ISP admins and resellers must re-enter their current password before the selected page can load.</p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 620, color: "var(--isp-text)" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--isp-border)" }}>Page</th>
                  <th style={{ padding: 8, borderBottom: "1px solid var(--isp-border)" }}>ISP admin</th>
                  <th style={{ padding: 8, borderBottom: "1px solid var(--isp-border)" }}>Reseller</th>
                </tr>
              </thead>
              <tbody>
                {catalog.flatMap(section => [
                  <tr key={`section-${section.label}`}>
                    <th colSpan={3} style={{ textAlign: "left", padding: "14px 8px 6px", color: "var(--isp-accent)", fontSize: 12, textTransform: "uppercase" }}>{section.label}</th>
                  </tr>,
                  ...section.pages.filter(page => page.key !== "overview").map(page => (
                    <tr key={page.key}>
                      <td style={{ padding: "9px 8px", borderBottom: "1px solid var(--isp-border)" }}>
                        <strong>{page.label}</strong>
                        {page.description && <div style={{ color: "var(--isp-text-muted)", fontSize: 12, marginTop: 3 }}>{page.description}</div>}
                      </td>
                      {(["isp_admin", "reseller"] as Role[]).map(role => (
                        <td key={role} style={{ textAlign: "center", borderBottom: "1px solid var(--isp-border)" }}>
                          <input aria-label={`${role === "isp_admin" ? "ISP admin" : "Reseller"}: ${page.label}`} type="checkbox" checked={policy.passwordReauth[role]?.[page.key] === true} onChange={event => setPagePolicy(role, page.key, event.target.checked)} />
                        </td>
                      ))}
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        </section>

        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
          {error && <p role="alert" style={{ color: "#dc2626", margin: 0 }}>{error}</p>}
          {message && <p role="status" style={{ color: "#15803d", margin: 0 }}>{message}</p>}
          <button type="button" disabled={saving || query.isLoading || !!query.error} onClick={() => void save()} style={{ border: 0, borderRadius: 9, padding: "10px 16px", background: "var(--isp-accent)", color: "white", fontWeight: 700, display: "inline-flex", gap: 8, alignItems: "center", cursor: "pointer", opacity: saving ? 0.65 : 1 }}>
            {saving ? <Loader2 size={16} /> : <Save size={16} />} Save security settings
          </button>
        </div>
      </div>
    </SuperAdminLayout>
  );
}