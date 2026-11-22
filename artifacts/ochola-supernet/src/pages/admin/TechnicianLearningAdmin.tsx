import { useMemo, useState } from "react";
import {
  AlertTriangle, Archive, BookOpen, Check, ChevronRight, CircleAlert, FilePlus2,
  Plus, Radio, Router, Save, Server, Trash2,
} from "lucide-react";
// @ts-ignore -- the API package declarations predate these hooks; runtime exports are provided by its source barrel.
import { useAdminTechnicianGuides, useAdminTechnicianModels, useArchiveTechnicianGuide, useArchiveTechnicianModel, useCreateTechnicianGuide, useCreateTechnicianModel, useUpdateTechnicianGuide, useUpdateTechnicianModel } from "@workspace/api-client-react";
import type {
  TechnicianDiagram, TechnicianDeviceModel, TechnicianGuideCategory, TechnicianGuideStep,
  TechnicianLearningGuide,
} from "../technician/learning-types";
import "./../technician/technician-learning.css";

type StatusFilter = "draft" | "published" | "archived" | "all";
type Resource = "guides" | "models";
type GuideDraft = Omit<TechnicianLearningGuide, "id" | "updatedAt">;
type ModelDraft = Omit<TechnicianDeviceModel, "id" | "updatedAt">;
const categories: TechnicianGuideCategory[] = ["setup", "ports", "wireless", "recovery", "connectivity", "fiber", "customer-care"];
const errorText = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";
const emptyGuide = (): GuideDraft => ({
  slug: "", title: "", summary: "", category: "connectivity", brands: [], models: [], firmwareNotes: "",
  symptomTags: [], likelyCauses: [], safeChecks: [], escalateWhen: [], warnings: [], steps: [], diagrams: [],
  customerScript: "", manualUrl: null, imageUrl: null, imageCaption: "", status: "draft",
});
const emptyModel = (): ModelDraft => ({
  brand: "", model: "", deviceType: "", hardwareRevisions: [], firmwareVariants: [], notes: "", warning: "",
  manualUrl: null, imageUrl: null, imageCaption: "", diagram: null, status: "draft",
});
const splitLines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);
const joinLines = (value: string[]) => value.join("\n");
const makeDiagram = (): TechnicianDiagram => ({ kind: "connection-path", caption: "", labels: [] });

function BrandHeader() {
  return <header className="tl-topbar"><div className="tl-brand" aria-label="ISPlatty Technician Learning Center">
    <span className="tl-brand-mark" aria-hidden="true"><i /><i /><i /></span>
    <span className="tl-brand-copy"><strong>ISPlatty</strong><small>SUPER ADMIN · CONTENT</small></span>
  </div><div className="tl-top-actions"><div className="tl-top-meta"><Server size={15} /><span>Network knowledge management</span></div><a className="tl-signout" href="/employee/admin">Back to People Operations</a></div></header>;
}

function Field({ label, value, onChange, multiline = false, full = false, placeholder = "", type = "text", hint }: {
  label: string; value: string; onChange: (value: string) => void; multiline?: boolean; full?: boolean; placeholder?: string; type?: string; hint?: string;
}) {
  return <label className={`tla-field ${full ? "full" : ""}`}>{label}
    {multiline ? <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /> :
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />}
    {hint && <small>{hint}</small>}
  </label>;
}

function TextList({ title, value, onChange, hint }: { title: string; value: string[]; onChange: (value: string[]) => void; hint?: string }) {
  return <div className="tla-repeatable">
    {value.map((item, index) => <div className="tla-repeat-row" key={`${title}-${index}`}>
      <input aria-label={`${title} ${index + 1}`} value={item} onChange={(event) => onChange(value.map((current, at) => at === index ? event.target.value : current))} />
      <button type="button" aria-label={`Remove ${title} ${index + 1}`} onClick={() => onChange(value.filter((_, at) => at !== index))}><Trash2 size={13} /></button>
    </div>)}
    <button type="button" className="tla-add-row" onClick={() => onChange([...value, ""])}><Plus size={13} /> Add {title.toLowerCase()}</button>
    {hint && <small>{hint}</small>}
  </div>;
}

