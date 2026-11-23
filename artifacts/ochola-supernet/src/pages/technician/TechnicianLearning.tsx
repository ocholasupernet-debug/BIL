import { useState } from "react";
import { useLocation } from "wouter";
import {
  AlertTriangle, ArrowLeft, ArrowUpRight, BookOpen, Check, CheckCircle2, ChevronRight,
  CircleHelp, ExternalLink, FileText, Lightbulb, Radio, Router, Search, ShieldCheck,
  Signal, Wifi,
} from "lucide-react";
// @ts-ignore -- the API package declarations predate these hooks; runtime exports are provided by its source barrel.
import { useEmployeeLogout, useTechnicianGuide, useTechnicianGuides, useTechnicianModels } from "@workspace/api-client-react";
import type { TechnicianDiagram, TechnicianGuideCategory, TechnicianLearningGuide } from "./learning-types";
import { personalizedStaffPath } from "../employee/staff-routes";
import "./technician-learning.css";

const categories: Array<{ value: TechnicianGuideCategory | ""; label: string }> = [
  { value: "", label: "All topics" }, { value: "setup", label: "Setup" }, { value: "ports", label: "Ports & cabling" },
  { value: "wireless", label: "Wi-Fi" }, { value: "recovery", label: "Recovery" }, { value: "connectivity", label: "Connectivity" },
  { value: "fiber", label: "Fiber access" }, { value: "customer-care", label: "Customer care" },
];
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "We could not load learning material. Try again.";
const categoryName = (category: string) => categories.find((item) => item.value === category)?.label ?? category;

function BrandHeader({ onBack, onLogout, isLoggingOut }: {
  onBack: () => void;
  onLogout: () => void;
  isLoggingOut: boolean;
}) {
  return <header className="tl-topbar">
    <div className="tl-brand" aria-label="ISPlatty Technician Learning Center">
      <span className="tl-brand-mark" aria-hidden="true"><i /><i /><i /></span>
      <span className="tl-brand-copy"><strong>ISPlatty</strong><small>TECHNICIAN LEARNING</small></span>
    </div>
    <div className="tl-top-actions"><div className="tl-top-meta"><ShieldCheck size={15} /><span>Staff workspace · Field reference</span></div><button type="button" className="tl-account-link" onClick={onBack}><ArrowLeft size={14} /> My Staff account</button><button type="button" className="tl-signout" onClick={onLogout} disabled={isLoggingOut}>{isLoggingOut ? "Signing out…" : "Sign out"}</button></div>
  </header>;
}

function LoadingCards() {
  return <div className="tl-guide-list" role="status" aria-label="Loading guides">
    <div className="tl-skeleton" /><div className="tl-skeleton" /><div className="tl-skeleton" />
  </div>;
}

function GuideCard({ guide, onOpen }: { guide: TechnicianLearningGuide; onOpen: () => void }) {
  return <button type="button" className="tl-guide-card" onClick={onOpen}>
    <span className="tl-guide-accent" aria-hidden="true" />
    <span className="tl-guide-copy">
      <span className="tl-guide-meta"><span className="tl-category">{categoryName(guide.category)}</span>
        {guide.symptomTags.slice(0, 2).map((tag) => <span className="tl-tag" key={tag}>{tag}</span>)}</span>
      <h2>{guide.title}</h2><p>{guide.summary}</p>
      <span className="tl-guide-foot">
        {(guide.brands.length > 0 || guide.models.length > 0) && <span><Router size={12} /> {[...guide.brands, ...guide.models].slice(0, 3).join(" · ")}</span>}
        <span><FileText size={12} /> {guide.steps.length} field steps</span>
      </span>
    </span><ChevronRight className="tl-chevron" size={17} aria-hidden="true" />
  </button>;
}

