import React from "react";
import { AlertTriangle, Check, CheckCircle2, Clipboard, Download, ShieldCheck, TerminalSquare } from "lucide-react";
import "./SelfInstallStepsResult.css";

type StepId = "mainhotspot";

type SelfInstallStep = {
  id: StepId;
  order: number;
  title: string;
  fileName: string;
  description: string;
  command: string;
};

type SelfInstallStepsResultProps = {
  steps: SelfInstallStep[];
  copiedStep: StepId | null;
  busy: string;
  onCopy: (stepId: StepId) => void;
  onDownload: (stepId: StepId) => void;
};

export function SelfInstallStepsResult({
  steps,
  copiedStep,
  busy,
  onCopy,
  onDownload,
}: SelfInstallStepsResultProps) {
  return (
    <section className="self-install-result" aria-labelledby="self-install-result-heading">
      <header className="self-install-result__header">
        <div>
          <p className="self-install-result__eyebrow">Router configuration · Protected fetch</p>
          <h3 id="self-install-result-heading">Your setup file is ready</h3>
          <p className="self-install-result__intro">
            Copy and run the command to fetch this router's setup bundle and import it.
          </p>
        </div>
        <span className="self-install-result__ready">
          <CheckCircle2 size={15} aria-hidden="true" />
          Generated · Ready
        </span>
      </header>

      <div className="self-install-result__banner" role="status">
        <span className="self-install-result__banner-icon">
          <ShieldCheck size={18} aria-hidden="true" />
        </span>
        <span>
            <strong>Short-lived tenant download</strong>
            <span>The command uses a protected link for this router. It expires after five minutes.</span>
        </span>
      </div>

      <div className="self-install-result__list-heading">
        <h4>Fetch and import</h4>
        <span>One RouterOS command</span>
      </div>

      <div className="self-install-result__steps">
        {steps.map(step => (
          <article className="self-install-result__step" key={step.id}>
            <div className="self-install-result__step-heading">
              <div className="self-install-result__step-title">
                <span className="self-install-result__number">{String(step.order).padStart(2, "0")}</span>
                <span>
                  <strong>{step.title}</strong>
                  <code>{step.fileName}</code>
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
                    disabled={busy !== ""}
                    aria-label="Download mainhotspot.rsc"
                  >
                    <Download size={14} aria-hidden="true" />
                    Download RSC
                  </button>
                  <button
                    className="self-install-result__button self-install-result__button--primary"
                    type="button"
                    onClick={() => onCopy(step.id)}
                    disabled={busy !== ""}
                    aria-label="Copy RouterOS fetch and import command"
                  >
                    {copiedStep === step.id
                      ? <Check size={14} aria-hidden="true" />
                      : <Clipboard size={14} aria-hidden="true" />}
                    {copiedStep === step.id ? "Copied" : "Copy fetch/import command"}
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
        <span><strong>Keep the command private.</strong> It contains a short-lived link to a bundle with router credentials. If it expires, generate a fresh command.</span>
      </div>

      <p className="self-install-result__footnote" aria-live="polite">
        <CheckCircle2 size={14} aria-hidden="true" />
        The command downloads and imports the bundle, then removes the local file after a successful import. Setup runs in order and stops on errors.
      </p>
    </section>
  );
}