function DiagramEditor({ diagram, onChange }: { diagram: TechnicianDiagram; onChange: (value: TechnicianDiagram) => void }) {
  return <div className="tla-array-grid">
    <label className="tla-field">Diagram type<select value={diagram.kind} onChange={(event) => onChange({ ...diagram, kind: event.target.value as TechnicianDiagram["kind"] })}>
      {["router-ports", "pon-leds", "connection-path", "decision-tree", "wifi-coverage"].map((kind) => <option key={kind} value={kind}>{kind}</option>)}
    </select></label>
    <Field label="Caption" value={diagram.caption} onChange={(caption) => onChange({ ...diagram, caption })} placeholder="What this drawing explains" />
    <Field label="Labels (one per line)" value={joinLines(diagram.labels)} onChange={(value) => onChange({ ...diagram, labels: splitLines(value) })} multiline full placeholder={"ONT\nRouter\nClient"} />
  </div>;
}

function StepEditor({ steps, onChange }: { steps: TechnicianGuideStep[]; onChange: (steps: TechnicianGuideStep[]) => void }) {
  const patch = (index: number, updates: Partial<TechnicianGuideStep>) => onChange(steps.map((step, at) => at === index ? { ...step, ...updates } : step));
  return <div>
    {steps.map((step, index) => <div className="tla-step-editor" key={`step-${index}`}>
      <span className="tla-step-index">{String(index + 1).padStart(2, "0")}</span>
      <div className="tla-step-fields"><input value={step.title} onChange={(event) => patch(index, { title: event.target.value })} aria-label={`Step ${index + 1} title`} placeholder="Step title" />
        <textarea value={step.instruction} onChange={(event) => patch(index, { instruction: event.target.value })} aria-label={`Step ${index + 1} instruction`} placeholder="Clear instruction, one action at a time" />
        <input value={step.check ?? ""} onChange={(event) => patch(index, { check: event.target.value })} aria-label={`Step ${index + 1} confirmation`} placeholder="Expected result / confirmation (optional)" />
        <input value={step.caution ?? ""} onChange={(event) => patch(index, { caution: event.target.value })} aria-label={`Step ${index + 1} caution`} placeholder="Safety caution (optional)" />
      </div>
      <button type="button" className="tla-step-delete" aria-label={`Remove step ${index + 1}`} onClick={() => onChange(steps.filter((_, at) => at !== index))}><Trash2 size={13} /></button>
    </div>)}
    <button type="button" className="tla-add-row" style={{ marginTop: 8 }} onClick={() => onChange([...steps, { title: "", instruction: "", check: "", caution: "" }])}><Plus size={13} /> Add field step</button>
  </div>;
}

