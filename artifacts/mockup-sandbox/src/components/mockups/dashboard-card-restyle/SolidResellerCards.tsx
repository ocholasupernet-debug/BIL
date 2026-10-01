import "./_group.css";
import "./current.css";
import "./solid.css";
import { Banknote, Gauge, PauseCircle, PlayCircle, ReceiptText, Router, Users, WalletCards } from "lucide-react";

const metrics = [
  { label: "Income today", value: "KSh 8,400", icon: <Gauge size={18} />, tone: "slate" },
  { label: "Income this month", value: "KSh 162,500", icon: <WalletCards size={18} />, tone: "green" },
  { label: "Total transactions", value: "268", icon: <ReceiptText size={18} />, tone: "amber" },
  { label: "Total revenue", value: "KSh 1.2M", icon: <Banknote size={18} />, tone: "rust" },
  { label: "Total users", value: "180", icon: <Users size={18} />, tone: "teal" },
  { label: "Active users", value: "142", icon: <PlayCircle size={18} />, tone: "green" },
  { label: "Expired users", value: "38", icon: <PauseCircle size={18} />, tone: "amber" },
  { label: "Online on assigned router", value: "31", icon: <Router size={18} />, tone: "teal" },
];

export function SolidResellerCards() {
  return (
    <main className="card-preview solid-card-preview">
      <header className="card-preview-header">
        <div><h1>Reseller account</h1><p>Collections, customer accounts, and assigned router activity</p></div>
        <span className="card-preview-note">Sample figures</span>
      </header>
      <section className="card-preview-section" aria-label="Reseller financial statistics">
        <h2 className="card-preview-section-title">Financial pulse <span>Collections for your account</span></h2>
        <div className="reseller-card-grid">
          {metrics.slice(0, 4).map((card) => (
            <article className={`reseller-stat-card reseller-stat-card--${card.tone}`} key={card.label}>
              {card.icon}
              <div className="reseller-metric-label">{card.label}</div>
              <div className="reseller-metric-value">{card.value}</div>
            </article>
          ))}
        </div>
      </section>
      <section className="card-preview-section" aria-label="Reseller account statistics">
        <h2 className="card-preview-section-title">Account activity <span>Assigned service overview</span></h2>
        <div className="reseller-card-grid">
          {metrics.slice(4).map((card) => (
            <article className={`reseller-stat-card reseller-stat-card--${card.tone}`} key={card.label}>
              {card.icon}
              <div className="reseller-metric-label">{card.label}</div>
              <div className="reseller-metric-value">{card.value}</div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}