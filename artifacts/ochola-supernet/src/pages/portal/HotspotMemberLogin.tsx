import React, { useState, type FormEvent } from "react";
import { Wifi } from "lucide-react";

type HotspotHostConfig = {
  adminId?: unknown;
};

function readTenantAdminId(): number | null {
  if (typeof window === "undefined") return null;
  const config = (window as Window & { __HOTSPOT_CONFIG__?: HotspotHostConfig }).__HOTSPOT_CONFIG__;
  const value = Number(config?.adminId);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function readDeviceContext(): { macAddress: string; clientIp: string } {
  if (typeof window === "undefined") return { macAddress: "", clientIp: "" };
  const params = new URLSearchParams(window.location.search);
  const rawMac = params.get("mac")
    ?? params.get("mac-address")
    ?? params.get("mac_address")
    ?? "";
  const hexMac = rawMac.replace(/[:-]/g, "").trim().toUpperCase();
  return {
    macAddress: /^[0-9A-F]{12}$/.test(hexMac)
      ? hexMac.match(/.{2}/g)?.join(":") ?? ""
      : "",
    clientIp: params.get("ip") ?? params.get("ip-address") ?? "",
  };
}

export default function HotspotMemberLogin() {
  const adminId = readTenantAdminId();
  const { macAddress, clientIp } = readDeviceContext();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!adminId) {
      setError("This member sign-in page is not linked to an active ISP account.");
      return;
    }
    if (!macAddress) {
      setError("Connect to the ISP Wi-Fi and open this page from its sign-in prompt.");
      return;
    }
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/customers/hotspot-login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminId,
          username: username.trim(),
          password,
          mac_address: macAddress,
          ...(clientIp ? { client_ip: clientIp } : {}),
        }),
      });
      const result = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || result.ok !== true) {
        setError(result.error || "We could not sign in with those details. Check them and try again.");
        return;
      }
      setPassword("");
      setConnected(true);
    } catch {
      setError("The sign-in service is temporarily unavailable. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main style={pageStyle}>
      <div aria-hidden="true" style={gridStyle} />
      <div aria-hidden="true" style={orbStyle} />
      <section aria-labelledby="member-login-title" style={cardStyle}>
        <header style={{ textAlign: "center", marginBottom: 30 }}>
          <div aria-hidden="true" style={logoStyle}>
            <Wifi size={23} strokeWidth={2.2} />
          </div>
          <div style={eyebrowStyle}>Member panel</div>
          <h1 id="member-login-title" style={titleStyle}>Sign In</h1>
          <p style={subtitleStyle}>Log in to Member Panel</p>
        </header>

        {connected ? (
          <div role="status" aria-live="polite" style={successStyle}>
            <strong style={{ display: "block", marginBottom: 6, color: "#6ee7b7", fontSize: 16 }}>
              You’re connected
            </strong>
            <span style={{ color: "#b8c9d9", fontSize: 13 }}>
              Your Hotspot account is active on this device.
            </span>
          </div>
        ) : (
          <form onSubmit={submitLogin} noValidate>
            <label htmlFor="member-username" style={labelStyle}>Username</label>
            <input
              id="member-username"
              name="username"
              value={username}
              onChange={event => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              required
              maxLength={100}
              placeholder="Enter your username"
              style={inputStyle}
            />
            <label htmlFor="member-password" style={{ ...labelStyle, marginTop: 20 }}>
              Password
            </label>
            <input
              id="member-password"
              name="password"
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              maxLength={256}
              placeholder="Enter your password"
              style={inputStyle}
            />
            {error && <div role="alert" aria-live="assertive" style={errorStyle}>{error}</div>}
            {!macAddress && !error && (
              <p style={deviceNoteStyle}>
                Connect to the ISP Wi-Fi first, then open this page from its sign-in prompt.
              </p>
            )}
            <button type="submit" disabled={submitting} style={buttonStyle(submitting)}>
              {submitting ? "Signing in…" : "Login"}
            </button>
          </form>
        )}

        <footer style={footerStyle}>
          <p style={accountNoteStyle}>Need a member account? Contact your ISP.</p>
          <div style={adminLinkRowStyle}>
            ADMIN?{" "}
            <a href="/admin/login" style={adminLinkStyle}>CLICK HERE</a>
          </div>
        </footer>
      </section>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: "32px 18px",
  overflow: "hidden",
  position: "relative",
  background:
    "radial-gradient(ellipse at 14% 40%, rgba(12,184,194,.28), transparent 42%), radial-gradient(ellipse at 88% 58%, rgba(227,74,105,.26), transparent 38%), linear-gradient(135deg, #071426 0%, #101d35 52%, #171a35 100%)",
  color: "#edf5ff",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
};

const gridStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  opacity: 0.18,
  pointerEvents: "none",
  backgroundImage:
    "linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)",
  backgroundSize: "44px 44px",
  maskImage: "linear-gradient(to bottom, black, transparent 82%)",
};

const orbStyle: React.CSSProperties = {
  position: "absolute",
  width: 420,
  height: 420,
  borderRadius: "50%",
  border: "1px solid rgba(94,234,212,.22)",
  boxShadow: "0 0 0 34px rgba(94,234,212,.035), 0 0 0 70px rgba(94,234,212,.025)",
  left: -210,
  top: "22%",
  pointerEvents: "none",
};

const cardStyle: React.CSSProperties = {
  width: "min(100%, 460px)",
  position: "relative",
  zIndex: 1,
  padding: "clamp(28px, 6vw, 44px)",
  borderRadius: 20,
  border: "1px solid rgba(194,213,238,.16)",
  background: "rgba(18,31,52,.94)",
  boxShadow: "0 30px 90px rgba(0,0,0,.42), 0 1px 0 rgba(255,255,255,.06) inset",
  backdropFilter: "blur(18px)",
};

const logoStyle: React.CSSProperties = {
  width: 52,
  height: 52,
  margin: "0 auto 18px",
  display: "grid",
  placeItems: "center",
  borderRadius: 15,
  color: "#dffdf9",
  background: "linear-gradient(140deg, #0f9f9b, #17678d)",
  boxShadow: "0 10px 28px rgba(14,165,166,.28)",
};

const eyebrowStyle: React.CSSProperties = {
  color: "#a9c1d8",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: ".15em",
  textTransform: "uppercase",
};

const titleStyle: React.CSSProperties = {
  margin: "9px 0 7px",
  color: "#f8fbff",
  fontSize: 28,
  lineHeight: 1.2,
  letterSpacing: "-.03em",
};

const subtitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#9aacc2",
  fontSize: 14,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 8,
  color: "#c4d2e1",
  fontSize: 13,
  fontWeight: 650,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: 46,
  padding: "0 13px",
  border: "1px solid rgba(192,210,229,.2)",
  borderRadius: 9,
  color: "#16263b",
  background: "#eaf1fa",
  fontSize: 14,
};