function ModelReference({ query, onQuery, modelsQuery, models, selectedModel, onSelectModel }: {
  query: string; onQuery: (value: string) => void; modelsQuery: ReturnType<typeof useTechnicianModels>;
  models: import("./learning-types").TechnicianDeviceModel[]; selectedModel: string; onSelectModel: (value: string) => void;
}) {
  return <aside className="tl-side-panel">
    <div className="tl-panel-title"><h2>Device reference</h2><span>Published</span></div>
    <label className="tl-model-search">
      <Search size={14} />
      <input className="tl-control" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Find brand or model" aria-label="Search device models" />
    </label>
    {modelsQuery.isLoading ? <div className="tl-model-list" role="status"><div className="tl-skeleton" style={{ minHeight: 50 }} /><div className="tl-skeleton" style={{ minHeight: 50, marginTop: 8 }} /></div>
      : modelsQuery.isError ? <div className="tl-state" style={{ minHeight: 150, padding: 15 }}><div className="tl-state-inner"><p>{errorMessage(modelsQuery.error)}</p><button className="tl-button" onClick={() => void modelsQuery.refetch()}>Try again</button></div></div>
      : models.length === 0 ? <div className="tl-state" style={{ minHeight: 150, padding: 15 }}><div className="tl-state-inner"><span className="tl-state-icon"><Router size={18} /></span><h2>No matching models</h2><p>Try a shorter brand or model name.</p></div></div>
      : <div className="tl-model-list">{models.map((model) => <article className="tl-model-row" key={model.id}>
        <span className="tl-model-icon"><Router size={15} /></span><div><strong>{model.brand} {model.model}</strong>
          <small>{model.deviceType}{model.hardwareRevisions.length ? ` · ${model.hardwareRevisions.join(", ")}` : ""}</small>
          {model.firmwareVariants.length > 0 && <small>Firmware: {model.firmwareVariants.join(", ")}</small>}
          {model.imageUrl && <span className="tl-model-image"><img src={model.imageUrl} alt={model.imageCaption || `${model.brand} ${model.model} reference`} loading="lazy" referrerPolicy="no-referrer" />{model.imageCaption && <small>{model.imageCaption}</small>}</span>}
          {model.warning && <span className="tl-model-warning"><AlertTriangle size={13} />{model.warning}</span>}
          {model.manualUrl && <a className="tl-manual-link" href={model.manualUrl} target="_blank" rel="noreferrer">Manufacturer manual <ExternalLink size={12} /></a>}
          <button type="button" className="tl-model-select" onClick={() => onSelectModel(`${model.brand} ${model.model}`)}>
            {selectedModel === `${model.brand} ${model.model}` ? "Selected for guide search" : "Show guides for this device"}
          </button>
        </div>
      </article>)}</div>}
    <div className="tl-footnote"><Lightbulb size={15} /><span>Confirm exact model, hardware revision and firmware before following a port or configuration instruction.</span></div>
  </aside>;
}

