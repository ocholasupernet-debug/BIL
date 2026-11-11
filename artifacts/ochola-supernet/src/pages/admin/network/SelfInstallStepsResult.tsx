import React from "react";
import { AlertTriangle, Check, CheckCircle2, Clipboard, Download, ShieldCheck, TerminalSquare } from "lucide-react";
import "./SelfInstallStepsResult.css";

type StepId = "network" | "vpn" | "services";

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
          <p className="self-install-result__eyebrow">Router configuration · Step output</p>
          <h3 id="self-install-result-heading">Your setup commands are ready</h3>
          <p className="self-install-result__intro">
            Run each command in the MikroTik terminal, wait for it to finish, then continue to the next step.
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
          <strong>Router profile created</strong>
          <span>Three ordered configuration steps are ready. Each command fetches and imports one step only.</span>
        </span>
      </div>

      <div className="self-install-result__list-heading">
        <h4>Run these steps in order</h4>
        <span>Router terminal · one command at a time</span>
      </div>

      <div className="self-install-result__steps">
        {steps.map(step => (
          <article className="self-install-result__step" key={step.id}>
            <div className="self-install-result__step-heading">
              <div className="self-install-result__step-title">
                <span className="self-install-result__number">{String(step.order).padStart(2, "0")}</span>
                <span>
                  <strong>Step {step.order}: {step.title}</strong>
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
                    aria-label={`Download Step ${step.order} command`}
                  >
                    <Download size={14} aria-hidden="true" />
                    Download
                  </button>
                  <button
                    className="self-install-result__button self-install-result__button--primary"
                    type="button"
                    onClick={() => onCopy(step.id)}
                    disabled={busy !== ""}
                    aria-label={`Copy Step ${step.order} command`}
                  >
                    {copiedStep === step.id
                      ? <Check size={14} aria-hidden="true" />
                      : <Clipboard size={14} aria-hidden="true" />}
                    {copiedStep === step.id ? "Copied" : "Copy command"}
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
        <span><strong>Run the commands in order.</strong> Stop if a step reports an error; resolve it before continuing.</span>
      </div>

      <p className="self-install-result__footnote" aria-live="polite">
        <CheckCircle2 size={14} aria-hidden="true" />
        Your tenant-owned router profile is ready. Each step remains separate for safe, ordered setup.
      </p>
    </section>
  );
}
