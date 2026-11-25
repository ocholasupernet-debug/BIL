import React from "react";
import { AlertTriangle, Check, CheckCircle2, Clipboard, Download, ShieldCheck, TerminalSquare } from "lucide-react";
import "./SelfInstallStepsResult.css";

type StepId = "mainhotspot" | "network" | "vpn" | "services";

type SelfInstallStep = {
  id: StepId;
  order: number;
  title: string;
  fileName: string;
  description: string;
  command: string;
  sizeBytes?: number;
};

type SelfInstallStepsResultProps = {
  steps: SelfInstallStep[];
  compactMode?: boolean;
  managementVpnReady: boolean;
  managementVpnMessage?: string;
  copiedStep: StepId | null;
  busy: string;
  onCopy: (stepId: StepId) => void;
  onDownload: (stepId: StepId) => void;
};

export function SelfInstallStepsResult({
  steps,
  compactMode = false,
  managementVpnReady,
  managementVpnMessage,
  copiedStep,
  busy,
  onCopy,
  onDownload,
}: SelfInstallStepsResultProps) {
  return (
    <section className="self-install-result" aria-labelledby="self-install-result-heading">
      <header className="self-install-result__header">
        <div>
          <p className="self-install-result__eyebrow">Router configuration · Authenticated download</p>
          <h3 id="self-install-result-heading">{compactMode ? "Compact bootstrap is ready" : "Your setup file is ready"}</h3>
          <p className="self-install-result__intro">
            {compactMode
              ? "Download the bootstrap, upload it to RouterOS Files, then import it. It adds and runs the smaller setup files in order."
              : "Use the fetch/import command when the router trusts HTTPS, or download and upload the file manually."}
          </p>
        </div>
        <span
          className="self-install-result__ready"
          style={!managementVpnReady ? {
            color: "#fbbf24",
            background: "rgba(245,158,11,.1)",
            borderColor: "rgba(245,158,11,.28)",
          } : undefined}
        >
          {managementVpnReady
            ? <CheckCircle2 size={15} aria-hidden="true" />
            : <AlertTriangle size={15} aria-hidden="true" />}
          {managementVpnReady ? "Generated · Ready" : "Generated · VPS setup pending"}
        </span>
      </header>

      {!managementVpnReady && (
        <div className="self-install-result__warning" role="status" style={{ marginBottom: 14 }}>
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{managementVpnMessage || "Wait for both VPS management VPN instances to be ready before downloading or importing."}</span>
        </div>
      )}

      <div className="self-install-result__banner" role="status">
        <span className="self-install-result__banner-icon">
          <ShieldCheck size={18} aria-hidden="true" />
        </span>
        <span>
            <strong>Short-lived protected fetch links</strong>
            <span>{compactMode
              ? "The bootstrap imports the public trust certificate first, then fetches each limited-use stage over verified HTTPS. Stage files remain on the router."
              : "The command uses a temporary limited-use link with HTTPS verification. The file is also available from this signed-in admin page."}</span>
        </span>
      </div>

      <div className="self-install-result__list-heading">
        <h4>{compactMode ? "Upload and import this bootstrap" : "Setup file and command"}</h4>
        <span>{compactMode ? "Network → VPN/API → services" : "One setup bundle"}</span>
      </div>

      <div className="self-install-result__steps">
        {steps.map(step => (
          <article className="self-install-result__step" key={step.id}>
            <div className="self-install-result__step-heading">
              <div className="self-install-result__step-title">
                <span className="self-install-result__number">{String(step.order).padStart(2, "0")}</span>
                <span>
                  <strong>{step.title}</strong>
                  <code>
                    {step.fileName}
                    {typeof step.sizeBytes === "number" ? ` · ${(step.sizeBytes / 1024).toFixed(1)} KB` : ""}
                  </code>
                </span>
              </div>
            </div>
            <p className="self-install-result__description">{step.description}</p>

            <div className="self-install-result__terminal">
              <div className="self-install-result__terminal-header">
                <span className="self-install-result__terminal-label">
                  <TerminalSquare size={14} aria-hidden="true" />
                  RouterOS terminal command
                </span>
                <div className="self-install-result__actions">
                  <button
                    className="self-install-result__button"
                    type="button"
                    onClick={() => onDownload(step.id)}
                    disabled={busy !== "" || !managementVpnReady}
                    aria-label={`Download ${step.fileName}`}
                  >
                    <Download size={14} aria-hidden="true" />
                    Download file
                  </button>
                  <button
                    className="self-install-result__button self-install-result__button--primary"
                    type="button"
                    onClick={() => onCopy(step.id)}
                    disabled={busy !== "" || !managementVpnReady}
                    aria-label="Copy RouterOS import command"
                  >
                    {copiedStep === step.id
                      ? <Check size={14} aria-hidden="true" />
                      : <Clipboard size={14} aria-hidden="true" />}
                    {copiedStep === step.id ? "Copied" : "Copy import command"}
                  </button>
                </div>
              </div>
              <pre className="self-install-result__command" aria-label={`Self Install Step ${step.order} command`}>
                <code>{step.command}</code>
              </pre>
            </div>
          </article>
        ))}
      </div>

      <div className="self-install-result__warning">
        <AlertTriangle size={16} aria-hidden="true" />
        <span>
          <strong>{compactMode ? "Keep the generated files private." : "Keep the setup file private."}</strong>{" "}
          They contain router-specific configuration and credentials. The compact stage files stay in RouterOS Files after import; remove them after verifying setup.
        </span>
      </div>

      <p className="self-install-result__footnote" aria-live="polite">
        <CheckCircle2 size={14} aria-hidden="true" />
        {compactMode
          ? "Import the named mainhotspot bootstrap. It trusts HTTPS, downloads and imports Network, VPN/API, and services in order, and stops on errors. Downloaded stages remain available for recovery."
          : "The command fetches and imports the bundle directly. Alternatively, upload the downloaded file and import it locally. Setup runs in order and stops on errors."}
      </p>
    </section>
  );
}
