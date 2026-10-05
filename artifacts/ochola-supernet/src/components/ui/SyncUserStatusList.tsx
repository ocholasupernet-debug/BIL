import { useEffect, useState } from "react";

export interface SyncUserStatus {
  username: string;
  planName: string;
  status: "active" | "expired";
  expiresAt: string | null;
}

export function SyncUserStatusList({ users }: { users: SyncUserStatus[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const futureExpiries = users
      .filter(user => user.status === "active" && user.expiresAt)
      .map(user => Date.parse(user.expiresAt ?? ""))
      .filter(expiry => Number.isFinite(expiry) && expiry > now);
    if (futureExpiries.length === 0) return;
    const nextExpiry = Math.min(...futureExpiries);
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(nextExpiry - now + 50, 0), 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [users, now]);

  const displayStatus = (user: SyncUserStatus): SyncUserStatus["status"] => {
    if (user.status === "expired") return "expired";
    const expiry = user.expiresAt ? Date.parse(user.expiresAt) : Number.NaN;
    return Number.isFinite(expiry) && expiry <= now ? "expired" : "active";
  };
  const activeCount = users.filter(user => displayStatus(user) === "active").length;
  const expiredCount = users.filter(user => displayStatus(user) === "expired").length;
  return (
    <section
      aria-label="Router-confirmed session status"
      style={{
        marginTop: "0.75rem",
        overflow: "hidden",
        border: "1px solid #e2e8f0",
        borderRadius: 10,
        background: "#fff",
        color: "#0f172a",
      }}
    >
      <div style={{ padding: "0.7rem 0.9rem", borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: "0.8rem", fontWeight: 800 }}>Router-confirmed session status</div>
        <div style={{ marginTop: 2, fontSize: "0.68rem", color: "#64748b" }}>
          Active: {activeCount} · Expired: {expiredCount}
        </div>
        <div style={{ marginTop: 3, fontSize: "0.66rem", color: "#64748b" }}>
          Active means MikroTik reported a live session; the status changes to Expired when stored expiry passes.
        </div>
      </div>
      {users.length === 0 ? (
        <p style={{ margin: 0, padding: "0.8rem 0.9rem", fontSize: "0.75rem", color: "#64748b" }}>
          No live sessions or expired accounts were reported during this sync.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "#64748b", textAlign: "left" }}>
                <th scope="col" style={{ padding: "0.55rem 0.9rem", fontWeight: 700 }}>Username</th>
                <th scope="col" style={{ padding: "0.55rem 0.9rem", fontWeight: 700 }}>Plan</th>
                <th scope="col" style={{ padding: "0.55rem 0.9rem", fontWeight: 700 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user, index) => {
                const status = displayStatus(user);
                return (
                  <tr key={`${user.username}:${user.planName}:${user.status}:${index}`} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "0.55rem 0.9rem", color: "#0f172a", fontWeight: 650 }}>{user.username}</td>
                  <td style={{ padding: "0.55rem 0.9rem", color: "#334155" }}>{user.planName}</td>
                  <td style={{ padding: "0.55rem 0.9rem" }}>
                    <span style={{
                      display: "inline-flex",
                      alignItems: "center",
                      borderRadius: 999,
                      padding: "0.18rem 0.48rem",
                      background: status === "active" ? "#dcfce7" : "#fee2e2",
                      color: status === "active" ? "#166534" : "#991b1b",
                      fontSize: "0.66rem",
                      fontWeight: 750,
                    }}>
                      {status === "active" ? "Active" : "Expired"}
                    </span>
                  </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