const deviceNoteStyle: React.CSSProperties = {
  margin: "13px 0 0",
  color: "#92a5bb",
  fontSize: 12,
  lineHeight: 1.5,
};

const errorStyle: React.CSSProperties = {
  marginTop: 16,
  padding: "11px 12px",
  borderRadius: 10,
  color: "#fecaca",
  background: "rgba(185,28,28,.16)",
  border: "1px solid rgba(248,113,113,.24)",
  fontSize: 13,
  lineHeight: 1.5,
};

const buttonStyle = (submitting: boolean): React.CSSProperties => ({
  width: "100%",
  minHeight: 48,
  marginTop: 22,
  border: 0,
  borderRadius: 10,
  color: "#f8fafc",
  background: submitting ? "#31546a" : "linear-gradient(100deg, #117c87, #155e91)",
  boxShadow: "0 10px 24px rgba(14,116,144,.22)",
  fontSize: 14,
  fontWeight: 750,
  cursor: submitting ? "wait" : "pointer",
});

const successStyle: React.CSSProperties = {
  padding: 18,
  borderRadius: 12,
  textAlign: "center",
  background: "rgba(16,185,129,.1)",
  border: "1px solid rgba(52,211,153,.25)",
};

const footerStyle: React.CSSProperties = {
  marginTop: 26,
  paddingTop: 19,
  borderTop: "1px solid rgba(192,210,229,.12)",
  textAlign: "center",
};

const accountNoteStyle: React.CSSProperties = {
  margin: "0 0 12px",
  color: "#8fa3b9",
  fontSize: 12,
};

const adminLinkRowStyle: React.CSSProperties = {
  color: "#a8bbcf",
  fontSize: 13,
};

const adminLinkStyle: React.CSSProperties = {
  color: "#68d7ce",
  fontWeight: 800,
  textDecoration: "none",
  letterSpacing: ".04em",
};
