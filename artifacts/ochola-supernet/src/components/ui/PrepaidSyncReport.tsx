import React from "react";

export interface PrepaidSyncResult {
  customerId: number;
  username: string;
  planName: string;
  serviceType: string;
  routerName: string;
  outcome: "synced" | "failed" | "skipped" | "unknown";
  message?: string;
}

interface Props {
  running: boolean;
  total: number;
  processed: number;
  users: PrepaidSyncResult[];
  routerName: string;
  error?: string | null;
  logs: string[];
  onDismiss: () => void;
}

const TONES = {
  synced: { label: "Synced", bg: "rgba(16,185,129,0.12)", fg: "#0f9d78", bd: "rgba(16,185,129,0.30)" },
  failed: { label: "Failed", bg: "rgba(220,38,38,0.10)", fg: "#dc2626", bd: "rgba(220,38,38,0.30)" },
  skipped: { label: "Skipped", bg: "rgba(217,119,6,0.12)", fg: "#d97706", bd: "rgba(217,119,6,0.30)" },
  unknown: { label: "Unconfirmed", bg: "rgba(217,119,6,0.12)", fg: "#d97706", bd: "rgba(217,119,6,0.30)" },
} as const;

export function PrepaidSyncReport({ running, total, processed, users, routerName, error, logs, onDismiss }: Props) {
  const count = (o: PrepaidSyncResult["outcome"]) => users.filter(u => u.outcome === o).length;
  const synced = count("synced");
  const failed = count("failed");
  const skipped = count("skipped");
  const unknown = count("unknown");
  const complete = total > 0 && processed === total && users.length === total && synced === total && !error;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  let heading = "Sync finished with issues";
  let tone: "ok" | "warn" | "bad" = "warn";
  if (running) heading = "Syncing active prepaid accounts";
  else if (complete) { heading = "Fully synced"; tone = "ok"; }
  else if (error && processed < total) { heading = "Sync stopped with an error"; tone = "bad"; }
  else if (total === 0) heading = "No active accounts to sync";
  else if (failed > 0 && synced === 0) { heading = "Sync failed"; tone = "bad"; }
  else heading = "Partially synced";
  const color = tone === "ok" ? "#0f9d78" : tone === "bad" ? "#dc2626" : "#d97706";

  const chip = (label: string, n: number, c: string) => (
    <span style={{ border: `1px solid ${c}55`, color: c, borderRadius: 999, padding: "2px 10px", fontSize: "0.75rem", fontWeight: 700 }}>
      {label}: {n}
    </span>
  );
  const th: React.CSSProperties = { textAlign: "left", padding: "8px 12px", fontSize: "0.68rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--isp-text-muted)", position: "sticky", top: 0, background: "var(--isp-card)", borderBottom: "1px solid var(--isp-border)", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "9px 12px", fontSize: "0.8rem", borderBottom: "1px solid var(--isp-border)", verticalAlign: "top" };

  return (
    <section className="prepaid-sync-report" aria-label="Prepaid sync report" style={{ background: "var(--isp-card)", color: "var(--isp-text)", border: "1px solid var(--isp-border)", borderLeft: `4px solid ${running ? "var(--isp-accent)" : color}`, borderRadius: 12, padding: "1rem", marginTop: "0.75rem" }}>
      <style>{`
        .pxs-bar { transition: transform .35s ease; }
        @media (prefers-reduced-motion: reduce) { .pxs-bar { transition: none; } }
        @media (max-width: 640px) {
          .prepaid-sync-report .prepaid-sync-result-table { min-width: 0 !important; display: block; }
          .prepaid-sync-result-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
          .prepaid-sync-result-table tbody { display: grid; gap: 10px; padding: 10px; }
          .prepaid-sync-result-table tbody tr { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border: 1px solid var(--isp-border); border-radius: 8px; overflow: hidden; }
          .prepaid-sync-result-table tbody td { min-width: 0; border-bottom: 0 !important; overflow-wrap: anywhere; }
          .prepaid-sync-result-table tbody td:first-child { grid-column: 1 / -1; background: var(--isp-inner-card); }
          .prepaid-sync-result-table tbody td::before { content: attr(data-label); display: block; margin-bottom: 5px; color: var(--isp-text-muted); font-size: 0.65rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
        }
      `}</style>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: "1rem", color: running ? "var(--isp-text)" : color }}>{heading}</h3>
          <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "var(--isp-text-muted)" }}>Router: {routerName || "All routers"}</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onDismiss} disabled={running} aria-disabled={running} title={running ? "Available when sync finishes" : "Dismiss report"}
          style={{ opacity: running ? 0.5 : 1, cursor: running ? "not-allowed" : "pointer", background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", borderRadius: 8, padding: "6px 10px", color: "var(--isp-text-muted)", fontSize: "0.75rem" }}>
          Dismiss
        </button>
      </div>

      {running ? (
        <div style={{ marginTop: 14 }}>
          <div role="progressbar" aria-label="Prepaid sync progress" aria-valuemin={0} aria-valuemax={Math.max(total, 1)} aria-valuenow={processed} style={{ height: 8, borderRadius: 99, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", overflow: "hidden" }}>
            <div className="pxs-bar" style={{ height: "100%", width: "100%", transformOrigin: "left", transform: `scaleX(${pct / 100})`, background: "linear-gradient(90deg,#0f9d78,#14b8a6)" }} />
          </div>
          <p role="status" aria-live="polite" style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "var(--isp-text-muted)" }}>
            {processed} of {total} accounts processed ({pct}%)
          </p>
        </div>
      ) : (
        <>
          {error && (
            <p role="alert" style={{ margin: "12px 0 0", padding: "8px 12px", borderRadius: 8, background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.28)", color: "#dc2626", fontSize: "0.8rem" }}>{error}</p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }} aria-live="polite">
            {chip("Total", total, "var(--isp-text-muted)")}
            {chip("Synced", synced, "#0f9d78")}
            {failed > 0 && chip("Failed", failed, "#dc2626")}
            {skipped > 0 && chip("Skipped", skipped, "#d97706")}
            {unknown > 0 && chip("Unconfirmed", unknown, "#d97706")}
          </div>
          {total === 0 && !error && (
            <p style={{ margin: "12px 0 0", fontSize: "0.8rem", color: "var(--isp-text-muted)" }}>There are no active prepaid accounts to push to MikroTik.</p>
          )}
          {users.length > 0 && (
            <div style={{ marginTop: 12, maxHeight: 360, overflow: "auto", border: "1px solid var(--isp-border)", borderRadius: 10 }}>
              <table role="table" className="prepaid-sync-result-table" style={{ width: "100%", minWidth: 560, borderCollapse: "collapse" }}>
                <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Prepaid account sync results</caption>
                <thead>
                  <tr>
                    <th scope="col" style={th}>Username</th>
                    <th scope="col" style={th}>Plan</th>
                    <th scope="col" style={th}>Type</th>
                    <th scope="col" style={th}>Router</th>
                    <th scope="col" style={th}>Sync status</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => {
                    const t = TONES[u.outcome];
                    return (
                      <tr key={`${u.customerId}:${u.username}`}>
                        <td data-label="Username" style={{ ...td, fontWeight: 650, wordBreak: "break-word" }}>{u.username}</td>
                        <td data-label="Plan" style={td}>{u.planName}</td>
                        <td data-label="Type" style={{ ...td, textTransform: "uppercase" }}>{u.serviceType}</td>
                        <td data-label="Router" style={td}>{u.routerName}</td>
                        <td data-label="Sync status" style={td}>
                          <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, fontSize: "0.72rem", fontWeight: 700 }}>{t.label}</span>
                          {u.message && u.outcome !== "synced" && <div style={{ marginTop: 4, fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>{u.message}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ margin: "10px 0 0", fontSize: "0.72rem", color: "var(--isp-text-muted)" }}>Synced means MikroTik confirmed the enabled account and its assigned plan. Existing online sessions are preserved. It does not confirm a live internet session.</p>
        </>
      )}

      {logs.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontSize: "0.78rem", fontWeight: 600, color: "var(--isp-accent)" }}>Technical details ({logs.length})</summary>
          <pre className="font-mono" style={{ margin: "8px 0 0", maxHeight: 200, overflow: "auto", padding: 10, borderRadius: 8, background: "var(--isp-inner-card)", border: "1px solid var(--isp-border)", fontSize: "0.72rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{logs.join("\n")}</pre>
        </details>
      )}
    </section>
  );
}

export default PrepaidSyncReport;