function GuideEditor({ draft, setDraft }: { draft: GuideDraft; setDraft: (value: GuideDraft) => void }) {
  const update = <K extends keyof GuideDraft>(key: K, value: GuideDraft[K]) => setDraft({ ...draft, [key]: value });
  return <div className="tla-form">
    <Field label="Guide title" value={draft.title} onChange={(value) => update("title", value)} placeholder="Short, task-focused title" />
    <Field label="Slug" value={draft.slug} onChange={(value) => update("slug", value)} placeholder="stable-guide-slug" hint="Use lowercase letters, numbers and hyphens." />
    <label className="tla-field">Category<select value={draft.category} onChange={(event) => update("category", event.target.value as TechnicianGuideCategory)}>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
    <Field label="Manual URL" value={draft.manualUrl ?? ""} onChange={(value) => update("manualUrl", value || null)} placeholder="https://…" type="url" />
    <Field label="Image URL (HTTPS)" value={draft.imageUrl ?? ""} onChange={(value) => update("imageUrl", value || null)} placeholder="https://…" type="url" hint="Use an accurate image for the exact model or revision. External image hosts can see a visitor request." />
    <Field label="Image caption" value={draft.imageCaption} onChange={(value) => update("imageCaption", value)} placeholder="State exact model/revision or mark as conceptual" />
    <Field label="Summary" value={draft.summary} onChange={(value) => update("summary", value)} multiline full placeholder="What will the technician diagnose or resolve?" />
    <div className="tla-form-section"><h3>Applicability</h3><div className="tla-array-grid">
      <Field label="Brands (one per line)" value={joinLines(draft.brands)} onChange={(value) => update("brands", splitLines(value))} multiline placeholder="MikroTik" />
      <Field label="Models (one per line)" value={joinLines(draft.models)} onChange={(value) => update("models", splitLines(value))} multiline placeholder="Exact model names" />
      <Field label="Firmware / revision notes" value={draft.firmwareNotes} onChange={(value) => update("firmwareNotes", value)} multiline full placeholder="State known differences explicitly. Do not assume one layout applies to every model." />
      <Field label="Symptoms (one per line)" value={joinLines(draft.symptomTags)} onChange={(value) => update("symptomTags", splitLines(value))} multiline />
    </div></div>
    <div className="tla-form-section"><h3>Field procedure</h3><StepEditor steps={draft.steps} onChange={(steps) => update("steps", steps)} /></div>
    <div className="tla-form-section"><h3>Causes, checks & escalation</h3><div className="tla-array-grid">
      <div className="tla-field">Likely causes<TextList title="Cause" value={draft.likelyCauses} onChange={(value) => update("likelyCauses", value)} /></div>
      <div className="tla-field">Safe checks<TextList title="Check" value={draft.safeChecks} onChange={(value) => update("safeChecks", value)} /></div>
      <div className="tla-field">Escalate when<TextList title="Escalation condition" value={draft.escalateWhen} onChange={(value) => update("escalateWhen", value)} /></div>
      <div className="tla-field">Warnings<TextList title="Warning" value={draft.warnings} onChange={(value) => update("warnings", value)} /></div>
    </div></div>
    <div className="tla-form-section"><h3>Original diagrams</h3>
      {draft.diagrams.map((diagram, index) => <div key={`diagram-${index}`} style={{ padding: "10px 0", borderTop: index ? "1px solid #e9eff3" : 0 }}>
        <DiagramEditor diagram={diagram} onChange={(value) => update("diagrams", draft.diagrams.map((current, at) => at === index ? value : current))} />
        <button type="button" className="tla-add-row" style={{ color: "#a34b46" }} onClick={() => update("diagrams", draft.diagrams.filter((_, at) => at !== index))}><Trash2 size={12} /> Remove diagram</button>
      </div>)}
      <button type="button" className="tla-add-row" onClick={() => update("diagrams", [...draft.diagrams, makeDiagram()])}><Plus size={13} /> Add diagram rendering</button>
    </div>
    <div className="tla-form-section"><h3>Customer explanation</h3><Field label="Plain-language script" value={draft.customerScript} onChange={(value) => update("customerScript", value)} multiline full placeholder="A concise explanation of what was checked and what was fixed." /></div>
  </div>;
}

function ModelEditor({ draft, setDraft }: { draft: ModelDraft; setDraft: (value: ModelDraft) => void }) {
  const update = <K extends keyof ModelDraft>(key: K, value: ModelDraft[K]) => setDraft({ ...draft, [key]: value });
  return <div className="tla-form">
    <Field label="Brand" value={draft.brand} onChange={(value) => update("brand", value)} placeholder="Manufacturer" />
    <Field label="Model" value={draft.model} onChange={(value) => update("model", value)} placeholder="Exact model designation" />
    <Field label="Device type" value={draft.deviceType} onChange={(value) => update("deviceType", value)} placeholder="Router / ONT / access point" />
    <Field label="Manual URL" value={draft.manualUrl ?? ""} onChange={(value) => update("manualUrl", value || null)} type="url" placeholder="https://…" />
    <Field label="Image URL (HTTPS)" value={draft.imageUrl ?? ""} onChange={(value) => update("imageUrl", value || null)} type="url" placeholder="https://…" hint="Link only a verified image for this exact model/revision." />
    <Field label="Image caption" value={draft.imageCaption} onChange={(value) => update("imageCaption", value)} placeholder="Model and hardware revision shown" />
    <Field label="Hardware revisions (one per line)" value={joinLines(draft.hardwareRevisions)} onChange={(value) => update("hardwareRevisions", splitLines(value))} multiline />
    <Field label="Firmware variants (one per line)" value={joinLines(draft.firmwareVariants)} onChange={(value) => update("firmwareVariants", splitLines(value))} multiline />
    <Field label="Technical notes" value={draft.notes} onChange={(value) => update("notes", value)} multiline full placeholder="Record model-specific port or firmware differences." />
    <Field label="Safety warning" value={draft.warning} onChange={(value) => update("warning", value)} multiline full placeholder="Model-qualified warning. Example: Tenda routed PPPoE deployments may use WAN; a Hotspot uplink typically needs a supported LAN/bridge path. Confirm exact model and AP/bridge support." />
    <div className="tla-form-section"><h3>Diagram data</h3>{draft.diagram ? <>
      <DiagramEditor diagram={draft.diagram} onChange={(diagram) => update("diagram", diagram)} />
      <button type="button" className="tla-add-row" style={{ color: "#a34b46", marginTop: 7 }} onClick={() => update("diagram", null)}><Trash2 size={12} /> Remove diagram</button>
    </> : <button type="button" className="tla-add-row" onClick={() => update("diagram", makeDiagram())}><Plus size={13} /> Add typed diagram</button>}
      <p className="tla-model-diagram-note">Diagrams are rendered from the selected diagram kind, caption and labels. Port positions are illustrative and must not be treated as model-specific unless documented.</p>
    </div>
  </div>;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`tla-status tla-status-${status}`}>{status}</span>;
}

