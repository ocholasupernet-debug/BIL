import React, { useState, type FormEvent } from "react";
import { ArrowLeft, KeyRound, Mail, Smartphone, Wifi } from "lucide-react";

type RecoveryOptions = {
  email?: { masked: string };
  phone?: { masked: string };
};

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
  const [recoveryStep, setRecoveryStep] = useState<"login" | "options" | "code" | "reset">("login");
  const [recoveryUsername, setRecoveryUsername] = useState("");
  const [recoveryOptions, setRecoveryOptions] = useState<RecoveryOptions>({});
  const [recoveryChannel, setRecoveryChannel] = useState<"email" | "phone">("email");
  const [recoveryChallengeId, setRecoveryChallengeId] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  const beginRecovery = () => {
    setError("");
    setPassword("");
    setRecoveryError("");
    setRecoveryMessage("");
    setRecoveryUsername(username.trim());
    setRecoveryOptions({});
    setRecoveryChallengeId("");
    setRecoveryCode("");
    setResetToken("");
    setNewPassword("");
    setConfirmPassword("");
    setRecoveryStep("options");
  };

  const backToLogin = () => {
    setRecoveryStep("login");
    setRecoveryOptions({});
    setRecoveryChallengeId("");
    setRecoveryCode("");
    setResetToken("");
    setNewPassword("");
    setConfirmPassword("");
    setRecoveryError("");
    setRecoveryMessage("");
    setPassword("");
  };

  const loadRecoveryOptions = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRecoveryError("");
    setRecoveryMessage("");
    if (!recoveryUsername.trim()) {
      setRecoveryError("Enter your username to find available recovery methods.");
      return;
    }
    setRecoveryBusy(true);
    try {
      const response = await fetch("/api/customers/hotspot-password-recovery/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: recoveryUsername.trim() }),
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        options?: RecoveryOptions;
      };
      if (!response.ok || result.ok !== true) {
        setRecoveryError(result.error || "Recovery options are temporarily unavailable.");
        return;
      }
      const options = result.options ?? {};
      setRecoveryOptions(options);
      setRecoveryChannel(options.email ? "email" : "phone");
      if (!options.email && !options.phone) {
        setRecoveryMessage("If this username has a registered contact, recovery will be available here. Otherwise, contact your ISP administrator.");
      }
    } catch {
      setRecoveryError("Recovery options are temporarily unavailable. Please try again.");
    } finally {
      setRecoveryBusy(false);
    }
  };

  const requestRecoveryCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRecoveryError("");
    setRecoveryMessage("");
    setRecoveryBusy(true);
    try {
      const response = await fetch("/api/customers/hotspot-password-recovery/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: recoveryUsername.trim(),
          channel: recoveryChannel,
        }),
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        challengeId?: string | null;
        maskedDestination?: string | null;
      };
      if (!response.ok || result.ok !== true) {
        setRecoveryError(result.error || "The reset code could not be sent. Please try again.");
        return;
      }
      if (result.challengeId) {
        setRecoveryChallengeId(result.challengeId);
        setRecoveryStep("code");
        setRecoveryMessage(
          result.maskedDestination
            ? `A reset code was sent to ${result.maskedDestination}.`
            : "A reset code was sent to the selected registered contact.",
        );
      } else {
        setRecoveryMessage("If the username and contact method match an account, a reset code will be sent. Check your contact or ask your ISP administrator for help.");
      }
    } catch {
      setRecoveryError("The reset code could not be sent. Please try again.");
    } finally {
      setRecoveryBusy(false);
    }
  };

  const verifyRecoveryCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRecoveryError("");
    if (!recoveryChallengeId) {
      setRecoveryError("Request a new reset code before continuing.");
      return;
    }
    setRecoveryBusy(true);
    try {
      const response = await fetch("/api/customers/hotspot-password-recovery/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: recoveryChallengeId, code: recoveryCode.trim() }),
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        resetToken?: string;
      };
      if (!response.ok || result.ok !== true || !result.resetToken) {
        setRecoveryError(result.error || "That code is invalid or expired. Request a new one.");
        return;
      }
      setResetToken(result.resetToken);
      setRecoveryCode("");
      setRecoveryStep("reset");
      setRecoveryMessage("Choose a new password for your Hotspot account.");
    } catch {
      setRecoveryError("The code could not be verified. Please try again.");
    } finally {
      setRecoveryBusy(false);
    }
  };

  const submitNewPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRecoveryError("");
    if (newPassword.length < 6 || newPassword.length > 256) {
      setRecoveryError("Use a password between 6 and 256 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setRecoveryError("The passwords do not match.");
      return;
    }
    setRecoveryBusy(true);
    try {
      const response = await fetch("/api/customers/hotspot-password-recovery/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetToken, newPassword }),
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!response.ok || result.ok !== true) {
        setRecoveryError(result.error || "Your password could not be updated. Request a fresh reset code.");
        return;
      }
      setUsername(recoveryUsername);
      setNewPassword("");
      setConfirmPassword("");
      setResetToken("");
      setRecoveryStep("login");
      setError("");
      setRecoveryMessage("Password updated. Sign in with your username and new password.");
      setPassword("");
    } catch {
      setRecoveryError("Your password could not be updated. Request a fresh reset code.");
    } finally {
      setRecoveryBusy(false);
    }
  };

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
          <h1 id="member-login-title" style={titleStyle}>
            {recoveryStep === "login" ? "Sign In" : recoveryStep === "options" ? "Recover your account" : recoveryStep === "code" ? "Verify your code" : "Set a new password"}
          </h1>
          <p style={subtitleStyle}>
            {recoveryStep === "login" ? "Log in to Member Panel" : recoveryStep === "options" ? "Choose where to receive a reset code." : recoveryStep === "code" ? "Enter the one-time code sent to your registered contact." : "Choose a new password for your account."}
          </p>
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
        ) : recoveryStep === "login" ? (
          <form onSubmit={submitLogin} noValidate>
            <label htmlFor="member-username" style={labelStyle}>Username</label>
            <input
              id="member-username"
              name="username"
              type="text"
              value={username}
              onChange={event => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              required
              maxLength={64}
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
            {recoveryMessage && <div role="status" style={noticeStyle}>{recoveryMessage}</div>}
          </form>
        ) : (
          <div>
            <button type="button" onClick={backToLogin} style={backButtonStyle}>
              <ArrowLeft size={15} /> Back to sign in
            </button>
            {recoveryMessage && <div role="status" style={noticeStyle}>{recoveryMessage}</div>}
            {recoveryError && <div role="alert" aria-live="assertive" style={recoveryErrorStyle}>{recoveryError}</div>}

            {recoveryStep === "options" && (
              <>
                <form onSubmit={loadRecoveryOptions} noValidate>
                  <label htmlFor="recovery-username" style={fieldLabelStyle}>Username</label>
                  <input
                    id="recovery-username"
                    name="recoveryUsername"
                    type="text"
                    value={recoveryUsername}
                    onChange={event => {
                      setRecoveryUsername(event.target.value);
                      setRecoveryOptions({});
                      setRecoveryMessage("");
                    }}
                    autoComplete="username"
                    autoCapitalize="none"
                    maxLength={64}
                    required
                    placeholder="Enter your username"
                    style={inputStyle}
                  />
                  <button type="submit" disabled={recoveryBusy} style={primaryButtonStyle(recoveryBusy)}>
                    {recoveryBusy ? "Checking…" : "Continue"}
                  </button>
                </form>

                {Object.keys(recoveryOptions).length > 0 && (
                  <form onSubmit={requestRecoveryCode} style={{ marginTop: 22 }}>
                    <p style={fieldLabelStyle}>Send the reset code to</p>
                    {recoveryOptions.email && (
                      <label style={recoveryChoiceStyle}>
                        <input
                          type="radio"
                          name="recoveryChannel"
                          value="email"
                          checked={recoveryChannel === "email"}
                          onChange={() => setRecoveryChannel("email")}
                        />
                        <Mail size={17} />
                        <span>Email <strong>{recoveryOptions.email.masked}</strong></span>
                      </label>
                    )}
                    {recoveryOptions.phone && (
                      <label style={recoveryChoiceStyle}>
                        <input
                          type="radio"
                          name="recoveryChannel"
                          value="phone"
                          checked={recoveryChannel === "phone"}
                          onChange={() => setRecoveryChannel("phone")}
                        />
                        <Smartphone size={17} />
                        <span>Phone <strong>{recoveryOptions.phone.masked}</strong></span>
                      </label>
                    )}
                    <button type="submit" disabled={recoveryBusy} style={primaryButtonStyle(recoveryBusy)}>
                      {recoveryBusy ? "Sending code…" : "Send reset code"}
                    </button>
                  </form>
                )}
              </>
            )}

            {recoveryStep === "code" && (
              <form onSubmit={verifyRecoveryCode} noValidate>
                <label htmlFor="recovery-code" style={fieldLabelStyle}>One-time code</label>
                <input
                  id="recovery-code"
                  name="recoveryCode"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={recoveryCode}
                  onChange={event => setRecoveryCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  maxLength={6}
                  required
                  placeholder="6-digit code"
                  style={inputStyle}
                />
                <button type="submit" disabled={recoveryBusy} style={primaryButtonStyle(recoveryBusy)}>
                  {recoveryBusy ? "Verifying…" : "Verify code"}
                </button>
                <button type="button" onClick={() => setRecoveryStep("options")} style={textButtonStyle}>
                  Choose another delivery method
                </button>
              </form>
            )}

            {recoveryStep === "reset" && (
              <form onSubmit={submitNewPassword} noValidate>
                <label htmlFor="new-member-password" style={fieldLabelStyle}>New password</label>
                <input
                  id="new-member-password"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={event => setNewPassword(event.target.value)}
                  minLength={6}
                  maxLength={256}
                  required
                  placeholder="At least 6 characters"
                  style={inputStyle}
                />
                <label htmlFor="confirm-member-password" style={{ ...fieldLabelStyle, marginTop: 18 }}>Confirm new password</label>
                <input
                  id="confirm-member-password"
                  name="confirmNewPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={event => setConfirmPassword(event.target.value)}
                  minLength={6}
                  maxLength={256}
                  required
                  placeholder="Enter the new password again"
                  style={inputStyle}
                />
                <button type="submit" disabled={recoveryBusy} style={primaryButtonStyle(recoveryBusy)}>
                  {recoveryBusy ? "Updating password…" : "Update password"}
                </button>
              </form>
            )}
          </div>
        )}

        <footer style={footerStyle}>
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

const fieldLabelStyle: React.CSSProperties = {
  display: "block",
  margin: "0 0 8px",
  color: "#c4d2e1",
  fontSize: 13,
  fontWeight: 650,
};

const primaryButtonStyle = (busy: boolean): React.CSSProperties => ({
  width: "100%",
  minHeight: 47,
  marginTop: 18,
  border: 0,
  borderRadius: 10,
  color: "#f8fafc",
  background: busy ? "#31546a" : "linear-gradient(100deg, #117c87, #155e91)",
  boxShadow: "0 10px 24px rgba(14,116,144,.2)",
  fontSize: 14,
  fontWeight: 750,
  cursor: busy ? "wait" : "pointer",
});

const textButtonStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 13,
  padding: "8px 0",
  border: 0,
  color: "#6edbd1",
  background: "transparent",
  fontSize: 13,
  fontWeight: 650,
  cursor: "pointer",
};

const backButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  marginBottom: 18,
  padding: "5px 0",
  border: 0,
  color: "#a9c1d8",
  background: "transparent",
  fontSize: 13,
  cursor: "pointer",
};

const recoveryChoiceStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  minHeight: 48,
  marginTop: 9,
  padding: "0 12px",
  borderRadius: 10,
  border: "1px solid rgba(192,210,229,.14)",
  color: "#c8d6e5",
  background: "rgba(255,255,255,.035)",
  fontSize: 13,
  cursor: "pointer",
};

const noticeStyle: React.CSSProperties = {
  marginTop: 15,
  padding: "11px 12px",
  borderRadius: 10,
  color: "#b8e7e2",
  background: "rgba(20,184,166,.09)",
  border: "1px solid rgba(94,234,212,.16)",
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

const recoveryErrorStyle: React.CSSProperties = {
  marginBottom: 15,
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
