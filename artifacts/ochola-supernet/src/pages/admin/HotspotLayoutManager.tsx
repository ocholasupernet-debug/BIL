import React, { useEffect, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  ExternalLink,
  Eye,
  LayoutTemplate,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  Radio,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Wifi,
  X,
} from "lucide-react";

export type HotspotLayoutEntry = {
  id: string;
  name: string;
  version: string;
  description: string;
  availability: "available" | "active" | "archived";
  previewUrl?: string;
  isBuiltIn: boolean;
  canDuplicate: boolean;
  canArchive: boolean;
};

export type HotspotDeploymentHistoryEntry = {
  date: string;
  layout: string;
  version: string;
  status: string;
  router: string;
};

export type HotspotLayoutManagerProps = {
  layouts: HotspotLayoutEntry[];
  selectedLayoutId: string | null;
  deployment: {
    routerName: string;
    hotspotName: string;
    selectedLayout: string | null;
    installedLayout: string | null;
    syncStatus: string;
    lastSuccessfulSync: string | null;
  };
  history: HotspotDeploymentHistoryEntry[];
  state: {
    loading: boolean;
    error: string | null;
    busy: boolean;
  };
  selectLayout: (id: string) => void;
  previewLayout: (id: string, viewport: "desktop" | "mobile" | "fullscreen") => void;
  duplicateLayout: (id: string) => void;
  archiveLayout: (id: string) => void;
  restoreLayout: (id: string) => void;
  confirmDeploy: () => void | Promise<void>;
};

type PreviewState = {
  id: string;
  viewport: "desktop" | "mobile" | "fullscreen";
};