export default function TechnicianLearningAdmin() {
  const [resource, setResource] = useState<Resource>("guides");
  const [status, setStatus] = useState<StatusFilter>("all");
  const guidesQuery = useAdminTechnicianGuides(status);
  const modelsQuery = useAdminTechnicianModels(status);
  const createGuide = useCreateTechnicianGuide();
  const updateGuide = useUpdateTechnicianGuide();
  const archiveGuide = useArchiveTechnicianGuide();
  const createModel = useCreateTechnicianModel();
  const updateModel = useUpdateTechnicianModel();
  const archiveModel = useArchiveTechnicianModel();
  const [selectedId, setSelectedId] = useState("");
  const [guideDraft, setGuideDraft] = useState<GuideDraft | null>(null);
  const [modelDraft, setModelDraft] = useState<ModelDraft | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const guides = (guidesQuery.data?.guides ?? []) as TechnicianLearningGuide[];
  const models = (modelsQuery.data?.models ?? []) as TechnicianDeviceModel[];
  const selectedGuide = useMemo(() => guides.find((guide) => guide.id === selectedId), [guides, selectedId]);
  const selectedModel = useMemo(() => models.find((model) => model.id === selectedId), [models, selectedId]);
  const loading = resource === "guides" ? guidesQuery.isLoading : modelsQuery.isLoading;
  const failed = resource === "guides" ? guidesQuery.isError : modelsQuery.isError;
  const retry = resource === "guides" ? guidesQuery.refetch : modelsQuery.refetch;

  const switchResource = (next: Resource) => { setResource(next); setSelectedId(""); setGuideDraft(null); setModelDraft(null); setError(""); setNotice(""); };
  const startNew = () => {
    setSelectedId(""); setError(""); setNotice("");
    if (resource === "guides") { setGuideDraft(emptyGuide()); setModelDraft(null); }
    else { setModelDraft(emptyModel()); setGuideDraft(null); }
  };
  const selectGuide = (guide: TechnicianLearningGuide) => {
    setSelectedId(guide.id);
    const { id: _id, updatedAt: _updatedAt, ...copy } = guide;
    setGuideDraft(structuredClone(copy)); setModelDraft(null); setError(""); setNotice("");
  };
  const selectModel = (model: TechnicianDeviceModel) => {
    setSelectedId(model.id);
    const { id: _id, updatedAt: _updatedAt, ...copy } = model;
    setModelDraft(structuredClone(copy)); setGuideDraft(null); setError(""); setNotice("");
  };
  const persistGuide = (nextStatus?: GuideDraft["status"]) => {
    if (!guideDraft) return;
    const payload: GuideDraft = { ...guideDraft, status: nextStatus ?? guideDraft.status };
    if (!payload.title.trim() || !payload.slug.trim() || !payload.summary.trim()) { setError("Title, slug and summary are required before saving."); return; }
    setError(""); setNotice("");
    const success = () => { setGuideDraft(payload); setNotice(nextStatus === "published" ? "Guide published." : "Guide saved."); };
    const failure = (reason: Error) => setError(errorText(reason));
    if (selectedId) updateGuide.mutate({ id: selectedId, guide: payload }, { onSuccess: success, onError: failure });
    else createGuide.mutate(payload, { onSuccess: (result: { guide: TechnicianLearningGuide }) => { setSelectedId(result.guide.id); setGuideDraft(payload); setNotice(nextStatus === "published" ? "Guide published." : "Guide created as a draft."); }, onError: failure });
  };
  const persistModel = (nextStatus?: ModelDraft["status"]) => {
    if (!modelDraft) return;
    const payload: ModelDraft = { ...modelDraft, status: nextStatus ?? modelDraft.status };
    if (!payload.brand.trim() || !payload.model.trim() || !payload.deviceType.trim()) { setError("Brand, model and device type are required before saving."); return; }
    setError(""); setNotice("");
    const success = () => { setModelDraft(payload); setNotice(nextStatus === "published" ? "Device model published." : "Device model saved."); };
    const failure = (reason: Error) => setError(errorText(reason));
    if (selectedId) updateModel.mutate({ id: selectedId, model: payload }, { onSuccess: success, onError: failure });
    else createModel.mutate(payload, { onSuccess: (result: { model: TechnicianDeviceModel }) => { setSelectedId(result.model.id); setModelDraft(payload); setNotice(nextStatus === "published" ? "Device model published." : "Device model created as a draft."); }, onError: failure });
  };
  const archiveSelected = () => {
    const label = resource === "guides" ? guideDraft?.title : modelDraft ? `${modelDraft.brand} ${modelDraft.model}` : "";
    if (!selectedId || !window.confirm(`Archive “${label}”? It will no longer appear in the technician learning center.`)) return;
    setError(""); setNotice("");
    if (resource === "guides") archiveGuide.mutate(selectedId, { onSuccess: () => { setNotice("Guide archived."); setSelectedId(""); setGuideDraft(null); }, onError: (reason: Error) => setError(errorText(reason)) });
    else archiveModel.mutate(selectedId, { onSuccess: () => { setNotice("Device model archived."); setSelectedId(""); setModelDraft(null); }, onError: (reason: Error) => setError(errorText(reason)) });
  };
  const busy = createGuide.isPending || updateGuide.isPending || createModel.isPending || updateModel.isPending || archiveGuide.isPending || archiveModel.isPending;

  return <main className="tl-page tla-page">
    <BrandHeader />
    <div className="tl-content tla-content">
      <header className="tl-heading tla-heading"><div><p className="tl-kicker">Super Admin · Knowledge operations</p><h1>Technician learning</h1><p>Maintain accurate field procedures and model-qualified equipment references.</p></div>
        <div className="tla-heading-actions"><button className="tl-button tl-button-primary" onClick={startNew}><FilePlus2 size={14} /> New {resource === "guides" ? "guide" : "device model"}</button></div>
      </header>
      <div className="tla-console">
        <section className="tla-list-panel" aria-label="Content records">
          <div className="tla-resource-switch"><button className={resource === "guides" ? "is-active" : ""} onClick={() => switchResource("guides")}><BookOpen size={12} /> Guides</button><button className={resource === "models" ? "is-active" : ""} onClick={() => switchResource("models")}><Router size={12} /> Device models</button></div>
          <div className="tla-tabs" role="tablist" aria-label="Filter records by status">{(["all", "draft", "published", "archived"] as StatusFilter[]).map((item) => <button key={item} role="tab" aria-selected={status === item} className={`tla-tab ${status === item ? "is-active" : ""}`} onClick={() => { setStatus(item); setSelectedId(""); setGuideDraft(null); setModelDraft(null); }}>{item}</button>)}</div>
          {loading ? <div className="tla-list-items" role="status"><div className="tl-skeleton" /><div className="tl-skeleton" style={{ marginTop: 8 }} /></div>
            : failed ? <div className="tl-state" role="alert" style={{ border: 0, minHeight: 210 }}><div className="tl-state-inner"><span className="tl-state-icon"><CircleAlert size={18} /></span><h2>Records could not load</h2><p>{errorText(resource === "guides" ? guidesQuery.error : modelsQuery.error)}</p><button className="tl-button" onClick={() => void retry()}>Retry</button></div></div>
              : <div className="tla-list-items">{resource === "guides" ? guides.map((guide) => <button key={guide.id} className={`tla-item ${selectedId === guide.id ? "is-selected" : ""}`} onClick={() => selectGuide(guide)}>
                <span className="tla-item-icon"><BookOpen size={14} /></span><span className="tla-item-copy"><strong>{guide.title || "Untitled guide"}</strong><small>{guide.category} · updated {new Date(guide.updatedAt).toLocaleDateString()}</small></span><StatusBadge status={guide.status} />
              </button>) : models.map((model) => <button key={model.id} className={`tla-item ${selectedId === model.id ? "is-selected" : ""}`} onClick={() => selectModel(model)}>
                <span className="tla-item-icon"><Router size={14} /></span><span className="tla-item-copy"><strong>{model.brand} {model.model}</strong><small>{model.deviceType} · {model.hardwareRevisions.join(", ") || "revision not specified"}</small></span><StatusBadge status={model.status} />
              </button>)}
              {(resource === "guides" ? guides.length : models.length) === 0 && <div className="tl-state" style={{ minHeight: 195, border: 0 }}><div className="tl-state-inner"><span className="tl-state-icon"><BookOpen size={18} /></span><h2>No {status} {resource} yet</h2><p>Create a draft to start documenting verified field knowledge.</p><button className="tl-button" onClick={startNew}><Plus size={13} /> Create first record</button></div></div>}</div>}
        </section>
        <section className={`tla-editor ${!guideDraft && !modelDraft ? "tla-editor-empty" : ""}`} aria-label="Edit content">
          {!guideDraft && !modelDraft ? <div className="tl-state" style={{ border: 0, minHeight: 300 }}><div className="tl-state-inner"><span className="tl-state-icon"><ChevronRight size={18} /></span><h2>Select a record to edit</h2><p>Choose a guide or model from the list, or create a new draft.</p><button className="tl-button" onClick={startNew}><Plus size={13} /> New {resource === "guides" ? "guide" : "model"}</button></div></div> :
            <>
              <div className="tla-editor-head"><div><h2>{guideDraft ? guideDraft.title || (selectedId ? "Edit guide" : "New guide") : modelDraft ? `${modelDraft.brand} ${modelDraft.model}`.trim() || (selectedId ? "Edit device model" : "New device model") : ""}</h2><p>{selectedId ? "Changes are saved to the learning API." : "New records start as drafts and are not visible to technicians."}</p></div>
                <div className="tla-actions">{selectedId && <button className="tl-button" onClick={archiveSelected} disabled={busy}><Archive size={13} /> Archive</button>}</div>
              </div>
              {guideDraft ? <GuideEditor draft={guideDraft} setDraft={setGuideDraft} /> : modelDraft ? <ModelEditor draft={modelDraft} setDraft={setModelDraft} /> : null}
              {error && <div className="tla-error" role="alert"><AlertTriangle size={13} /> {error}</div>}
              <div className="tla-editor-footer"><span className="tla-feedback" role="status">{notice || (selectedGuide || selectedModel ? `Current status: ${(selectedGuide ?? selectedModel)?.status}` : "Unsaved draft")}</span>
                <div className="tla-actions">
                  <button className="tl-button" disabled={busy} onClick={() => guideDraft ? persistGuide("draft") : persistModel("draft")}><Save size={13} />{busy ? "Saving…" : "Save draft"}</button>
                  <button className="tl-button tl-button-primary" disabled={busy} onClick={() => guideDraft ? persistGuide("published") : persistModel("published")}><Check size={14} />{busy ? "Saving…" : "Save & publish"}</button>
                </div>
              </div>
            </>}
        </section>
      </div>
      <div className="tl-footnote"><AlertTriangle size={15} /><span>Review model, hardware revision and firmware distinctions before publishing. For Tenda, qualify WAN guidance by design: routed PPPoE may use WAN; Hotspot uplink typically needs a supported LAN/bridge path. Confirm exact model and AP/bridge support. External image URLs load directly in the viewer and should point only to approved public reference images.</span></div>
    </div>
  </main>;
}