function Diagram({ diagram }: { diagram: TechnicianDiagram }) {
  const label = diagram.labels;
  const common = { stroke: "#3b789e", strokeWidth: 2, fill: "none" };
  return <figure className="tl-diagram">
    <svg viewBox="0 0 320 130" role="img" aria-label={`${diagram.kind.replace("-", " ")} diagram: ${diagram.caption}`}>
      {diagram.kind === "router-ports" && <>
        <rect x="24" y="37" width="272" height="58" rx="10" fill="#e5f0f6" stroke="#4b83a3" strokeWidth="2" />
        <path d="M44 47v37M58 47v37M72 47v37M86 47v37" stroke="#91b3c7" strokeWidth="2" />
        {label.slice(0, 5).map((item, index) => <g key={`${item}-${index}`}><rect x={120 + index * 34} y="54" width="25" height="22" rx="3" fill={index === 0 ? "#f3cb81" : "#d2e4ef"} stroke="#5986a0" /><text x={132 + index * 34} y="68" textAnchor="middle" fontSize="7" fill="#234c68">{index + 1}</text></g>)}
        <text x="160" y="112" textAnchor="middle" fontSize="9" fill="#45677d">Port position varies by model / revision</text>
      </>}
      {diagram.kind === "pon-leds" && <>
        <rect x="35" y="28" width="250" height="72" rx="10" fill="#e8f1f5" stroke="#4b83a3" strokeWidth="2" />
        <path d="M52 45h216" stroke="#c4d6df" />
        {label.slice(0, 5).map((item, index) => <g key={`${item}-${index}`}><circle cx={72 + index * 44} cy="61" r="7" fill={index === 0 ? "#38a681" : "#e4b95c"} /><text x={72 + index * 44} y="84" textAnchor="middle" fontSize="7" fill="#234c68">{item.slice(0, 9)}</text></g>)}
      </>}
      {diagram.kind === "connection-path" && <>
        {[["ONT", 24], ["Router", 118], ["Client", 226]].map(([name, x]) => <g key={name}><rect x={Number(x)} y="44" width="70" height="42" rx="8" fill="#e4f0f6" stroke="#4b83a3" strokeWidth="2" /><text x={Number(x) + 35} y="69" textAnchor="middle" fontSize="10" fill="#234c68">{name}</text></g>)}
        <path d="M96 65h19m-5-5 5 5-5 5M188 65h34m-5-5 5 5-5 5" {...common} />
        <text x="160" y="108" textAnchor="middle" fontSize="8" fill="#45677d">{label.slice(0, 3).join(" → ")}</text>
      </>}
      {diagram.kind === "decision-tree" && <>
        <rect x="105" y="14" width="110" height="32" rx="7" fill="#e4f0f6" stroke="#4b83a3" strokeWidth="2" />
        <text x="160" y="34" textAnchor="middle" fontSize="9" fill="#234c68">{label[0] ?? "Observe symptom"}</text>
        <path d="M160 46v18M160 64H76v15m84-15h84v15" {...common} />
        <rect x="28" y="80" width="96" height="30" rx="6" fill="#e6f4ed" stroke="#51927c" /><rect x="196" y="80" width="96" height="30" rx="6" fill="#fff2dc" stroke="#c59442" />
        <text x="76" y="99" textAnchor="middle" fontSize="8" fill="#315d50">{label[1] ?? "Safe check"}</text><text x="244" y="99" textAnchor="middle" fontSize="8" fill="#795920">{label[2] ?? "Escalate"}</text>
      </>}
      {diagram.kind === "wifi-coverage" && <>
        <circle cx="160" cy="67" r="11" fill="#397da6" /><path d="M138 49a31 31 0 0 0 0 36M182 49a31 31 0 0 1 0 36M124 36a49 49 0 0 0 0 62M196 36a49 49 0 0 1 0 62" stroke="#62a0c3" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M55 107h210" stroke="#a4bdcb" strokeDasharray="3 4" /><text x="160" y="121" textAnchor="middle" fontSize="8" fill="#45677d">{label.slice(0, 3).join(" · ") || "Check signal from the client location"}</text>
      </>}
    </svg>
    <figcaption>{diagram.caption}</figcaption>
    <div className="tl-diagram-labels">{diagram.labels.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}</div>
  </figure>;
}