const statusLabel = (value: string) =>
  value.replace(/[-_]/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function LayoutArtwork({ index, active }: { index: number; active: boolean }) {
  const schemes = [
    { base: "#e7eee7", surface: "#fbfcf8", ink: "#24463f", accent: "#c66d4e" },
    { base: "#dfeaf0", surface: "#f8fbfc", ink: "#244459", accent: "#4c8ca7" },
    { base: "#e7e5dc", surface: "#f9f7ef", ink: "#45433a", accent: "#9b8460" },
    { base: "#dce8e4", surface: "#f5f9f7", ink: "#29483e", accent: "#4b8872" },
  ];
  const scheme = schemes[index % schemes.length];
  return (
    <div className={`hlm-art${active ? " hlm-art--active" : ""}`} style={{ background: scheme.base }}>
      <div className="hlm-art-topline">
        <span className="hlm-art-brand"><i style={{ background: scheme.accent }} /> guest Wi-Fi</span>
        <span className="hlm-art-menu"><i /><i /><i /></span>
      </div>
      <div className="hlm-art-layout">
        <div className="hlm-art-welcome">
          <span className="hlm-art-kicker" style={{ color: scheme.accent }}>WELCOME ONLINE</span>
          <span className="hlm-art-title" style={{ color: scheme.ink }}>A better<br />connection.</span>
          <span className="hlm-art-line" style={{ background: scheme.ink }} />
          <span className="hlm-art-subline" />
          <span className="hlm-art-subline hlm-art-subline--short" />
        </div>
        <div className="hlm-art-plans" style={{ background: scheme.surface }}>
          <span className="hlm-art-plans-heading" style={{ color: scheme.ink }}>Choose a plan</span>
          <span className="hlm-art-plan" style={{ borderColor: `${scheme.accent}55` }}>
            <i style={{ background: `${scheme.accent}24` }} /><b /><em />
          </span>
          <span className="hlm-art-plan"><i /><b /><em /></span>
          <span className="hlm-art-button" style={{ background: scheme.accent }} />
        </div>
      </div>
      <span className="hlm-art-footer"><i style={{ background: scheme.accent }} /> secure guest access</span>
    </div>
  );
}

export function HotspotLayoutManager({
  layouts,
  selectedLayoutId,
  deployment,
  history,
  state,
  selectLayout,
  previewLayout,
  duplicateLayout,
  archiveLayout,
  restoreLayout,
  confirmDeploy,
}: HotspotLayoutManagerProps) {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const selectedLayout = layouts.find(layout => layout.id === selectedLayoutId);
  const selectedDiffersFromInstalled =
    !!selectedLayout && !!deployment.installedLayout && selectedLayout.name !== deployment.installedLayout;
  const previewLayoutEntry = preview ? layouts.find(layout => layout.id === preview.id) : undefined;
  const canDeploy = !!selectedLayout && selectedLayout.availability !== "archived" && !state.busy && !deploying;

  useEffect(() => {
    if (!preview) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [preview]);

  const openPreview = (id: string, viewport: PreviewState["viewport"]) => {
    previewLayout(id, viewport);
    setPreview({ id, viewport });
  };

  const runDeploy = async () => {
    setDeploying(true);
    try {
      await confirmDeploy();
      setConfirmOpen(false);
    } finally {
      setDeploying(false);
    }
  };

  return (
    <section className="hlm" aria-labelledby="hlm-title">
      <style>{`
        .hlm{--hlm-ink:#203b3d;--hlm-muted:#718180;--hlm-line:#dce5e0;--hlm-paper:#f5f8f4;--hlm-panel:#fffefa;--hlm-teal:#26776b;--hlm-teal-dark:#1b5e55;--hlm-amber:#a76d35;color:var(--hlm-ink);font-family:inherit}
        .hlm *{box-sizing:border-box}
        .hlm button{font:inherit}
        .hlm-shell{max-width:1440px;margin:0 auto;padding:clamp(18px,3vw,38px);background:var(--hlm-paper);border:1px solid #e4ebe5;border-radius:22px}
        .hlm-head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:26px}
        .hlm-eyebrow{display:flex;align-items:center;gap:8px;color:var(--hlm-teal);font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
        .hlm-eyebrow svg{width:15px;height:15px}
        .hlm h1{margin:9px 0 7px;font-size:clamp(25px,3vw,34px);line-height:1.12;letter-spacing:-.045em;font-weight:750}
        .hlm-lead{max-width:670px;margin:0;color:var(--hlm-muted);font-size:14px;line-height:1.65}
        .hlm-context{min-width:215px;padding:13px 15px;border:1px solid var(--hlm-line);border-radius:12px;background:#fbfcf8}
        .hlm-context-label{display:block;margin-bottom:7px;color:#899693;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
        .hlm-context strong{display:flex;align-items:center;gap:8px;font-size:13px}
        .hlm-context strong svg{width:15px;height:15px;color:var(--hlm-teal)}
        .hlm-context small{display:block;margin:5px 0 0 23px;color:var(--hlm-muted);font-size:11px}
        .hlm-error{display:flex;align-items:flex-start;gap:10px;margin:0 0 20px;padding:13px 15px;border:1px solid #efd0c8;border-radius:11px;background:#fff6f2;color:#874634;font-size:13px;line-height:1.5}
        .hlm-error svg{flex:0 0 auto;width:17px;height:17px;margin-top:1px}
        .hlm-section-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin:0 0 14px}
        .hlm-section-heading h2{margin:0;font-size:17px;letter-spacing:-.025em}
        .hlm-section-heading p{margin:5px 0 0;color:var(--hlm-muted);font-size:12px}
        .hlm-count{color:#8a9793;font-size:11px;font-weight:700;white-space:nowrap}
        .hlm-layouts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
        .hlm-card{min-width:0;overflow:hidden;border:1px solid var(--hlm-line);border-radius:15px;background:var(--hlm-panel);transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}
        .hlm-card:hover{transform:translateY(-2px);border-color:#b8d1c8;box-shadow:0 9px 25px rgba(38,76,66,.07)}
        .hlm-card--selected{border-color:var(--hlm-teal);box-shadow:0 0 0 2px rgba(38,119,107,.12)}
        .hlm-card--archived{opacity:.78}
        .hlm-art{position:relative;display:flex;flex-direction:column;height:173px;padding:13px 15px 10px;overflow:hidden}
        .hlm-art:after{position:absolute;inset:0;content:"";pointer-events:none;background:linear-gradient(125deg,rgba(255,255,255,.15),transparent 40%,rgba(26,51,45,.04))}
        .hlm-art-topline,.hlm-art-brand,.hlm-art-menu,.hlm-art-layout,.hlm-art-footer{position:relative;z-index:1}
        .hlm-art-topline{display:flex;justify-content:space-between;align-items:center}
        .hlm-art-brand{display:flex;align-items:center;gap:6px;color:#36524c;font-size:8px;font-weight:800;letter-spacing:.02em}
        .hlm-art-brand i,.hlm-art-footer i{width:9px;height:9px;border-radius:3px}
        .hlm-art-menu{display:flex;gap:3px}.hlm-art-menu i{width:3px;height:3px;border-radius:50%;background:#71817a}
        .hlm-art-layout{display:grid;grid-template-columns:1.1fr .9fr;gap:13px;align-items:center;flex:1;padding:9px 12px}
        .hlm-art-welcome{display:flex;flex-direction:column;align-items:flex-start}
        .hlm-art-kicker{font-size:6px;font-weight:900;letter-spacing:.13em}
        .hlm-art-title{margin:5px 0 7px;font-family:Georgia,serif;font-size:19px;font-weight:700;line-height:.98;letter-spacing:-.05em}
        .hlm-art-line{width:29px;height:2px;border-radius:3px;opacity:.65}
        .hlm-art-subline{width:79%;height:3px;margin-top:5px;border-radius:4px;background:rgba(45,72,62,.17)}
        .hlm-art-subline--short{width:53%;margin-top:3px}
        .hlm-art-plans{padding:9px 8px;border-radius:8px;box-shadow:0 4px 12px rgba(34,57,48,.08)}
        .hlm-art-plans-heading{display:block;margin-bottom:6px;font-size:7px;font-weight:800}
        .hlm-art-plan{display:flex;align-items:center;gap:5px;height:20px;margin-top:4px;padding:3px 5px;border:1px solid rgba(56,78,67,.1);border-radius:5px;background:rgba(255,255,255,.65)}
        .hlm-art-plan i{width:10px;height:10px;border-radius:3px;background:rgba(64,105,87,.14)}
        .hlm-art-plan b{width:34%;height:4px;border-radius:4px;background:rgba(49,75,64,.25)}
        .hlm-art-plan em{width:16%;height:4px;margin-left:auto;border-radius:4px;background:rgba(49,75,64,.16)}
        .hlm-art-button{display:block;height:12px;margin-top:6px;border-radius:4px}
        .hlm-art-footer{display:flex;align-items:center;gap:5px;color:#687b72;font-size:6px;font-weight:700}
        .hlm-art-footer i{width:5px;height:5px;border-radius:50%}
        .hlm-card-body{padding:14px 15px 13px}
        .hlm-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:9px}
        .hlm-card-title{display:flex;align-items:center;gap:7px;min-width:0}
        .hlm-card-title h3{overflow:hidden;margin:0;font-size:14px;letter-spacing:-.02em;text-overflow:ellipsis;white-space:nowrap}
        .hlm-selected-mark{display:inline-grid;flex:0 0 auto;width:18px;height:18px;place-items:center;border-radius:50%;background:#e1f0e9;color:#287563}
        .hlm-selected-mark svg{width:12px;height:12px}
        .hlm-badge{display:inline-flex;align-items:center;gap:5px;padding:4px 7px;border-radius:99px;background:#eef2ed;color:#657670;font-size:9px;font-weight:800;letter-spacing:.035em;white-space:nowrap}
        .hlm-badge--active{background:#e4f2ea;color:#28725e}.hlm-badge--archived{background:#f0eeea;color:#77736c}
        .hlm-version{margin-top:5px;color:#8a9691;font-size:10px}
        .hlm-description{display:-webkit-box;min-height:35px;overflow:hidden;margin:10px 0 13px;color:#71807c;font-size:11px;line-height:1.55;-webkit-box-orient:vertical;-webkit-line-clamp:2}
        .hlm-card-actions{display:flex;align-items:center;gap:7px}
        .hlm-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:34px;padding:0 10px;border:1px solid #d8e2dc;border-radius:8px;background:#fffefa;color:#3b5751;font-size:11px;font-weight:750;cursor:pointer;transition:background .15s ease,border-color .15s ease,color .15s ease}
        .hlm-btn:hover:not(:disabled){border-color:#a9c7bb;background:#f3f8f3}
        .hlm-btn:disabled{cursor:not-allowed;opacity:.52}
        .hlm-btn svg{width:14px;height:14px}
        .hlm-btn--select{flex:1;background:#e7f2ec;border-color:#d1e5d9;color:#246b5d}
        .hlm-btn--select:hover:not(:disabled){background:#dceee3}
        .hlm-btn--icon{width:34px;padding:0}
        .hlm-btn--danger{color:#8b554b}
        .hlm-loading{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
        .hlm-skeleton{height:307px;border:1px solid var(--hlm-line);border-radius:15px;background:linear-gradient(100deg,#edf1eb 25%,#f7f8f4 38%,#edf1eb 62%);background-size:300% 100%;animation:hlm-shimmer 1.4s ease infinite}
        @keyframes hlm-shimmer{to{background-position:-150% 0}}
        .hlm-empty{display:flex;min-height:170px;flex-direction:column;align-items:center;justify-content:center;border:1px dashed #cbd9d1;border-radius:14px;background:#fafbf8;text-align:center}
        .hlm-empty-icon{display:grid;width:39px;height:39px;place-items:center;border-radius:12px;background:#e9f1eb;color:var(--hlm-teal)}
        .hlm-empty-icon svg{width:19px;height:19px}
        .hlm-empty strong{margin-top:10px;font-size:13px}.hlm-empty span{margin-top:4px;color:var(--hlm-muted);font-size:11px}
        .hlm-deploy{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:20px;margin-top:26px;padding:19px 21px;border:1px solid #cfe0d8;border-radius:15px;background:linear-gradient(105deg,#edf5ee,#f7f8f0)}
        .hlm-deploy-main{display:flex;align-items:flex-start;gap:13px}
        .hlm-deploy-icon{display:grid;flex:0 0 auto;width:39px;height:39px;place-items:center;border-radius:11px;background:#dcece2;color:#327466}
        .hlm-deploy-icon svg{width:19px;height:19px}
        .hlm-deploy-copy h2{margin:1px 0 5px;font-size:15px;letter-spacing:-.02em}
        .hlm-deploy-copy p{margin:0;color:#6b7d76;font-size:11px;line-height:1.6}
        .hlm-deploy-copy strong{color:#35574e}
        .hlm-sync-line{display:flex;align-items:center;gap:6px;margin-top:8px;color:#73847d;font-size:10px}
        .hlm-sync-line svg{width:13px;height:13px;color:#45816c}
        .hlm-deploy-action{display:flex;flex-direction:column;align-items:flex-end;gap:7px}
        .hlm-btn--deploy{min-height:40px;padding:0 16px;border-color:var(--hlm-teal);background:var(--hlm-teal);color:white;font-size:12px}
        .hlm-btn--deploy:hover:not(:disabled){border-color:var(--hlm-teal-dark);background:var(--hlm-teal-dark);color:white}
        .hlm-deploy-note{color:#83918b;font-size:9px}
        .hlm-lower{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,.8fr);gap:16px;margin-top:19px}
        .hlm-panel{min-width:0;padding:17px 18px;border:1px solid var(--hlm-line);border-radius:14px;background:var(--hlm-panel)}
        .hlm-panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:13px}
        .hlm-panel-head h2{display:flex;align-items:center;gap:8px;margin:0;font-size:14px;letter-spacing:-.02em}
        .hlm-panel-head h2 svg{width:16px;height:16px;color:var(--hlm-teal)}
        .hlm-panel-head span{color:#889590;font-size:10px}
        .hlm-manager-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 0;border-top:1px solid #edf0eb}
        .hlm-manager-row:first-of-type{border-top:0}
        .hlm-manager-key{display:block;color:#899590;font-size:9px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}
        .hlm-manager-value{display:flex;align-items:center;gap:7px;margin-top:4px;font-size:11px;font-weight:700}
        .hlm-manager-value svg{width:13px;height:13px;color:#568372}
        .hlm-sync-status{display:inline-flex;align-items:center;gap:5px;padding:5px 8px;border-radius:99px;background:#e8f2e9;color:#33715d;font-size:9px;font-weight:800}
        .hlm-sync-status:before{width:6px;height:6px;border-radius:50%;background:#529273;content:""}
        .hlm-history{width:100%;border-collapse:collapse;text-align:left}
        .hlm-history th{padding:0 7px 9px;color:#87938e;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
        .hlm-history td{padding:9px 7px;border-top:1px solid #edf0eb;color:#50635d;font-size:10px;vertical-align:middle}
        .hlm-history td:first-child{padding-left:0;white-space:nowrap}
        .hlm-history td:last-child,.hlm-history th:last-child{padding-right:0}
        .hlm-history-name{color:#304a43;font-weight:750}
        .hlm-history-version{display:block;margin-top:3px;color:#8b9691;font-size:9px}
        .hlm-history-status{display:inline-flex;align-items:center;padding:4px 6px;border-radius:6px;background:#edf3ed;color:#57776b;font-size:9px;font-weight:750}
        .hlm-history-empty{padding:20px 0;color:#8a9691;font-size:11px;text-align:center}
        .hlm-modal-backdrop{position:fixed;z-index:1000;inset:0;display:grid;place-items:center;padding:20px;background:rgba(23,41,38,.58);backdrop-filter:blur(5px)}
        .hlm-modal{display:flex;width:min(100%,1020px);max-height:min(92dvh,900px);flex-direction:column;overflow:hidden;border:1px solid rgba(255,255,255,.62);border-radius:17px;background:#f5f8f4;box-shadow:0 30px 90px rgba(15,34,30,.28)}
        .hlm-modal--mobile{width:min(100%,690px)}
        .hlm-modal--fullscreen{width:100%;height:100%;max-height:none;border-radius:12px}
        .hlm-modal-header{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:14px 18px;border-bottom:1px solid #dce5e0;background:#fffefa}
        .hlm-modal-title{display:flex;align-items:center;gap:10px;min-width:0}
        .hlm-modal-title h2{overflow:hidden;margin:0;font-size:14px;text-overflow:ellipsis;white-space:nowrap}
        .hlm-modal-title span{display:block;margin-top:3px;color:#7c8984;font-size:10px}
        .hlm-view-controls{display:flex;align-items:center;gap:5px;padding:3px;border:1px solid #e0e7e1;border-radius:9px;background:#f4f6f2}
        .hlm-view-controls button{display:inline-flex;align-items:center;gap:5px;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:#788680;font-size:10px;font-weight:750;cursor:pointer}
        .hlm-view-controls button[aria-pressed="true"]{background:#fffefa;color:#31695e;box-shadow:0 1px 3px rgba(31,59,50,.12)}
        .hlm-view-controls svg{width:13px;height:13px}
        .hlm-close{display:grid;flex:0 0 auto;width:32px;height:32px;place-items:center;border:1px solid #dce5e0;border-radius:8px;background:#fffefa;color:#526963;cursor:pointer}
        .hlm-close svg{width:16px;height:16px}
        .hlm-preview-stage{display:grid;flex:1;min-height:340px;place-items:center;overflow:auto;padding:22px;background:#e9efea}
        .hlm-preview-frame{width:100%;height:min(68vh,690px);min-height:320px;border:1px solid #cfdad2;border-radius:9px;background:#fff;box-shadow:0 15px 36px rgba(36,57,48,.13)}
        .hlm-preview-frame--mobile{width:min(375px,100%);height:min(720px,70vh);min-height:480px;border:7px solid #29453f;border-radius:27px}
        .hlm-preview-missing{max-width:360px;text-align:center}
        .hlm-preview-missing .hlm-empty-icon{margin:0 auto}
        .hlm-preview-missing p{color:#75827d;font-size:11px;line-height:1.6}
        .hlm-modal-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;border-top:1px solid #dce5e0;background:#fffefa;color:#87928c;font-size:10px}
        .hlm-modal-footer a{display:inline-flex;align-items:center;gap:5px;color:#347568;font-weight:750;text-decoration:none}
        .hlm-modal-footer a svg{width:12px;height:12px}
        .hlm-confirm{width:min(100%,470px);padding:25px;border:1px solid #dce5e0;border-radius:17px;background:#fffefa;box-shadow:0 24px 75px rgba(15,34,30,.25)}
        .hlm-confirm-icon{display:grid;width:43px;height:43px;place-items:center;border-radius:13px;background:#f8eadb;color:#a56b32}
        .hlm-confirm-icon svg{width:21px;height:21px}
        .hlm-confirm h2{margin:16px 0 7px;font-size:20px;letter-spacing:-.035em}
        .hlm-confirm p{margin:0;color:#70807a;font-size:12px;line-height:1.7}
        .hlm-confirm-swap{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;margin:18px 0;padding:12px;border:1px solid #e1e8e2;border-radius:10px;background:#f7f9f5}
        .hlm-confirm-swap span{display:block;color:#87928d;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
        .hlm-confirm-swap strong{display:block;margin-top:5px;color:#344f47;font-size:11px}
        .hlm-confirm-swap svg{width:15px;height:15px;color:#7f9188}
        .hlm-confirm-warning{display:flex;gap:8px;color:#8b6743!important}
        .hlm-confirm-warning svg{flex:0 0 auto;width:15px;height:15px;margin-top:2px}
        .hlm-confirm-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
        .hlm-btn--confirm{border-color:#b0763d;background:#a97037;color:#fff}
        .hlm-btn--confirm:hover:not(:disabled){border-color:#8c5b2c;background:#8c5b2c;color:#fff}
        .hlm-btn:focus-visible,.hlm-close:focus-visible,.hlm-view-controls button:focus-visible{outline:3px solid rgba(38,119,107,.28);outline-offset:2px}
        @media(max-width:1000px){.hlm-layouts,.hlm-loading{grid-template-columns:repeat(2,minmax(0,1fr))}.hlm-lower{grid-template-columns:1fr}}
        @media(max-width:680px){.hlm-shell{padding:17px;border-radius:16px}.hlm-head{flex-direction:column}.hlm-context{width:100%}.hlm-layouts,.hlm-loading{grid-template-columns:1fr}.hlm-art{height:190px}.hlm-deploy{grid-template-columns:1fr}.hlm-deploy-action{align-items:stretch}.hlm-deploy-action .hlm-btn{width:100%}.hlm-deploy-note{text-align:center}.hlm-panel{padding:15px}.hlm-history{min-width:510px}.hlm-history-wrap{overflow-x:auto}.hlm-modal-backdrop{padding:8px}.hlm-modal-header{flex-wrap:wrap;padding:12px}.hlm-modal-title{flex:1}.hlm-view-controls{order:3;width:100%;justify-content:center}.hlm-view-controls button{flex:1;justify-content:center}.hlm-preview-stage{min-height:300px;padding:12px}.hlm-modal-footer{padding:10px;flex-wrap:wrap}.hlm-confirm{padding:20px}.hlm-confirm-swap{grid-template-columns:1fr auto 1fr;gap:6px;padding:10px}.hlm-confirm-swap strong{font-size:10px}}
        @media(prefers-reduced-motion:reduce){.hlm *, .hlm *:before,.hlm *:after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-duration:.01ms!important}}
      `}</style>
      <div className="hlm-shell">
        <header className="hlm-head">
          <div>
            <div className="hlm-eyebrow"><LayoutTemplate aria-hidden="true" /> Hotspot settings <ChevronRight aria-hidden="true" /> Portal layouts</div>
            <h1 id="hlm-title">Hotspot layout manager</h1>
            <p className="hlm-lead">Choose the guest sign-in experience for this hotspot, review it at each screen size, and deploy it to the connected router.</p>
          </div>
          <div className="hlm-context" aria-label="Current hotspot context">
            <span className="hlm-context-label">Deployment target</span>
            <strong><Radio aria-hidden="true" /> {deployment.routerName || "Router not selected"}</strong>
            <small>{deployment.hotspotName || "Hotspot not selected"}</small>
          </div>
        </header>

        {state.error && (
          <div className="hlm-error" role="alert">
            <ShieldCheck aria-hidden="true" />
            <span><strong>Layout manager needs attention.</strong> {state.error}</span>
          </div>
        )}

        <section aria-labelledby="hlm-gallery-title">
          <div className="hlm-section-heading">
            <div>
              <h2 id="hlm-gallery-title">Available layouts</h2>
              <p>Select a layout to stage it for this hotspot. Preview before deploying.</p>
            </div>
            {!state.loading && <span className="hlm-count">{layouts.length} {layouts.length === 1 ? "layout" : "layouts"}</span>}
          </div>

          {state.loading ? (
            <div className="hlm-loading" aria-label="Loading hotspot layouts" role="status">
              <div className="hlm-skeleton" /><div className="hlm-skeleton" /><div className="hlm-skeleton" />
            </div>
          ) : layouts.length === 0 ? (
            <div className="hlm-empty">
              <div className="hlm-empty-icon"><LayoutTemplate aria-hidden="true" /></div>
              <strong>No layouts available</strong>
              <span>Layouts assigned to this account will appear here.</span>
            </div>
          ) : (
            <div className="hlm-layouts" role="list" aria-label="Hotspot portal layouts">
              {layouts.map((layout, index) => {
                const isSelected = layout.id === selectedLayoutId;
                const badge = layout.availability === "active"
                  ? "Active"
                  : layout.availability === "archived" ? "Archived" : "Available";
                return (
                  <article
                    className={`hlm-card${isSelected ? " hlm-card--selected" : ""}${layout.availability === "archived" ? " hlm-card--archived" : ""}`}
                    key={layout.id}
                    role="listitem"
                  >
                    <LayoutArtwork index={index} active={isSelected} />
                    <div className="hlm-card-body">
                      <div className="hlm-card-top">
                        <div className="hlm-card-title">
                          <h3>{layout.name}</h3>
                          {isSelected && <span className="hlm-selected-mark" aria-label="Selected"><Check aria-hidden="true" /></span>}
                        </div>
                        <span className={`hlm-badge${layout.availability === "active" ? " hlm-badge--active" : layout.availability === "archived" ? " hlm-badge--archived" : ""}`}>
                          {layout.availability === "active" && <CheckCircle2 aria-hidden="true" size={11} />}
                          {badge}
                        </span>
                      </div>
                      <div className="hlm-version">{layout.isBuiltIn ? "Built-in" : "Custom"} · Version {layout.version}</div>
                      <p className="hlm-description">{layout.description}</p>
                      <div className="hlm-card-actions">
                        {layout.availability !== "archived" ? (
                          <button
                            type="button"
                            className="hlm-btn hlm-btn--select"
                            onClick={() => selectLayout(layout.id)}
                            disabled={state.busy || isSelected}
                            aria-pressed={isSelected}
                          >
                            {isSelected ? <><Check aria-hidden="true" /> Selected</> : "Select layout"}
                          </button>
                        ) : (
                          <button type="button" className="hlm-btn hlm-btn--select" onClick={() => restoreLayout(layout.id)} disabled={state.busy}>
                            <RotateCcw aria-hidden="true" /> Restore
                          </button>
                        )}
                        <button type="button" className="hlm-btn hlm-btn--icon" onClick={() => openPreview(layout.id, "desktop")} aria-label={`Preview ${layout.name}`}>
                          <Eye aria-hidden="true" />
                        </button>
                        {layout.canDuplicate && (
                          <button type="button" className="hlm-btn hlm-btn--icon" onClick={() => duplicateLayout(layout.id)} disabled={state.busy} aria-label={`Duplicate ${layout.name}`}>
                            <Copy aria-hidden="true" />
                          </button>
                        )}
                        {layout.canArchive && layout.availability !== "archived" && (
                          <button type="button" className="hlm-btn hlm-btn--icon hlm-btn--danger" onClick={() => archiveLayout(layout.id)} disabled={state.busy} aria-label={`Archive ${layout.name}`}>
                            <Archive aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="hlm-deploy" aria-labelledby="hlm-deploy-title">
          <div className="hlm-deploy-main">
            <div className="hlm-deploy-icon"><Wifi aria-hidden="true" /></div>
            <div className="hlm-deploy-copy">
              <h2 id="hlm-deploy-title">Deployment manager</h2>
              <p>
                Staged: <strong>{deployment.selectedLayout || selectedLayout?.name || "No layout selected"}</strong>
                <span aria-hidden="true"> · </span>
                On router: <strong>{deployment.installedLayout || "Not deployed"}</strong>
              </p>
              <div className="hlm-sync-line"><Clock3 aria-hidden="true" /> Last successful sync: {deployment.lastSuccessfulSync ? formatDate(deployment.lastSuccessfulSync) : "No successful sync recorded"}</div>
            </div>
          </div>
          <div className="hlm-deploy-action">
            <button type="button" className="hlm-btn hlm-btn--deploy" onClick={() => setConfirmOpen(true)} disabled={!canDeploy}>
              {state.busy || deploying ? <LoaderCircle className="hlm-spin" aria-hidden="true" /> : <ArrowDownToLine aria-hidden="true" />}
              {state.busy || deploying ? "Deploying…" : "Deploy layout"}
            </button>
            <span className="hlm-deploy-note">Review the replacement before confirming</span>
          </div>
        </section>

        <div className="hlm-lower">
          <section className="hlm-panel" aria-labelledby="hlm-status-title">
            <div className="hlm-panel-head">
              <h2 id="hlm-status-title"><Radio aria-hidden="true" /> Router deployment</h2>
              <span>Live context</span>
            </div>
            <div className="hlm-manager-row">
              <div><span className="hlm-manager-key">Target router</span><span className="hlm-manager-value">{deployment.routerName || "Not selected"}</span></div>
              <div><span className="hlm-manager-key">Sync status</span><span className="hlm-manager-value"><span className="hlm-sync-status">{statusLabel(deployment.syncStatus || "unknown")}</span></span></div>
            </div>
            <div className="hlm-manager-row">
              <div><span className="hlm-manager-key">Hotspot service</span><span className="hlm-manager-value">{deployment.hotspotName || "Not selected"}</span></div>
              <div><span className="hlm-manager-key">Installed version</span><span className="hlm-manager-value">{deployment.installedLayout || "Not deployed"}</span></div>
            </div>
            <div className="hlm-manager-row">
              <div><span className="hlm-manager-key">Staged layout</span><span className="hlm-manager-value">{deployment.selectedLayout || selectedLayout?.name || "None selected"}</span></div>
              <div><span className="hlm-manager-key">Last successful sync</span><span className="hlm-manager-value">{deployment.lastSuccessfulSync ? formatDate(deployment.lastSuccessfulSync) : "No record"}</span></div>
            </div>
          </section>

          <section className="hlm-panel" aria-labelledby="hlm-history-title">
            <div className="hlm-panel-head">
              <h2 id="hlm-history-title"><Clock3 aria-hidden="true" /> Deployment history</h2>
              <span>{history.length} {history.length === 1 ? "entry" : "entries"}</span>
            </div>
            {history.length === 0 ? (
              <div className="hlm-history-empty">Deployment activity will appear here.</div>
            ) : (
              <div className="hlm-history-wrap">
                <table className="hlm-history">
                  <thead><tr><th scope="col">Date</th><th scope="col">Layout</th><th scope="col">Router</th><th scope="col">Status</th></tr></thead>
                  <tbody>
                    {history.map((entry, index) => (
                      <tr key={`${entry.date}-${entry.layout}-${index}`}>
                        <td>{formatDate(entry.date)}</td>
                        <td><span className="hlm-history-name">{entry.layout}</span><span className="hlm-history-version">Version {entry.version}</span></td>
                        <td>{entry.router}</td>
                        <td><span className="hlm-history-status">{statusLabel(entry.status)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>

      {preview && previewLayoutEntry && (
        <div className="hlm-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPreview(null); }}>
          <section className={`hlm-modal${preview.viewport === "mobile" ? " hlm-modal--mobile" : ""}${preview.viewport === "fullscreen" ? " hlm-modal--fullscreen" : ""}`} role="dialog" aria-modal="true" aria-labelledby="hlm-preview-title">
            <header className="hlm-modal-header">
              <div className="hlm-modal-title">
                <div className="hlm-deploy-icon"><Eye aria-hidden="true" /></div>
                <div><h2 id="hlm-preview-title">{previewLayoutEntry.name}</h2><span>Portal preview · Version {previewLayoutEntry.version}</span></div>
              </div>
              <div className="hlm-view-controls" role="group" aria-label="Preview viewport">
                <button type="button" aria-pressed={preview.viewport === "desktop"} onClick={() => openPreview(preview.id, "desktop")}><Monitor aria-hidden="true" /> Desktop</button>
                <button type="button" aria-pressed={preview.viewport === "mobile"} onClick={() => openPreview(preview.id, "mobile")}><Smartphone aria-hidden="true" /> Mobile</button>
                <button type="button" aria-pressed={preview.viewport === "fullscreen"} onClick={() => openPreview(preview.id, "fullscreen")}><ExternalLink aria-hidden="true" /> Full</button>
              </div>
              <button type="button" className="hlm-close" onClick={() => setPreview(null)} aria-label="Close preview"><X aria-hidden="true" /></button>
            </header>
            <div className="hlm-preview-stage">
              {previewLayoutEntry.previewUrl ? (
                <iframe
                  key={`${previewLayoutEntry.id}-${preview.viewport}`}
                  className={`hlm-preview-frame${preview.viewport === "mobile" ? " hlm-preview-frame--mobile" : ""}`}
                  src={previewLayoutEntry.previewUrl}
                  title={`${previewLayoutEntry.name} guest portal preview`}
                  sandbox="allow-forms allow-scripts allow-same-origin"
                />
              ) : (
                <div className="hlm-preview-missing">
                  <div className="hlm-empty-icon"><Eye aria-hidden="true" /></div>
                  <strong>Preview unavailable</strong>
                  <p>A preview URL has not been provided for this layout. The layout can still be selected and deployed according to your account permissions.</p>
                </div>
              )}
            </div>
            <footer className="hlm-modal-footer">
              <span>Viewport: {statusLabel(preview.viewport)}</span>
              {previewLayoutEntry.previewUrl && <a href={previewLayoutEntry.previewUrl} target="_blank" rel="noreferrer">Open preview in new tab <ExternalLink aria-hidden="true" /></a>}
            </footer>
          </section>
        </div>
      )}

      {confirmOpen && selectedLayout && (
        <div className="hlm-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !deploying) setConfirmOpen(false); }}>
          <section className="hlm-confirm" role="alertdialog" aria-modal="true" aria-labelledby="hlm-confirm-title" aria-describedby="hlm-confirm-description">
            <div className="hlm-confirm-icon"><LockKeyhole aria-hidden="true" /></div>
            <h2 id="hlm-confirm-title">{selectedDiffersFromInstalled ? "Replace the installed layout?" : "Confirm layout deployment"}</h2>
            <p id="hlm-confirm-description">
              This will deploy <strong>{selectedLayout.name}</strong> version {selectedLayout.version} to <strong>{deployment.routerName || "the selected router"}</strong>, for hotspot <strong>{deployment.hotspotName || "the selected service"}</strong>.
            </p>
            {selectedDiffersFromInstalled && (
              <div className="hlm-confirm-swap" aria-label="Layout replacement">
                <div><span>Current on router</span><strong>{deployment.installedLayout}</strong></div>
                <ChevronRight aria-hidden="true" />
                <div><span>Will be replaced by</span><strong>{selectedLayout.name} · v{selectedLayout.version}</strong></div>
              </div>
            )}
            <p className="hlm-confirm-warning"><ShieldCheck aria-hidden="true" /> Confirm only when you are ready to replace the current guest portal on this target.</p>
            <div className="hlm-confirm-actions">
              <button type="button" className="hlm-btn" onClick={() => setConfirmOpen(false)} disabled={deploying}>Cancel</button>
              <button type="button" className="hlm-btn hlm-btn--confirm" onClick={() => void runDeploy()} disabled={deploying || state.busy}>
                {deploying ? <LoaderCircle aria-hidden="true" /> : <ArrowDownToLine aria-hidden="true" />}
                {deploying ? "Confirming…" : "Confirm deployment"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

export default HotspotLayoutManager;
