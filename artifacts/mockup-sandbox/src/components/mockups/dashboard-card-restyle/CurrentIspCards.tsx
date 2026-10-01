import "./_group.css";
import "./current.css";
import { ArrowUpRight, Banknote, BarChart3, CircleCheck, ReceiptText, Server, Signal, TrendingUp, Users, Wifi } from "lucide-react";

const financial = [
  { label: "Income today", value: "KSh 14,800", icon: <Banknote size={19} />, tone: "green", description: "Since midnight · EAT" },
  { label: "Income this month", value: "KSh 412,800", icon: <TrendingUp size={19} />, tone: "green", description: "Month to date · resets on the 1st" },
  { label: "Total transactions", value: "1,248", icon: <ReceiptText size={19} />, tone: "amber", description: "All time" },
  { label: "Total revenue", value: "KSh 1.8M", icon: <BarChart3 size={19} />, tone: "plum", description: "All time" },
];

const network = [
  { label: "Total online users", value: "126", icon: <Users size={16} />, tone: "green" },
  { label: "PPPoE online", value: "34", icon: <Wifi size={16} />, tone: "accent" },
  { label: "Hotspot online", value: "72", icon: <Signal size={16} />, tone: "teal" },
  { label: "VLAN users online", value: "11", icon: <Wifi size={16} />, tone: "accent" },
  { label: "Static online", value: "9", icon: <Server size={16} />, tone: "amber" },
  { label: "Active / expired users", value: "1,142 / 62", icon: <CircleCheck size={16} />, tone: "green" },
  { label: "Active resellers", value: "24", icon: <Users size={16} />, tone: "accent" },
  { label: "Online resellers", value: "17", icon: <Wifi size={16} />, tone: "teal" },
];

export function CurrentIspCards() {
  return (
    <main className="card-preview">
      <header className="card-preview-header">
        <div><h1>ISP dashboard</h1><p>Financial pulse and live network statistics</p></div>
        <span className="card-preview-note">Sample figures</span>
      </header>
      <section className="card-preview-section" aria-label="Financial pulse">
        <h2 className="card-preview-section-title">Financial pulse <span>Updated from live payment activity</span></h2>
        <div className="dashboard-kpi-grid">
          {financial.map((card) => (
            <article className={`dashboard-kpi dashboard-kpi--${card.tone}`} key={card.label}>
              <span className="dashboard-kpi-icon" aria-hidden="true">{card.icon}</span>
              <span className="dashboard-kpi-copy">
                <span className="dashboard-kpi-label">{card.label}</span>
                <strong className="dashboard-kpi-value">{card.value}</strong>
                <span className="dashboard-kpi-description">{card.description}</span>
              </span>
            </article>
          ))}
        </div>
      </section>
      <section className="card-preview-section" aria-label="Network statistics">
        <h2 className="card-preview-section-title">Network statistics <span>Active services and partners</span></h2>
        <div className="dashboard-stat-grid">
          {network.map((card) => (
            <a className={`dashboard-stat dashboard-stat--${card.tone}`} href="#" key={card.label} onClick={(event) => event.preventDefault()}>
              <span className="dashboard-stat-icon" aria-hidden="true">{card.icon}</span>
              <span className="dashboard-stat-copy">
                <span className="dashboard-stat-label">{card.label}</span>
                <strong className="dashboard-stat-value">{card.value}</strong>
              </span>
              <ArrowUpRight className="dashboard-stat-arrow" size={15} aria-hidden="true" />
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}