function GuideDetail({ guide, onBack }: { guide: TechnicianLearningGuide; onBack: () => void }) {
  return <section className="tl-detail">
    <button className="tl-back" onClick={onBack}><ArrowLeft size={14} /> Back to all guides</button>
    <header className="tl-detail-hero">
      <p className="tl-kicker">{categoryName(guide.category)} / Field guide</p><h1>{guide.title}</h1><p>{guide.summary}</p>
      <div className="tl-detail-badges">{[...guide.brands, ...guide.models].map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}{guide.symptomTags.map((tag) => <span key={tag}>{tag}</span>)}</div>
    </header>
    <div className="tl-detail-grid">
      <div className="tl-detail-main">
        {guide.imageUrl && <figure className="tl-guide-image"><img src={guide.imageUrl} alt={guide.imageCaption || guide.title} loading="lazy" referrerPolicy="no-referrer" /><figcaption>{guide.imageCaption || guide.title}</figcaption></figure>}
        {guide.warnings.length > 0 && <section className="tl-detail-section"><h2><AlertTriangle size={16} /> Safety before you begin</h2><ul className="tl-list">{guide.warnings.map((item, index) => <li key={`${item}-${index}`}><AlertTriangle size={14} color="#a64941" />{item}</li>)}</ul></section>}
        <section className="tl-detail-section"><h2><CheckCircle2 size={16} /> Work through the checks</h2>
          {guide.steps.map((step, index) => <article className="tl-step" key={`${step.title}-${index}`}><span className="tl-step-num">{String(index + 1).padStart(2, "0")}</span><div><h3>{step.title}</h3><p>{step.instruction}</p>{step.check && <p className="tl-step-check"><Check size={13} /> {step.check}</p>}{step.caution && <p className="tl-caution"><AlertTriangle size={13} />{step.caution}</p>}</div></article>)}
        </section>
        {guide.diagrams.length > 0 && <section className="tl-detail-section"><h2><Signal size={16} /> Reference diagrams</h2><div className="tl-array-grid">{guide.diagrams.map((diagram, index) => <Diagram key={`${diagram.kind}-${index}`} diagram={diagram} />)}</div></section>}
        {guide.safeChecks.length > 0 && <section className="tl-detail-section"><h2><ShieldCheck size={16} /> Safe checks</h2><ul className="tl-list">{guide.safeChecks.map((item, index) => <li key={`${item}-${index}`}><CheckCircle2 size={14} />{item}</li>)}</ul></section>}
      </div>
      <aside className="tl-side-stack">
        <section className="tl-detail-section"><h2><CircleHelp size={16} /> Likely causes</h2><ul className="tl-list">{guide.likelyCauses.map((item, index) => <li key={`${item}-${index}`}><ChevronRight size={13} />{item}</li>)}</ul></section>
        {guide.escalateWhen.length > 0 && <section className="tl-detail-section"><h2><ArrowUpRight size={16} /> Escalate when</h2><ul className="tl-list">{guide.escalateWhen.map((item, index) => <li key={`${item}-${index}`}><AlertTriangle size={13} color="#a64941" />{item}</li>)}</ul></section>}
        <section className="tl-detail-section"><h2><Wifi size={16} /> Hardware & firmware</h2><div className="tl-firmware">{guide.firmwareNotes || "No firmware-specific notes have been published."}</div>
          {guide.manualUrl && <a className="tl-manual-link" href={guide.manualUrl} target="_blank" rel="noreferrer">Open manufacturer manual <ExternalLink size={12} /></a>}</section>
        {guide.customerScript && <section className="tl-detail-section"><h2><BookOpen size={16} /> Explain it clearly</h2><div className="tl-script">“{guide.customerScript}”</div></section>}
      </aside>
    </div>
  </section>;
}

export default function TechnicianLearning({ username }: { username: string }) {
  const [, setLocation] = useLocation();
  const logout = useEmployeeLogout();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<TechnicianGuideCategory | "">("");
  const [brand, setBrand] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedSlug, setSelectedSlug] = useState("");
  const modelsQuery = useTechnicianModels(modelSearch);
  const models = (modelsQuery.data?.models ?? []) as import("./learning-types").TechnicianDeviceModel[];
  const guidesQuery = useTechnicianGuides({ query, category, brand: brand || undefined, model: selectedModel || undefined });
  const detailQuery = useTechnicianGuide(selectedSlug);
  const guideResults = (guidesQuery.data?.guides ?? []) as TechnicianLearningGuide[];
  const brands = Array.from(new Set(guideResults.flatMap((guide) => guide.brands))).sort();
  const selectedGuide = detailQuery.data?.guide as TechnicianLearningGuide | undefined;
  const returnToList = () => setSelectedSlug("");
  const selectModel = (value: string) => {
    setSelectedModel(value);
    setBrand("");
  };
  const signOut = () => logout.mutate(undefined, {
    onSuccess: () => setLocation("/staff/login"),
    onError: () => setLocation("/staff/login"),
  });
  const goBackToAccount = () => setLocation(
    personalizedStaffPath(username, "dashboard") ?? "/staff/dashboard",
  );

  return <main className="tl-page">
    <BrandHeader onBack={goBackToAccount} onLogout={signOut} isLoggingOut={logout.isPending} />
    <div className="tl-content">
      {!selectedSlug ? <>
        <header className="tl-heading"><div><p className="tl-kicker">Field knowledge · ISPLATTY network operations</p><h1>Technician Learning Center</h1><p>Practical checks for routers, Wi-Fi and fiber access. Confirm the device before changing its configuration.</p></div><div className="tl-live"><span /> Published guidance only</div></header>
        <section className="tl-toolbar" aria-label="Filter learning material">
          <label className="tl-search"><Search size={16} /><input className="tl-control" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search symptoms, fixes, or equipment" aria-label="Search learning guides" /></label>
          <select className="tl-control" value={category} onChange={(event) => setCategory(event.target.value as TechnicianGuideCategory | "")} aria-label="Filter by topic">{categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          <select className="tl-control" value={brand} onChange={(event) => setBrand(event.target.value)} aria-label="Filter by brand"><option value="">All brands</option>{brands.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select className="tl-control" value={selectedModel} onChange={(event) => selectModel(event.target.value)} aria-label="Filter by exact device model"><option value="">All models</option>{models.map((item) => <option key={item.id} value={`${item.brand} ${item.model}`}>{item.brand} {item.model}</option>)}</select>
        </section>
        <div className="tl-body-grid">
          <section>
            <div className="tl-results-head"><span>Field guides</span>{!guidesQuery.isLoading && !guidesQuery.isError && <span>{guideResults.length} results</span>}</div>
            {guidesQuery.isLoading ? <LoadingCards /> : guidesQuery.isError ? <div className="tl-state" role="alert"><div className="tl-state-inner"><span className="tl-state-icon"><CircleHelp size={19} /></span><h2>Guides are unavailable</h2><p>{errorMessage(guidesQuery.error)}</p><button className="tl-button" onClick={() => void guidesQuery.refetch()}>Retry</button></div></div>
              : guideResults.length === 0 ? <div className="tl-state"><div className="tl-state-inner"><span className="tl-state-icon"><Search size={18} /></span><h2>No published guides match</h2><p>Try another term or clear one of the filters. Draft and archived material is not shown here.</p><button className="tl-button" onClick={() => { setQuery(""); setCategory(""); setBrand(""); setSelectedModel(""); }}>Clear filters</button></div></div>
                : <div className="tl-guide-list">{guideResults.map((guide) => <GuideCard key={guide.id} guide={guide} onOpen={() => setSelectedSlug(guide.slug)} />)}</div>}
          </section>
          <ModelReference query={modelSearch} onQuery={setModelSearch} modelsQuery={modelsQuery} models={models} selectedModel={selectedModel} onSelectModel={selectModel} />
        </div>
      </> : detailQuery.isLoading ? <div className="tl-state" role="status"><div className="tl-state-inner"><div className="tl-skeleton" /><p>Loading field guide…</p></div></div>
        : detailQuery.isError ? <div className="tl-state" role="alert"><div className="tl-state-inner"><span className="tl-state-icon"><CircleHelp size={19} /></span><h2>Guide could not be opened</h2><p>{errorMessage(detailQuery.error)}</p><button className="tl-button" onClick={() => void detailQuery.refetch()}>Retry</button><button className="tl-back" onClick={returnToList}><ArrowLeft size={14} /> Return to guides</button></div></div>
          : selectedGuide ? <GuideDetail guide={selectedGuide} onBack={returnToList} /> : <div className="tl-state"><div className="tl-state-inner"><h2>Guide not available</h2><button className="tl-button" onClick={returnToList}>Return to guides</button></div></div>}
      <footer className="tl-footnote"><ShieldCheck size={15} /><span>Use published procedures only. If hardware, firmware or topology differs from the guide, pause and verify with the network lead before making a change.</span></footer>
    </div>
  </main>;
}
