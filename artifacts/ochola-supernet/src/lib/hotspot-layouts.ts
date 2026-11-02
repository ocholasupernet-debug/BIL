export const HOTSPOT_PORTAL_LAYOUTS = [
  {
    value: "classic",
    label: "Classic",
    description: "A warm, light guest portal with clear plan cards and a welcoming feel.",
    background: "#f3f4ec",
    panel: "#ffffff",
    accent: "#d56c4c",
  },
  {
    value: "split-horizon",
    label: "Split Horizon",
    description: "Place the welcome message beside the plans and sign-in options.",
    background: "#0b1623",
    panel: "#16283b",
    accent: "#38bdf8",
  },
  {
    value: "coastal-light",
    label: "Coastal Light",
    description: "Use bright surfaces, clear text, and a calm, spacious layout.",
    background: "#eaf4fa",
    panel: "#ffffff",
    accent: "#0284c7",
  },
  {
    value: "signal-grid",
    label: "Signal Grid",
    description: "Use a compact, square-edged layout with crisp network accents.",
    background: "#07191b",
    panel: "#102a2b",
    accent: "#2dd4bf",
  },
  {
    value: "warm-studio",
    label: "Warm Studio",
    description: "Use soft warm surfaces and friendly, rounded plan cards.",
    background: "#2a2019",
    panel: "#413126",
    accent: "#fb923c",
  },
  {
    value: "forest-pulse",
    label: "Forest Pulse",
    description: "Use deep green surfaces, vivid highlights, and a bold hero.",
    background: "#071910",
    panel: "#102a1c",
    accent: "#4ade80",
  },
  {
    value: "dansted-wifi",
    label: "Metallic Diamond",
    description: "A compact metallic portal with a diamond texture, centered branding, and outlined package tiles.",
    background: "#151617",
    panel: "#363738",
    accent: "#41d85f",
  },
] as const;

export type HotspotPortalLayout = (typeof HOTSPOT_PORTAL_LAYOUTS)[number]["value"];

const HOTSPOT_PORTAL_LAYOUT_KEYS = new Set<string>(
  HOTSPOT_PORTAL_LAYOUTS.map(layout => layout.value),
);

export function normalizeHotspotPortalLayout(value: unknown): HotspotPortalLayout {
  return typeof value === "string" && HOTSPOT_PORTAL_LAYOUT_KEYS.has(value)
    ? value as HotspotPortalLayout
    : "classic";
}

/**
 * Generated pages carry the administrator's selected layout in their runtime
 * config. Treat that choice as authoritative over public branding data, which
 * can otherwise replace the selected layout during asynchronous hydration.
 */
export function resolveHotspotPortalLayout(
  runtimeLayout: unknown,
  brandingLayout: unknown,
  runtimeLayoutIsExplicit: boolean,
): HotspotPortalLayout {
  return normalizeHotspotPortalLayout(
    runtimeLayoutIsExplicit ? runtimeLayout : brandingLayout ?? runtimeLayout,
  );
}

const STATIC_PORTAL_LAYOUT_CSS: Partial<Record<HotspotPortalLayout, string>> = {
  classic: `
    html[data-portal-layout="classic"] body {
      display: grid;
      grid-template-columns: minmax(16rem, .78fr) minmax(0, 1.22fr);
      align-content: start;
      align-items: start;
      gap: 1rem clamp(1.25rem, 3vw, 3rem);
      max-width: 1420px;
      margin: 0 auto;
      padding: 0 2rem 3rem;
    }
    html[data-portal-layout="classic"] .hdr {
      position: sticky !important;
      top: 0 !important;
      left: auto !important;
      grid-column: 1 / -1;
      grid-row: 1;
      width: auto !important;
      margin: 0 -2rem;
    }
    html[data-portal-layout="classic"] body {
      min-height: 100vh !important;
      color: #183b39 !important;
      background: #f4f4ed !important;
      background-image: radial-gradient(ellipse at 50% 0%, #dcebe2 0%, transparent 52%) !important;
      font-family: "DM Sans", "Trebuchet MS", sans-serif !important;
    }
    html[data-portal-layout="classic"] body > .hdr + section {
      grid-column: 1;
      grid-row: 2;
      align-self: stretch;
      min-height: 410px;
      margin: 1.75rem 0 0 !important;
      padding: 3rem 1.5rem !important;
      border: 1px solid #dfe5dc;
      border-radius: 1.5rem;
      background: rgba(255,255,255,.64);
      text-align: left !important;
    }
    html[data-portal-layout="classic"] #portalHero .fade-up {
      max-width: none !important;
      margin: 0 !important;
    }
    html[data-portal-layout="classic"] #portalHero .fade-up > div:nth-of-type(2),
    html[data-portal-layout="classic"] #portalHero .fade-up > div:last-child {
      justify-content: flex-start !important;
    }
    html[data-portal-layout="classic"] #portalHero .fade-up > div:first-child {
      color: #367355 !important;
      background: #edf3ed !important;
      border-color: #d9e4d9 !important;
    }
    html[data-portal-layout="classic"] #portalHero .fade-up > div:last-child > div {
      color: #647773 !important;
      background: rgba(255,255,255,.7) !important;
      border-color: #e1e8e0 !important;
    }
    html[data-portal-layout="classic"] #portalHero .fade-up > div:last-child svg {
      stroke: #438863 !important;
    }
    html[data-portal-layout="classic"] #portalHeroTitle,
    html[data-portal-layout="classic"] #portalTagline {
      margin-left: 0 !important;
      margin-right: 0 !important;
      text-align: left !important;
    }
    html[data-portal-layout="classic"] #portalHeroTitle {
      font-family: Georgia, "Times New Roman", serif !important;
      font-weight: 600 !important;
    }
    html[data-portal-layout="classic"] #portalTagline strong { color: #285b50 !important; }
    html[data-portal-layout="classic"] .hdr {
      background: rgba(248,249,243,.94) !important;
      border-bottom: 1px solid #dce3db !important;
      box-shadow: 0 5px 22px rgba(25,57,53,.06) !important;
      backdrop-filter: blur(18px);
    }
    html[data-portal-layout="classic"] #portalLogoIcon {
      background: #d9684c !important;
      border-radius: 12px !important;
      box-shadow: none !important;
    }
    html[data-portal-layout="classic"] #portalNameHeader,
    html[data-portal-layout="classic"] #portalNameFooter,
    html[data-portal-layout="classic"] #plansSection h2,
    html[data-portal-layout="classic"] #portalHeroTitle {
      color: #183b39 !important;
      -webkit-text-fill-color: #183b39 !important;
      background: none !important;
    }
    html[data-portal-layout="classic"] #portalHero {
      padding-top: 2rem !important;
      padding-bottom: 2.5rem !important;
      background: radial-gradient(ellipse at 50% 20%, rgba(255,255,255,.82), transparent 68%);
    }
    html[data-portal-layout="classic"] #portalHero > div[style*="radial-gradient"],
    html[data-portal-layout="classic"] #portalHero .grid-bg { display: none !important; }
    html[data-portal-layout="classic"] #portalHeroTitle {
      font-size: clamp(2.25rem, 5vw, 3.65rem) !important;
      letter-spacing: -.055em !important;
      line-height: 1.03 !important;
    }
    html[data-portal-layout="classic"] #portalTagline,
    html[data-portal-layout="classic"] #portalHero > div > div:first-child,
    html[data-portal-layout="classic"] #plansSection > div:first-child > p {
      color: #647773 !important;
    }
    html[data-portal-layout="classic"] #portalHeroTitle span {
      color: #d9684c !important;
      -webkit-text-fill-color: #d9684c !important;
      background: none !important;
    }
    html[data-portal-layout="classic"] #portalHero > div > div:nth-child(2) > div {
      background: #d9684c !important;
      box-shadow: 0 12px 34px rgba(217,104,76,.2) !important;
    }
    html[data-portal-layout="classic"] .dot-live {
      background: #3f8a68 !important;
      box-shadow: 0 0 0 3px rgba(63,138,104,.15) !important;
    }
    html[data-portal-layout="classic"] #plansSection {
      grid-column: 2;
      grid-row: 2;
      width: 100%;
      max-width: 1260px !important;
      margin: 1.75rem 0 0 !important;
      padding: 1rem 0 2rem !important;
    }
    html[data-portal-layout="classic"] body > section:not(:first-of-type):not(#portalAnnouncement):not(#portalExpiryNotice):not(#plansSection) {
      grid-column: 2;
      width: 100%;
      max-width: none !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
    }
    html[data-portal-layout="classic"] #portalAnnouncement,
    html[data-portal-layout="classic"] #portalExpiryNotice {
      grid-column: 1 / -1;
      width: 100%;
    }
    html[data-portal-layout="classic"] #portalFooter {
      grid-column: 1 / -1;
    }
    html[data-portal-layout="classic"] #plansSection > div:first-child > p:first-child {
      color: #d9684c !important;
    }
    html[data-portal-layout="classic"] #plansGrid .plan-card {
      border: 1px solid #dfe5dc !important;
      border-radius: 18px !important;
      background: #fff !important;
      box-shadow: 0 12px 28px rgba(33,67,60,.08) !important;
      color: #183b39 !important;
    }
    html[data-portal-layout="classic"] #plansGrid .plan-card > div:first-child {
      background: linear-gradient(150deg, #fff, #f5f7f1) !important;
      border-top-color: #d9684c !important;
    }
    html[data-portal-layout="classic"] #plansGrid .plan-card > div:first-child * {
      color: #183b39 !important;
      -webkit-text-fill-color: #183b39 !important;
    }
    html[data-portal-layout="classic"] #plansGrid .plan-card > div:first-child > span {
      color: #fff !important;
      -webkit-text-fill-color: #fff !important;
      background: #285b50 !important;
    }
    html[data-portal-layout="classic"] .plan-connect-button {
      color: #fff !important;
      background: #d9684c !important;
      box-shadow: none !important;
    }
    html[data-portal-layout="classic"] .sec-card {
      border: 1px solid #dfe5dc !important;
      border-radius: 18px !important;
      background: #fff !important;
      box-shadow: 0 16px 42px rgba(33,67,60,.08) !important;
    }
    html[data-portal-layout="classic"] .sec-head {
      background: #edf3ed !important;
      border-bottom-color: #e1e8e0 !important;
    }
    html[data-portal-layout="classic"] .sec-head *,
    html[data-portal-layout="classic"] .sec-body { color: #183b39 !important; }
    html[data-portal-layout="classic"] .sec-head p { color: #647773 !important; }
    html[data-portal-layout="classic"] .inp {
      color: #183b39 !important;
      background: #f8f9f5 !important;
      border-color: #d8e1d9 !important;
    }
    html[data-portal-layout="classic"] .inp::placeholder { color: #899994 !important; }
    html[data-portal-layout="classic"] .sec-body .btn,
    html[data-portal-layout="classic"] .sec-body button {
      color: #fff !important;
    }
    html[data-portal-layout="classic"] #portalFooter {
      background: #e9eee7 !important;
      border-top-color: #d7e0d7 !important;
    }
    html[data-portal-layout="classic"] #portalFooter * { color: #657772 !important; }
    @media (max-width: 640px) {
      html[data-portal-layout="classic"] body {
        display: block;
        padding: 0;
      }
      html[data-portal-layout="classic"] .hdr {
        position: sticky !important;
        margin: 0;
      }
      html[data-portal-layout="classic"] body > .hdr + section {
        min-height: 0;
        margin: 1rem !important;
        padding: 2.5rem 1.25rem !important;
      }
      html[data-portal-layout="classic"] .hdr-inner { padding: 0 1rem; }
      html[data-portal-layout="classic"] #portalHero { padding-top: 2rem !important; padding-bottom: 2.5rem !important; }
      html[data-portal-layout="classic"] #plansSection { padding-inline: 1rem !important; }
    }
  `,
  "split-horizon": `
    html[data-portal-layout="split-horizon"] body {
      display: grid;
      grid-template-columns: minmax(16rem, .78fr) minmax(0, 1.22fr);
      align-content: start;
      align-items: start;
      gap: 1rem clamp(1.25rem, 3vw, 3rem);
      max-width: 1420px;
      margin: 0 auto;
      padding: 0 2rem 3rem;
    }
    html[data-portal-layout="split-horizon"] .hdr {
      position: sticky;
      grid-column: 1 / -1;
      grid-row: 1;
      width: auto;
      margin: 0 -2rem;
    }
    html[data-portal-layout="split-horizon"] body > .hdr + section {
      grid-column: 1;
      grid-row: 2;
      align-self: stretch;
      min-height: 410px;
      margin-top: 1.75rem;
      padding: 3rem 1.5rem !important;
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 1.5rem;
      background: linear-gradient(145deg, rgba(255,255,255,.09), rgba(255,255,255,.025));
      text-align: left !important;
    }
    html[data-portal-layout="split-horizon"] #portalHeroTitle,
    html[data-portal-layout="split-horizon"] #portalTagline {
      margin-left: 0 !important;
      margin-right: 0 !important;
      text-align: left !important;
    }
    html[data-portal-layout="split-horizon"] #plansSection {
      grid-column: 2;
      grid-row: 2;
      width: 100%;
      max-width: none !important;
      margin: 1.75rem 0 0 !important;
      padding: 1rem 0 2rem !important;
    }
    html[data-portal-layout="split-horizon"] body > section:not(:first-of-type):not(#portalAnnouncement):not(#portalExpiryNotice):not(#plansSection) {
      grid-column: 2;
      width: 100%;
      max-width: none !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
    }
    html[data-portal-layout="split-horizon"] #portalAnnouncement,
    html[data-portal-layout="split-horizon"] #portalExpiryNotice {
      grid-column: 1 / -1;
      width: 100%;
    }
    @media (max-width: 760px) {
      html[data-portal-layout="split-horizon"] body {
        display: block;
        padding: 0;
      }
      html[data-portal-layout="split-horizon"] .hdr {
        position: sticky;
        margin: 0;
      }
      html[data-portal-layout="split-horizon"] body > .hdr + section {
        min-height: 0;
        margin: 1rem;
        padding: 2.5rem 1.25rem !important;
      }
      html[data-portal-layout="split-horizon"] #plansSection {
        padding: .5rem 1rem 3rem !important;
      }
    }
  `,
  "coastal-light": `
    html[data-portal-layout="coastal-light"] .hdr {
      background: rgba(248,252,255,.94) !important;
      border-bottom-color: rgba(15,61,91,.12) !important;
      box-shadow: 0 8px 28px rgba(13,55,83,.08);
    }
    html[data-portal-layout="coastal-light"] #portalNameHeader,
    html[data-portal-layout="coastal-light"] #portalHeroTitle,
    html[data-portal-layout="coastal-light"] #plansSection h2 {
      color: #17344d !important;
      -webkit-text-fill-color: #17344d !important;
      background: none !important;
    }
    html[data-portal-layout="coastal-light"] #portalTagline,
    html[data-portal-layout="coastal-light"] #plansSection > p {
      color: #526c80 !important;
    }
    html[data-portal-layout="coastal-light"] body > .hdr + section {
      max-width: 1120px;
      margin: 64px auto 1.5rem;
      border: 1px solid rgba(15,61,91,.1);
      border-radius: 0 0 2rem 2rem;
      background: rgba(255,255,255,.9);
      box-shadow: 0 18px 55px rgba(15,61,91,.12);
    }
    html[data-portal-layout="coastal-light"] .sec-card,
    html[data-portal-layout="coastal-light"] #plansGrid .plan-card {
      border: 1px solid #d5e5ef !important;
      background: #fff !important;
      box-shadow: 0 12px 30px rgba(25,72,100,.12) !important;
    }
    html[data-portal-layout="coastal-light"] .sec-head,
    html[data-portal-layout="coastal-light"] #plansGrid .plan-card > div:first-child {
      background: #f3f9fc !important;
      border-color: #dceaf2 !important;
    }
    html[data-portal-layout="coastal-light"] .sec-head *,
    html[data-portal-layout="coastal-light"] .sec-body,
    html[data-portal-layout="coastal-light"] .sec-body *,
    html[data-portal-layout="coastal-light"] #plansGrid .plan-card > div:first-child * {
      color: #17344d !important;
      -webkit-text-fill-color: #17344d !important;
    }
    html[data-portal-layout="coastal-light"] .inp {
      color: #17344d !important;
      background: #fff !important;
      border-color: #bfd5e3 !important;
    }
    html[data-portal-layout="coastal-light"] .inp::placeholder { color: #71899a !important; }
    html[data-portal-layout="coastal-light"] .sec-body .btn,
    html[data-portal-layout="coastal-light"] .sec-body button {
      color: #fff !important;
      -webkit-text-fill-color: #fff !important;
    }
    html[data-portal-layout="coastal-light"] .plan-connect-button {
      background: linear-gradient(135deg, #0284c7, #2563eb) !important;
    }
    html[data-portal-layout="coastal-light"] #plansGrid .plan-card > div:first-child > span {
      background: #dceffa !important;
      color: #075985 !important;
    }
  `,
  "signal-grid": `
    html[data-portal-layout="signal-grid"] .hdr {
      background: rgba(5,22,24,.92) !important;
      border-bottom: 1px solid rgba(45,212,191,.26) !important;
    }
    html[data-portal-layout="signal-grid"] body > .hdr + section {
      padding-top: 5.5rem !important;
      padding-bottom: 2.5rem !important;
    }
    html[data-portal-layout="signal-grid"] .grid-bg {
      opacity: .85;
      background-image: linear-gradient(rgba(45,212,191,.075) 1px,transparent 1px),linear-gradient(90deg,rgba(45,212,191,.075) 1px,transparent 1px);
    }
    html[data-portal-layout="signal-grid"] #portalHeroTitle {
      letter-spacing: .035em !important;
      text-transform: uppercase;
    }
    html[data-portal-layout="signal-grid"] #plansGrid .plan-card,
    html[data-portal-layout="signal-grid"] .sec-card {
      border: 1px solid rgba(45,212,191,.3) !important;
      box-shadow: 0 0 0 1px rgba(45,212,191,.05), 0 12px 30px rgba(0,0,0,.32) !important;
    }
    html[data-portal-layout="signal-grid"] .sec-card { border-radius: .55rem !important; }
    html[data-portal-layout="signal-grid"] #plansGrid .plan-card > div:first-child {
      background: linear-gradient(145deg,rgba(20,83,75,.55),rgba(12,34,39,.92)) !important;
      border-top-color: #2dd4bf !important;
    }
    html[data-portal-layout="signal-grid"] .sec-head {
      background: linear-gradient(100deg,rgba(13,91,78,.4),rgba(11,35,38,.8)) !important;
    }
    html[data-portal-layout="signal-grid"] .plan-connect-button,
    html[data-portal-layout="signal-grid"] .btn-purple {
      background: linear-gradient(135deg,#0f766e,#0891b2) !important;
    }
  `,
  "warm-studio": `
    html[data-portal-layout="warm-studio"] .hdr {
      background: rgba(44,33,25,.92) !important;
      border-bottom-color: rgba(251,146,60,.22) !important;
    }
    html[data-portal-layout="warm-studio"] body > .hdr + section {
      max-width: 1080px;
      margin: 64px auto 1.5rem;
      padding: 4rem 1.5rem !important;
      border-radius: 2rem;
      background: linear-gradient(145deg,rgba(111,73,43,.34),rgba(61,44,33,.25));
    }
    html[data-portal-layout="warm-studio"] #portalHeroTitle {
      letter-spacing: -.055em !important;
      text-wrap: balance;
    }
    html[data-portal-layout="warm-studio"] #plansGrid .plan-card,
    html[data-portal-layout="warm-studio"] .sec-card {
      border: 1px solid rgba(251,191,143,.26) !important;
      background: rgba(61,44,33,.92) !important;
      box-shadow: 0 18px 45px rgba(0,0,0,.28) !important;
    }
    html[data-portal-layout="warm-studio"] .sec-card { border-radius: 1.35rem !important; }
    html[data-portal-layout="warm-studio"] .sec-head {
      background: linear-gradient(145deg,rgba(154,91,47,.38),rgba(83,56,37,.45)) !important;
    }
    html[data-portal-layout="warm-studio"] #plansGrid .plan-card > div:first-child {
      background: linear-gradient(160deg,rgba(251,146,60,.19),rgba(124,69,39,.22)) !important;
      border-top-color: rgba(251,146,60,.7) !important;
    }
    html[data-portal-layout="warm-studio"] .plan-connect-button {
      background: linear-gradient(135deg,#ea7a33,#b4532a) !important;
    }
  `,
  "forest-pulse": `
    html[data-portal-layout="forest-pulse"] .hdr {
      background: rgba(5,25,15,.94) !important;
      border-bottom: 1px solid rgba(74,222,128,.24) !important;
    }
    html[data-portal-layout="forest-pulse"] body > .hdr + section {
      max-width: 1120px;
      margin: 64px auto 1.5rem;
      padding: 4.5rem 1.5rem !important;
      border-bottom: 1px solid rgba(74,222,128,.18);
      background: radial-gradient(ellipse at 50% 0%,rgba(34,197,94,.16),transparent 72%);
    }
    html[data-portal-layout="forest-pulse"] #portalHeroTitle {
      text-shadow: 0 0 34px rgba(74,222,128,.24);
    }
    html[data-portal-layout="forest-pulse"] #plansGrid .plan-card,
    html[data-portal-layout="forest-pulse"] .sec-card {
      border: 1px solid rgba(74,222,128,.25) !important;
      background: rgba(8,35,20,.93) !important;
      box-shadow: 0 18px 42px rgba(0,0,0,.34),0 0 28px rgba(34,197,94,.05) !important;
    }
    html[data-portal-layout="forest-pulse"] .sec-card { border-radius: 1.35rem !important; }
    html[data-portal-layout="forest-pulse"] .sec-head {
      background: linear-gradient(120deg,rgba(21,94,50,.4),rgba(10,47,28,.55)) !important;
    }
    html[data-portal-layout="forest-pulse"] #plansGrid .plan-card > div:first-child {
      background: linear-gradient(160deg,rgba(34,197,94,.15),rgba(8,46,29,.7)) !important;
      border-top-color: rgba(74,222,128,.65) !important;
    }
    html[data-portal-layout="forest-pulse"] .plan-connect-button,
    html[data-portal-layout="forest-pulse"] .btn-purple {
      background: linear-gradient(135deg,#16a34a,#0f766e) !important;
    }
  `,
  "dansted-wifi": `
    html[data-portal-layout="dansted-wifi"] .hdr { display:none !important; }
    html[data-portal-layout="dansted-wifi"] body {
      color:#f5f5f5 !important;
      background-color:#151617 !important;
      background-image:
        linear-gradient(63deg,transparent 0 34%,rgba(255,255,255,.15) 35%,rgba(255,255,255,.025) 40%,transparent 47%),
        linear-gradient(112deg,transparent 0 54%,rgba(255,255,255,.12) 55%,rgba(255,255,255,.02) 60%,transparent 67%),
        repeating-linear-gradient(45deg,#252627 0 3px,#101112 3px 7px),
        repeating-linear-gradient(-45deg,rgba(255,255,255,.13) 0 2px,transparent 2px 7px) !important;
      background-attachment:fixed !important;
      font-family:"DM Sans","Trebuchet MS",sans-serif !important;
    }
    html[data-portal-layout="dansted-wifi"] .hdr {
      color:#f5f5f5 !important;
      background:rgba(14,15,16,.94) !important;
      border-bottom:1px solid rgba(255,255,255,.13) !important;
      box-shadow:0 5px 20px rgba(0,0,0,.32) !important;
    }
    html[data-portal-layout="dansted-wifi"] #portalLogoIcon { display:none !important; }
    html[data-portal-layout="dansted-wifi"] .hdr-inner { min-height:54px !important; }
    html[data-portal-layout="dansted-wifi"] #portalNameHeader {
      color:#f2f2f2 !important;
      -webkit-text-fill-color:#f2f2f2 !important;
    }
    html[data-portal-layout="dansted-wifi"] #portalHero {
      padding:.2rem .75rem .5rem !important;
      text-align:center !important;
    }
    html[data-portal-layout="dansted-wifi"] #portalHero > div[style*="radial-gradient"],
    html[data-portal-layout="dansted-wifi"] #portalHero .grid-bg,
    html[data-portal-layout="dansted-wifi"] #portalHero .anim-pulse,
    html[data-portal-layout="dansted-wifi"] #portalHero > div > div:nth-child(2) { display:none !important; }
    html[data-portal-layout="dansted-wifi"] #portalHero > div.fade-up {
      max-width:720px !important;
      padding:0 !important;
      border:0;
      border-radius:0;
      background:transparent;
      box-shadow:none;
    }
    html[data-portal-layout="dansted-wifi"] #portalHero > div.fade-up > div:first-child,
    html[data-portal-layout="dansted-wifi"] #portalHero > div.fade-up > div:nth-child(3),
    html[data-portal-layout="dansted-wifi"] #portalHero > div.fade-up > div:last-child { display:none !important; }
    html[data-portal-layout="dansted-wifi"] #portalHeroTitle {
      width:min(100%,360px);
      margin:0 auto .55rem !important;
      padding:4px 8px !important;
      color:#38d856 !important;
      -webkit-text-fill-color:#38d856 !important;
      border:1px solid rgba(255,255,255,.13);
      border-radius:7px;
      background:rgba(77,78,79,.78) !important;
      box-shadow:0 5px 18px rgba(0,0,0,.16);
      font-size:clamp(1rem,4vw,1.5rem) !important;
      font-weight:800 !important;
      letter-spacing:-.035em !important;
      text-transform:uppercase;
      line-height:1.2 !important;
      overflow-wrap:anywhere;
    }
    html[data-portal-layout="dansted-wifi"] #portalTagline {
      display:block;
      width:100%;
      max-width:none !important;
      margin:0 auto !important;
      padding:10px 12px !important;
      color:#f5f5f5 !important;
      border:1px solid rgba(255,255,255,.16);
      border-radius:9px;
      background:rgba(77,78,79,.8);
      box-shadow:0 8px 20px rgba(0,0,0,.2);
      font-size:.84rem !important;
      line-height:1.5 !important;
      text-align:left !important;
    }
    html[data-portal-layout="dansted-wifi"] #portalTagline > strong {
      display:block;
      margin-bottom:.35rem;
      text-align:center;
      font-size:.95rem;
    }
    html[data-portal-layout="dansted-wifi"] #portalTagline ol {
      margin:0;
      padding:0;
      list-style:none;
      text-align:left;
    }
    html[data-portal-layout="dansted-wifi"] #portalTagline li { margin:.12rem 0; }
    html[data-portal-layout="dansted-wifi"] #portalTagline p {
      margin:.4rem 0 0;
      text-align:center;
      font-size:.76rem;
    }
    html[data-portal-layout="dansted-wifi"] body > .hdr + section {
      max-width:720px !important;
      margin:.5rem auto 1rem !important;
      padding:0 !important;
      background:none !important;
    }
    html[data-portal-layout="dansted-wifi"] #plansSection {
      max-width:900px !important;
      margin:0 auto !important;
      padding:.25rem 1rem 2rem !important;
    }
    html[data-portal-layout="dansted-wifi"] .dansted-package-card {
      cursor:pointer !important;
      -webkit-tap-highlight-color:transparent;
    }
    html[data-portal-layout="dansted-wifi"] .dansted-package-card:focus-visible {
      outline:3px solid #56a9e3;
      outline-offset:3px;
    }
    html[data-portal-layout="dansted-wifi"] #stkModal {
      padding:10px !important;
      background:rgba(0,0,0,.48) !important;
      backdrop-filter:blur(2px) !important;
    }
    html[data-portal-layout="dansted-wifi"] #stkModal > div {
      max-width:430px !important;
      border-radius:5px !important;
      background:#fff !important;
      color:#555 !important;
      box-shadow:0 16px 48px rgba(0,0,0,.3) !important;
    }
    html[data-portal-layout="dansted-wifi"] #stkModal > div > div:first-child { display:none !important; }
    html[data-portal-layout="dansted-wifi"] #stkModal > div > div:nth-child(2) {
      padding:4px 10px 0 !important;
      justify-content:flex-end !important;
    }
    html[data-portal-layout="dansted-wifi"] #modalPlanName,
    html[data-portal-layout="dansted-wifi"] #modalPlanDetails { display:none !important; }
    html[data-portal-layout="dansted-wifi"] #modalPlanName {
      color:#555 !important;
      font-size:clamp(1.25rem,5vw,1.65rem) !important;
      line-height:1.15 !important;
      text-align:center !important;
    }
    html[data-portal-layout="dansted-wifi"] #modalPlanDetails {
      color:#777 !important;
      font-size:.9rem !important;
      line-height:1.4 !important;
      text-align:center !important;
    }
    html[data-portal-layout="dansted-wifi"] #modalBody { padding:4px 18px 20px !important; }
    html[data-portal-layout="dansted-wifi"] .dansted-checkout { text-align:center; }
    html[data-portal-layout="dansted-wifi"] .dansted-checkout-title {
      color:#555;
      font-size:clamp(1.2rem,5vw,1.55rem);
      font-weight:800;
      line-height:1.15;
      margin:0 0 10px;
    }
    html[data-portal-layout="dansted-wifi"] .dansted-checkout-copy {
      color:#777;
      font-size:.9rem;
      line-height:1.4;
      margin:0 0 18px;
    }
    html[data-portal-layout="dansted-wifi"] .dansted-phone-input {
      width:100%;
      min-height:50px;
      box-sizing:border-box;
      padding:12px 14px;
      border:1px solid #b8d6e4;
      border-radius:4px;
      background:#fff;
      color:#333;
      font:inherit;
      font-size:1rem;
      outline:none;
    }
    html[data-portal-layout="dansted-wifi"] .dansted-phone-input:focus {
      border-color:#3194cf;
      box-shadow:0 0 0 3px rgba(49,148,207,.14);
    }
    html[data-portal-layout="dansted-wifi"] .dansted-pay-button {
      width:min(100%,220px);
      min-height:46px;
      margin:18px auto 0;
      padding:11px 18px;
      border:0;
      border-radius:4px;
      background:#3188cc;
      color:#fff;
      font:inherit;
      font-weight:700;
      cursor:pointer;
    }
    html[data-portal-layout="dansted-wifi"] .dansted-pay-button:disabled { opacity:.55; cursor:not-allowed; }
    html[data-portal-layout="dansted-wifi"] .dansted-error {
      color:#b42318;
      font-size:.82rem;
      line-height:1.4;
      margin:10px 0 0;
    }
    html[data-portal-layout="dansted-wifi"] .dansted-progress {
      min-height:420px;
      display:flex;
      flex-direction:column;
      justify-content:space-between;
      align-items:center;
      text-align:center;
      padding:28px 0 0;
    }
    html[data-portal-layout="dansted-wifi"] .dansted-loader {
      width:min(58vw,230px);
      aspect-ratio:1;
      display:grid;
      place-items:center;
      border-radius:50%;
      background:conic-gradient(from 220deg,#3198d1 0deg,#69b7e3 245deg,#e4f0f7 246deg 360deg);
      animation:dansted-loader-turn 2.2s linear infinite;
      position:relative;
    }
    html[data-portal-layout="dansted-wifi"] .dansted-loader::before {
      content:"";
      position:absolute;
      inset:13%;
      border-radius:50%;
      background:#fff;
    }
    html[data-portal-layout="dansted-wifi"] .dansted-loader span {
      position:relative;
      color:#278bc6;
      font-size:1.15rem;
      font-weight:800;
      letter-spacing:.02em;
    }
    html[data-portal-layout="dansted-wifi"] .dansted-progress-copy {
      width:100%;
      color:#666;
      padding-top:22px;
    }
    html[data-portal-layout="dansted-wifi"] .dansted-progress-copy strong {
      display:block;
      color:#555;
      font-size:1.45rem;
      margin-bottom:8px;
    }
    html[data-portal-layout="dansted-wifi"] .dansted-progress-copy p {
      margin:0 auto 10px;
      max-width:340px;
      font-size:.92rem;
      line-height:1.4;
    }
    html[data-portal-layout="dansted-wifi"] .dansted-progress-copy > span {
      color:#888;
      font-size:.78rem;
    }
    html[data-portal-layout="dansted-wifi"] .dansted-result {
      color:#666;
      padding:16px 0 4px;
      text-align:center;
    }
    html[data-portal-layout="dansted-wifi"] .dansted-result > strong {
      display:block;
      color:#2d8b50;
      font-size:1.3rem;
      margin-bottom:8px;
    }
    @keyframes dansted-loader-turn { to { transform:rotate(360deg); } }
    html[data-portal-layout="dansted-wifi"] #portalRecoveryCards {
      max-width:720px !important;
      margin:1.2rem auto 0 !important;
      padding:0 1rem 1.25rem !important;
    }
    html[data-portal-layout="dansted-wifi"] #plansSection > div:first-child {
      margin-bottom:.7rem !important;
    }
    html[data-portal-layout="dansted-wifi"] #plansSection > div:first-child > p:first-child,
    html[data-portal-layout="dansted-wifi"] #plansSection > div:first-child > p:nth-child(3) { display:none !important; }
    html[data-portal-layout="dansted-wifi"] #plansSection h2 { display:none !important; }
    html[data-portal-layout="dansted-wifi"] #tvConnectButton {
      position:fixed !important;
      z-index:40 !important;
      right:14px !important;
      bottom:14px !important;
      margin:0 !important;
      padding:.7rem 1rem !important;
      color:#fff !important;
      background:#e81e51 !important;
      border:0 !important;
      border-radius:999px !important;
      box-shadow:0 5px 16px rgba(0,0,0,.42) !important;
      opacity:1 !important;
      cursor:pointer !important;
    }
    html[data-portal-layout="dansted-wifi"] #mpesaBanner { display:none !important; }
    html[data-portal-layout="dansted-wifi"] #plansGrid {
      display:flex !important;
      flex-wrap:wrap !important;
      justify-content:center !important;
      gap:10px !important;
    }
    html[data-portal-layout="dansted-wifi"] #plansGrid .plan-card {
      flex:0 1 126px !important;
      min-width:112px !important;
      min-height:100px;
      color:#191919 !important;
      border:2px solid #3c8dff !important;
      border-radius:0 !important;
      background:#fff !important;
      box-shadow:0 4px 12px rgba(0,0,0,.32) !important;
      overflow:hidden;
    }
    html[data-portal-layout="dansted-wifi"] .hp-plan.expanded .hp-plan-top,
    html[data-portal-layout="dansted-wifi"] .hp-plan.expanded .hp-plan-inline-meta,
    html[data-portal-layout="dansted-wifi"] .hp-plan.expanded .hp-plan-pay > div:first-child,
    html[data-portal-layout="dansted-wifi"] .hp-plan.expanded .hp-secured,
    html[data-portal-layout="dansted-wifi"] .hp-plan.expanded .hp-plan-change { display:none !important; }
    html[data-portal-layout="dansted-wifi"] #plansGrid .plan-card:nth-child(4n + 2) { border-color:#63bd42 !important; }
    html[data-portal-layout="dansted-wifi"] #plansGrid .plan-card:nth-child(4n + 3) { border-color:#a341cf !important; }
    html[data-portal-layout="dansted-wifi"] #plansGrid .plan-card:nth-child(4n + 4) { border-color:#d84c4c !important; }
    html[data-portal-layout="dansted-wifi"] #plansGrid .plan-card > div:first-child {
      padding:10px 7px 5px !important;
      color:#202020 !important;
      background:#fff !important;
      border-top:0 !important;
    }
    html[data-portal-layout="dansted-wifi"] #plansGrid .plan-card > div:first-child * {
      color:#252525 !important;
      -webkit-text-fill-color:#252525 !important;
    }
    html[data-portal-layout="dansted-wifi"] #plansGrid .plan-card > div:first-child > span {
      color:#208d42 !important;
      -webkit-text-fill-color:#208d42 !important;
      background:transparent !important;
      padding:0 !important;
      margin:0 0 .2rem !important;
      border-radius:0 !important;
      font-size:.72rem !important;
      letter-spacing:0 !important;
    }
    html[data-portal-layout="dansted-wifi"] #plansGrid .plan-card > div:first-child > div {
      color:#c9343e !important;
      -webkit-text-fill-color:#c9343e !important;
      font-size:1rem !important;
      line-height:1.1 !important;
      letter-spacing:0 !important;
    }
    html[data-portal-layout="dansted-wifi"] #plansGrid .plan-card > div:first-child > div span {
      color:#c9343e !important;
      -webkit-text-fill-color:#c9343e !important;
      font-size:.65rem !important;
    }
    html[data-portal-layout="dansted-wifi"] #plansGrid .plan-card > div:first-child p {
      margin:.15rem 0 0 !important;
      font-size:.56rem !important;
      line-height:1.2 !important;
    }
    html[data-portal-layout="dansted-wifi"] #plansGrid .plan-card > div:last-child {
      padding:5px 7px 9px !important;
      color:#252525 !important;
      background:#fff !important;
    }
    html[data-portal-layout="dansted-wifi"] #plansGrid .plan-card > div:last-child * { color:#262626 !important; }
    html[data-portal-layout="dansted-wifi"] #plansGrid .plan-card .plan-connect-button {
      color:#fff !important;
      background:linear-gradient(100deg,#ed2f25,#baf03d) !important;
      border:0 !important;
      padding:5px 2px !important;
      font-size:.56rem !important;
      line-height:1.15 !important;
      white-space:nowrap;
    }
    html[data-portal-layout="dansted-wifi"] .sec-card {
      color:#f5f5f5 !important;
      border:1px solid rgba(255,255,255,.2) !important;
      border-radius:10px !important;
      background:rgba(77,78,79,.76) !important;
      box-shadow:0 8px 20px rgba(0,0,0,.2) !important;
      backdrop-filter:blur(7px);
    }
    html[data-portal-layout="dansted-wifi"] .sec-head,
    html[data-portal-layout="dansted-wifi"] .sec-body { color:#f5f5f5 !important; background:transparent !important; }
    html[data-portal-layout="dansted-wifi"] .sec-head * { color:#fff !important; }
    html[data-portal-layout="dansted-wifi"] .inp {
      color:#222 !important;
      background:#fff !important;
      border-color:#e84c4c !important;
    }
    html[data-portal-layout="dansted-wifi"] .inp::placeholder { color:#777 !important; }
    html[data-portal-layout="dansted-wifi"] .sec-body .btn,
    html[data-portal-layout="dansted-wifi"] .sec-body button {
      color:#172016 !important;
      background:linear-gradient(100deg,#f04432,#b8f64a) !important;
      border:0 !important;
    }
    html[data-portal-layout="dansted-wifi"] #loyaltyPointsSection,
    html[data-portal-layout="dansted-wifi"] #portalRecoveryCards,
    html[data-portal-layout="dansted-wifi"] #voucherSection,
    html[data-portal-layout="dansted-wifi"] #troubleshootModule { color:#f5f5f5 !important; }
    html[data-portal-layout="dansted-wifi"] #loyaltyPointsCard {
      color:#f5f5f5 !important;
      border:1px solid rgba(255,255,255,.2) !important;
      border-radius:10px !important;
      background:rgba(77,78,79,.76) !important;
      box-shadow:0 8px 20px rgba(0,0,0,.2) !important;
      backdrop-filter:blur(7px);
    }
    html[data-portal-layout="dansted-wifi"] #loyaltyPointsCard h2,
    html[data-portal-layout="dansted-wifi"] #loyaltyPointsCard p,
    html[data-portal-layout="dansted-wifi"] #loyaltyPointsCard div { color:#f5f5f5 !important; }
    html[data-portal-layout="dansted-wifi"] #portalFooter {
      color:rgba(255,255,255,.68) !important;
      background:rgba(25,26,27,.78) !important;
      border-top-color:rgba(255,255,255,.14) !important;
    }
    html[data-portal-layout="dansted-wifi"] #portalFooter * { color:rgba(255,255,255,.68) !important; }
    @media (max-width:640px) {
      html[data-portal-layout="dansted-wifi"] body { padding:0 !important; }
      html[data-portal-layout="dansted-wifi"] .hdr-inner { padding:0 .8rem !important; }
      html[data-portal-layout="dansted-wifi"] #portalHero { padding:.75rem .65rem .45rem !important; }
      html[data-portal-layout="dansted-wifi"] #portalHero > div.fade-up { padding:0 !important; }
      html[data-portal-layout="dansted-wifi"] body > .hdr + section { margin:.4rem .65rem .7rem !important; }
      html[data-portal-layout="dansted-wifi"] #plansSection { margin-top:.9rem !important; padding:.2rem .65rem 1.5rem !important; }
      html[data-portal-layout="dansted-wifi"] #plansGrid { gap:8px !important; }
      html[data-portal-layout="dansted-wifi"] #plansGrid .plan-card { flex-basis:calc(25% - 8px) !important; min-width:78px !important; min-height:100px; }
      html[data-portal-layout="dansted-wifi"] #plansGrid .plan-card > div:first-child { padding:7px 4px 4px !important; }
      html[data-portal-layout="dansted-wifi"] #plansGrid .plan-card > div:last-child { padding:4px 4px 7px !important; }
      html[data-portal-layout="dansted-wifi"] #portalRecoveryCards { margin-top:1.2rem !important; }
    }
  `,
};

export const STATIC_PORTAL_LAYOUT_CSS_TEXT = Object.values(STATIC_PORTAL_LAYOUT_CSS).join("\n");

export function renderStaticPortalLayoutCss(value: unknown): string {
  return STATIC_PORTAL_LAYOUT_CSS[normalizeHotspotPortalLayout(value)] ?? "";
}

export const HOSTED_PORTAL_LAYOUT_CSS = `
  .hp-root[data-portal-layout="classic"] {
    color:#183b39;
    background:#f4f4ed;
    background-image:radial-gradient(ellipse at 50% 0%,#dcebe2 0%,transparent 52%);
    font-family:"DM Sans","Trebuchet MS",sans-serif;
    --isp-accent:#d9684c !important;
    --isp-accent-glow:rgba(217,104,76,.14) !important;
    --isp-accent-border:rgba(217,104,76,.32) !important;
    --isp-accent-strong:#bd573d !important;
  }
  .hp-root[data-portal-layout="classic"]::before {
    opacity:.36;
    background-image:radial-gradient(#b8cbc0 .8px,transparent .8px);
    background-size:22px 22px;
    mask-image:linear-gradient(to bottom,black,transparent 70%);
  }
  .hp-root[data-portal-layout="classic"] .hp-header {
    color:#183b39;
    background:rgba(248,249,243,.9);
    border-bottom:1px solid #dce3db;
    box-shadow:0 5px 22px rgba(25,57,53,.06);
  }
  .hp-root[data-portal-layout="classic"] .hp-brand-name { color:#183b39; }
  .hp-root[data-portal-layout="classic"] .hp-logo-sub { display:none; }
  .hp-root[data-portal-layout="classic"] .hp-brand-mark {
    display:flex;align-items:center;justify-content:center;
    width:42px;height:42px;border-radius:13px;
    color:#fff;background:#d9684c;
  }
  .hp-root[data-portal-layout="classic"] .hp-logo-image {
    width:44px;height:44px;padding:4px;border:1px solid #dfe5dc;
    border-radius:13px;background:#fff;
  }
  .hp-root[data-portal-layout="classic"] .hp-status {
    color:#367355;background:#e7f1e9;border-color:#d0e3d4;
  }
  .hp-root[data-portal-layout="classic"] .hp-status-dot { background:#438863;box-shadow:none; }
  .hp-root[data-portal-layout="classic"] .hp-title {
    color:#183b39;
    background:none;
    -webkit-text-fill-color:#183b39;
    letter-spacing:-.055em;
    font-family:Georgia,"Times New Roman",serif;
    font-size:clamp(2.5rem,5vw,3.65rem);
    font-weight:600;
    line-height:1.04;
    text-wrap:balance;
  }
  .hp-root[data-portal-layout="classic"] .hp-empty-plans { color:#71817b !important; }
  .hp-root[data-portal-layout="classic"] .hp-subtitle,
  .hp-root[data-portal-layout="classic"] .hp-badge { color:#647773; }
  .hp-root[data-portal-layout="classic"] .hp-wifi-wrap::before,
  .hp-root[data-portal-layout="classic"] .hp-wifi-wrap::after { border-color:#d5a99a; }
  .hp-root[data-portal-layout="classic"] .hp-wifi-box {
    border:0;border-radius:28px;color:#fff;
    background:#d9684c;
    box-shadow:0 16px 32px rgba(217,104,76,.18);
  }
  .hp-root[data-portal-layout="classic"] .hp-wifi-box svg {
    color:#fff !important;
    stroke:#fff !important;
  }
  .hp-root[data-portal-layout="classic"] .hp-main.has-hero {
    display:grid;
    grid-template-columns:minmax(250px,.78fr) minmax(0,1.22fr);
    gap:26px;
    align-items:start;
    max-width:1120px;
    padding-top:36px;
  }
  .hp-root[data-portal-layout="classic"] .hp-main.has-hero > .hp-hero {
    grid-column:1;
    position:sticky;
    top:96px;
    padding:28px 22px;
    border:1px solid #dfe5dc;
    border-radius:24px;
    background:rgba(255,255,255,.64);
    text-align:left;
  }
  .hp-root[data-portal-layout="classic"] .hp-main.has-hero > .hp-hero > * {
    margin-left:0;
    margin-right:0;
    text-align:left;
  }
  .hp-root[data-portal-layout="classic"] .hp-main.has-hero .hp-badges { justify-content:flex-start; }
  .hp-root[data-portal-layout="classic"] .hp-main.has-hero > :not(.hp-hero):not(.hp-footer):not([role="alert"]) {
    grid-column:2;
    width:100%;
  }
  .hp-root[data-portal-layout="classic"] .hp-main.has-hero > [role="alert"],
  .hp-root[data-portal-layout="classic"] .hp-main.has-hero > .hp-footer { grid-column:1 / -1; }
  .hp-root[data-portal-layout="classic"] .hp-tabs {
    border:1px solid #dfe5dc;border-radius:16px;
    background:rgba(255,255,255,.72);
    box-shadow:0 12px 28px rgba(33,67,60,.06);
  }
  .hp-root[data-portal-layout="classic"] .hp-tab { color:#71817b; }
  .hp-root[data-portal-layout="classic"] .hp-tab.active { background:#285b50;color:#fff; }
  .hp-root[data-portal-layout="classic"] .hp-tab:not(.active):hover { background:#edf3ed;color:#285b50; }
  .hp-root[data-portal-layout="classic"] .hp-glass,
  .hp-root[data-portal-layout="classic"] .hp-plan-card {
    color:#183b39;border:1px solid #dfe5dc;border-radius:18px;
    background:#fff;box-shadow:0 14px 34px rgba(33,67,60,.08);
    backdrop-filter:none;
  }
  .hp-root[data-portal-layout="classic"] .hp-glass-header {
    border-bottom-color:#e6ebe5;
  }
  .hp-root[data-portal-layout="classic"] .hp-glass-title,
  .hp-root[data-portal-layout="classic"] .hp-plan-title { color:#183b39; }
  .hp-root[data-portal-layout="classic"] .hp-glass-desc,
  .hp-root[data-portal-layout="classic"] .hp-plan-meta { color:#71817b; }
  .hp-root[data-portal-layout="classic"] .hp-purchase-hero {
    color:#183b39;background:#edf3ed;border-color:#d9e4d9;
  }
  .hp-root[data-portal-layout="classic"] .hp-purchase-title { color:#183b39; }
  .hp-root[data-portal-layout="classic"] .hp-purchase-copy { color:#647773; }
  .hp-root[data-portal-layout="classic"] .hp-purchase-icon {
    color:#d9684c;background:#fff;border-color:#e6d8d0;
  }
  .hp-root[data-portal-layout="classic"] .hp-trust-item {
    color:#647773;background:rgba(255,255,255,.7);border-color:#e1e8e0;
  }
  .hp-root[data-portal-layout="classic"] .hp-plan {
    color:#183b39;background:#fff;border-color:#dfe5dc;
    box-shadow:0 12px 28px rgba(33,67,60,.07);
  }
  .hp-root[data-portal-layout="classic"] .hp-plan:hover { border-color:#b8cec0; }
  .hp-root[data-portal-layout="classic"] .hp-plan-name { color:#285b50; }
  .hp-root[data-portal-layout="classic"] .hp-plan-price { color:#183b39; }
  .hp-root[data-portal-layout="classic"] .hp-plan-price span,
  .hp-root[data-portal-layout="classic"] .hp-plan-meta-row,
  .hp-root[data-portal-layout="classic"] .hp-plan-action,
  .hp-root[data-portal-layout="classic"] .hp-plan-action svg { color:#71817b; }
  .hp-root[data-portal-layout="classic"] .hp-plan-action,
  .hp-root[data-portal-layout="classic"] .hp-plan-pay { border-top-color:#e6ebe5; }
  .hp-root[data-portal-layout="classic"] .hp-input,
  .hp-root[data-portal-layout="classic"] .hp-tv-input,
  .hp-root[data-portal-layout="classic"] .hp-tv-select {
    color:#183b39;background:#f8f9f5;border-color:#d8e1d9;
  }
  .hp-root[data-portal-layout="classic"] .hp-input::placeholder,
  .hp-root[data-portal-layout="classic"] .hp-tv-input::placeholder { color:#899994; }
  .hp-root[data-portal-layout="classic"] .hp-label,
  .hp-root[data-portal-layout="classic"] .hp-tv-label { color:#647773; }
  .hp-root[data-portal-layout="classic"] .hp-btn {
    color:#fff;background:#d9684c;border-color:#d9684c;
    box-shadow:none;
  }
  .hp-root[data-portal-layout="classic"] .hp-btn:hover:not(:disabled) {
    background:#bd573d;border-color:#bd573d;
  }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-dialog,
  .hp-root[data-portal-layout="classic"] .hp-tv-modal,
  .hp-root[data-portal-layout="classic"] .hp-tv-success-card {
    color:#183b39;background:#fff;border-color:#dfe5dc;
    box-shadow:0 22px 64px rgba(33,67,60,.16);
  }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-dialog-title,
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-dialog-description,
  .hp-root[data-portal-layout="classic"] .hp-tv-modal-head h3,
  .hp-root[data-portal-layout="classic"] .hp-tv-modal-head p,
  .hp-root[data-portal-layout="classic"] .hp-tv-device-row strong,
  .hp-root[data-portal-layout="classic"] .hp-tv-save-device strong { color:#183b39; }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-modal-action,
  .hp-root[data-portal-layout="classic"] .hp-tv-device-action,
  .hp-root[data-portal-layout="classic"] .hp-tv-modal-close {
    color:#285b50;background:#edf3ed;border-color:#d9e4d9;
  }
  .hp-root[data-portal-layout="classic"] .hp-tv-device-row,
  .hp-root[data-portal-layout="classic"] .hp-tv-save-device {
    background:#f4f7f2;border-color:#dfe8df;
  }
  .hp-root[data-portal-layout="classic"] .hp-footer { color:#71817b; }
  .hp-root[data-portal-layout="classic"] .hp-device-identity span {
    color:#71817b !important;
    background:#f4f7f2 !important;
    border-color:#dfe5dc !important;
  }
  .hp-root[data-portal-layout="classic"] .hp-device-identity-value { color:#285b50 !important; }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-card {
    border-color:#dfe5dc;
    border-radius:20px;
    background:linear-gradient(145deg,#fff,#f1f5ef);
    box-shadow:0 16px 36px rgba(33,67,60,.08);
  }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-card::before {
    opacity:.08;
    background:radial-gradient(ellipse at 25% 38%,rgba(217,104,76,.2),transparent 42%);
  }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-card::after { display:none; }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-card-icon {
    color:#fff;
    background:#d9684c;
    border-color:#d9684c;
    box-shadow:none;
  }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-eyebrow { color:#d9684c; }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-card h3 { color:#183b39; }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-card p { color:#647773; }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-card-action {
    color:#fff;
    background:#d9684c;
    border-color:#d9684c;
    border-radius:11px;
    box-shadow:none;
  }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-card-action:focus-visible,
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-modal-action:focus-visible,
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-close:focus-visible {
    outline-color:#285b50;
  }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-overlay {
    background:rgba(24,59,57,.4);
  }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-dialog {
    color:#183b39;
    background:#fff;
    border-color:#dfe5dc;
    box-shadow:0 22px 64px rgba(33,67,60,.16);
  }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-dialog-icon {
    color:#fff;
    background:#d9684c;
    border-color:#d9684c;
  }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-dialog-kicker { color:#d9684c; }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-close,
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-modal-action {
    color:#285b50;
    background:#edf3ed;
    border-color:#d9e4d9;
  }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-modal-action.primary {
    color:#fff;
    background:#d9684c;
    border-color:#d9684c;
  }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-device,
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-session-meta > div {
    background:#f4f7f2;
    border-color:#dfe5dc;
  }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-device-label,
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-session-meta span,
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-modal-footnote { color:#71817b; }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-device strong,
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-status-heading strong,
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-session-meta strong { color:#183b39; }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-status-copy { color:#647773; }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-status[data-tone="active"] {
    background:#edf5ef;
    border-color:#d3e7d8;
  }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-status[data-tone="warning"] {
    background:#fbf4e8;
    border-color:#eee1c5;
  }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-status[data-tone="help"] {
    background:#fbefeb;
    border-color:#efd8d0;
  }
  .hp-root[data-portal-layout="classic"] .hp-troubleshoot-note {
    color:#285b50;
    background:#edf3ed;
    border-color:#d9e4d9;
  }
  .hp-root[data-portal-layout="split-horizon"] .hp-main {
    display:grid;
    grid-template-columns:minmax(260px,.78fr) minmax(0,1.22fr);
    gap:24px;
    align-items:start;
    max-width:1120px;
  }
  .hp-root[data-portal-layout="split-horizon"] .hp-hero {
    grid-column:1;
    position:sticky;
    top:96px;
    padding:24px 18px;
    border:1px solid rgba(255,255,255,.1);
    border-radius:24px;
    background:rgba(255,255,255,.045);
    text-align:left;
  }
  .hp-root[data-portal-layout="split-horizon"] .hp-hero > * { margin-left:0; margin-right:0; }
  .hp-root[data-portal-layout="split-horizon"] .hp-main > :not(.hp-hero) { grid-column:2; }
  .hp-root[data-portal-layout="split-horizon"] .hp-subtitle { margin-left:0; }
  .hp-root[data-portal-layout="coastal-light"] {
    color:#17344d;
    background:radial-gradient(circle at 50% -10%,#d8effb,transparent 38%),#edf6fb;
  }
  .hp-root[data-portal-layout="coastal-light"] .hp-header {
    background:rgba(255,255,255,.92);
    border-bottom-color:rgba(15,61,91,.12);
  }
  .hp-root[data-portal-layout="coastal-light"] .hp-title {
    color:#17344d;
    background:none;
    -webkit-text-fill-color:#17344d;
  }
  .hp-root[data-portal-layout="coastal-light"] .hp-subtitle,
  .hp-root[data-portal-layout="coastal-light"] .hp-logo-sub,
  .hp-root[data-portal-layout="coastal-light"] .hp-badge { color:#526c80; }
  .hp-root[data-portal-layout="coastal-light"] .hp-glass,
  .hp-root[data-portal-layout="coastal-light"] .hp-plan-card {
    color:#17344d;
    border-color:#d5e5ef;
    background:#fff;
    box-shadow:0 12px 30px rgba(25,72,100,.12);
  }
  .hp-root[data-portal-layout="coastal-light"] .hp-glass-title,
  .hp-root[data-portal-layout="coastal-light"] .hp-glass-desc { color:#17344d; }
  .hp-root[data-portal-layout="signal-grid"] .hp-header {
    background:rgba(5,22,24,.9);
    border-bottom-color:rgba(45,212,191,.26);
  }
  .hp-root[data-portal-layout="signal-grid"] .hp-title {
    letter-spacing:.035em;
    text-transform:uppercase;
  }
  .hp-root[data-portal-layout="signal-grid"] .hp-glass,
  .hp-root[data-portal-layout="signal-grid"] .hp-plan-card {
    border:1px solid rgba(45,212,191,.28);
    border-radius:9px;
    background:rgba(10,36,38,.9);
  }
  .hp-root[data-portal-layout="warm-studio"] {
    background:radial-gradient(circle at 50% -8%,rgba(251,146,60,.18),transparent 38%),#241b16;
  }
  .hp-root[data-portal-layout="warm-studio"] .hp-header {
    background:rgba(44,33,25,.92);
    border-bottom-color:rgba(251,146,60,.22);
  }
  .hp-root[data-portal-layout="warm-studio"] .hp-hero { padding:24px 14px; }
  .hp-root[data-portal-layout="warm-studio"] .hp-glass,
  .hp-root[data-portal-layout="warm-studio"] .hp-plan-card {
    border-color:rgba(251,191,143,.24);
    border-radius:22px;
    background:rgba(61,44,33,.94);
  }
  .hp-root[data-portal-layout="forest-pulse"] {
    background:radial-gradient(circle at 50% -8%,rgba(34,197,94,.17),transparent 40%),#06180e;
  }
  .hp-root[data-portal-layout="forest-pulse"] .hp-header {
    background:rgba(5,25,15,.92);
    border-bottom-color:rgba(74,222,128,.24);
  }
  .hp-root[data-portal-layout="forest-pulse"] .hp-title { text-shadow:0 0 34px rgba(74,222,128,.24); }
  .hp-root[data-portal-layout="forest-pulse"] .hp-glass,
  .hp-root[data-portal-layout="forest-pulse"] .hp-plan-card {
    border-color:rgba(74,222,128,.24);
    border-radius:22px;
    background:rgba(8,35,20,.94);
  }
  @media (max-width:760px) {
    .hp-root[data-portal-layout="classic"] .hp-main.has-hero {
      display:flex;
      flex-direction:column;
      gap:0;
    }
    .hp-root[data-portal-layout="classic"] .hp-main.has-hero > .hp-hero {
      position:static;
      width:100%;
    }
    .hp-root[data-portal-layout="classic"] .hp-main.has-hero > :not(.hp-hero) { width:100%; }
    .hp-root[data-portal-layout="split-horizon"] .hp-main {
      display:flex;
      flex-direction:column;
    }
    .hp-root[data-portal-layout="split-horizon"] .hp-hero {
      position:static;
      width:100%;
    }
    .hp-root[data-portal-layout="split-horizon"] .hp-main > :not(.hp-hero) { width:100%; }
  }
  .hp-root[data-portal-layout="dansted-wifi"] {
    color:#f5f5f5;
    background-color:#151617;
    background-image:
      linear-gradient(63deg,transparent 0 34%,rgba(255,255,255,.15) 35%,rgba(255,255,255,.025) 40%,transparent 47%),
      linear-gradient(112deg,transparent 0 54%,rgba(255,255,255,.12) 55%,rgba(255,255,255,.02) 60%,transparent 67%),
      repeating-linear-gradient(45deg,#252627 0 3px,#101112 3px 7px),
      repeating-linear-gradient(-45deg,rgba(255,255,255,.13) 0 2px,transparent 2px 7px);
    background-attachment:fixed;
    font-family:"DM Sans","Trebuchet MS",sans-serif;
    --isp-accent:#3acb56 !important;
    --isp-accent-glow:rgba(58,203,86,.14) !important;
    --isp-accent-border:rgba(58,203,86,.5) !important;
    --isp-accent-strong:#38c957 !important;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-header,
  .hp-root[data-portal-layout="dansted-wifi"] .hp-tabs { display:none !important; }
  .hp-root[data-portal-layout="dansted-wifi"]::before {
    opacity:.14;
    background-image:linear-gradient(45deg,rgba(255,255,255,.42) 1px,transparent 1px);
    background-size:14px 14px;
    mask-image:linear-gradient(to bottom,black,transparent 86%);
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-header {
    min-height:54px;
    color:#f3f3f3;
    background:rgba(14,15,16,.94);
    border-bottom:1px solid rgba(255,255,255,.13);
    box-shadow:0 5px 20px rgba(0,0,0,.32);
    backdrop-filter:blur(9px);
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-logo-image,
  .hp-root[data-portal-layout="dansted-wifi"] .hp-brand-mark,
  .hp-root[data-portal-layout="dansted-wifi"] .hp-status { display:none; }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-brand-name { color:#f3f3f3; }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-header-reconnect {
    color:#f4f4f4;
    font-size:.78rem;
    text-decoration:none;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-main { max-width:900px; padding:14px 20px 72px; }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-hero {
    max-width:720px;
    margin:0 auto 12px;
    padding:0;
    border:0;
    border-radius:0;
    background:transparent;
    box-shadow:none;
    backdrop-filter:none;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-wifi-wrap,
  .hp-root[data-portal-layout="dansted-wifi"] .hp-badges,
  .hp-root[data-portal-layout="dansted-wifi"] .hp-kicker,
  .hp-root[data-portal-layout="dansted-wifi"] .hp-purchase-icon,
  .hp-root[data-portal-layout="dansted-wifi"] .hp-trust-row { display:none; }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-title {
    display:block;
    width:min(100%,360px);
    margin:0 auto 9px;
    padding:4px 8px;
    color:#38d856;
    border:1px solid rgba(255,255,255,.13);
    border-radius:7px;
    background:rgba(77,78,79,.78);
    box-shadow:0 5px 18px rgba(0,0,0,.16);
    -webkit-text-fill-color:#38d856;
    font-size:clamp(1rem,4vw,1.5rem);
    overflow-wrap:anywhere;
    font-weight:800;
    letter-spacing:-.035em;
    line-height:1.2;
    text-transform:uppercase;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-subtitle {
    max-width:none;
    margin:5px 0 0;
    color:#f5f5f5;
    font-size:.84rem;
    line-height:1.5;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-main { padding:0 12px 24px; }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-purchase-instructions { text-align:left; }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-purchase-instructions {
    margin:0 auto;
    padding:10px 12px;
    border:1px solid rgba(255,255,255,.16);
    border-radius:9px;
    background:rgba(77,78,79,.8);
    box-shadow:0 8px 20px rgba(0,0,0,.2);
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-purchase-instructions > strong {
    display:block;
    margin-bottom:6px;
    text-align:center;
    font-size:.94rem;
    font-weight:800;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-purchase-instructions ol {
    margin:0;
    padding:0;
    list-style:none;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-purchase-instructions li {
    margin:2px 0;
    color:#f5f5f5;
    font-size:.78rem;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-purchase-instructions p {
    margin:6px 0 0;
    text-align:center;
    color:#f5f5f5;
    font-size:.76rem;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-section {
    padding:8px 12px 24px;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-purchase-hero {
    margin:0 auto 10px;
    padding:12px 14px;
    color:#f5f5f5;
    border:1px solid rgba(255,255,255,.14);
    border-radius:9px;
    background:rgba(76,77,78,.68);
    text-align:center;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-purchase-title,
  .hp-root[data-portal-layout="dansted-wifi"] .hp-purchase-copy { color:#f5f5f5; }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-purchase-title { font-size:.95rem; }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-purchase-copy { font-size:.78rem; }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-tv-trigger {
    position:fixed;
    z-index:45;
    right:14px;
    bottom:14px;
    color:#fff;
    background:#e81e51;
    border:0;
    border-radius:999px;
    box-shadow:0 5px 16px rgba(0,0,0,.42);
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-plans-grid {
    display:flex;
    flex-wrap:wrap;
    justify-content:center;
    gap:10px;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-plan {
    flex:0 1 126px;
    min-width:112px;
    min-height:118px;
    padding:10px 9px;
    color:#202020;
    border:2px solid #4389ef;
    border-radius:0;
    background:#fff;
    box-shadow:0 4px 12px rgba(0,0,0,.32);
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-plan:nth-child(4n + 2) { border-color:#63bd42; }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-plan:nth-child(4n + 3) { border-color:#a341cf; }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-plan:nth-child(4n + 4) { border-color:#d84c4c; }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-plan-name { color:#218d43; }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-plan-price { color:#d13b42; }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-plan-price span,
  .hp-root[data-portal-layout="dansted-wifi"] .hp-plan-meta-row,
  .hp-root[data-portal-layout="dansted-wifi"] .hp-plan-action { color:#252525; }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-plan-action,
  .hp-root[data-portal-layout="dansted-wifi"] .hp-plan-pay { border-top-color:#e2e2e2; }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-plan-accent { display:none; }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-plan-pay .hp-btn,
  .hp-root[data-portal-layout="dansted-wifi"] .hp-btn {
    color:#172016;
    background:linear-gradient(100deg,#f04432,#b8f64a);
    border-color:#39c955;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-plan-pay .hp-btn-mpesa {
    color:#fff;
    background:linear-gradient(135deg,#16a34a,#0f766e);
    border-color:rgba(255,255,255,.28);
    box-shadow:0 8px 20px rgba(15,118,110,.3);
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-plan-pay .hp-btn-mpesa:hover:not(:disabled) {
    filter:brightness(1.08);
    transform:translateY(-1px);
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-plan-pay .hp-btn-mpesa[aria-busy="true"] {
    opacity:1;
    filter:saturate(1);
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-plan-action { display:none; }
  .hp-root[data-portal-layout="dansted-wifi"] .dansted-checkout-overlay {
    position:fixed;
    inset:0;
    z-index:1000;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:12px;
    background:rgba(0,0,0,.5);
  }
  .hp-root[data-portal-layout="dansted-wifi"] .dansted-checkout-modal {
    position:relative;
    width:min(100%,430px);
    max-height:calc(100vh - 24px);
    overflow:auto;
    padding:30px 20px 22px;
    border-radius:5px;
    background:#fff;
    color:#555;
    box-shadow:0 18px 52px rgba(0,0,0,.35);
    text-align:center;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .dansted-checkout-modal h2 {
    color:#555;
    font-size:clamp(1.25rem,5vw,1.65rem);
    line-height:1.15;
    margin:0 16px 10px;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .dansted-checkout-modal p {
    max-width:360px;
    margin:0 auto 18px;
    color:#777;
    font-size:.92rem;
    line-height:1.4;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .dansted-checkout-modal input {
    width:100%;
    min-height:50px;
    padding:12px 14px;
    border:1px solid #b8d6e4;
    border-radius:4px;
    background:#fff;
    color:#333;
    font:inherit;
    font-size:1rem;
    outline:none;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .dansted-checkout-modal input:focus {
    border-color:#3194cf;
    box-shadow:0 0 0 3px rgba(49,148,207,.14);
  }
  .hp-root[data-portal-layout="dansted-wifi"] .dansted-checkout-modal button:not(.dansted-checkout-close) {
    min-width:160px;
    min-height:46px;
    margin-top:18px;
    padding:11px 20px;
    border:0;
    border-radius:4px;
    background:#3188cc;
    color:#fff;
    font:inherit;
    font-weight:700;
    cursor:pointer;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .dansted-checkout-modal button:disabled {
    opacity:.55;
    cursor:not-allowed;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .dansted-checkout-close {
    position:absolute;
    top:4px;
    right:8px;
    border:0;
    background:transparent;
    color:#999;
    font-size:28px;
    cursor:pointer;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .dansted-checkout-error { margin-top:8px; color:#b42318; font-size:.83rem; }
  .hp-root[data-portal-layout="dansted-wifi"] .dansted-checkout-progress {
    min-height:460px;
    display:flex;
    flex-direction:column;
    align-items:center;
    justify-content:space-between;
    padding-top:40px;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .dansted-checkout-loader {
    width:min(58vw,230px);
    aspect-ratio:1;
    display:grid;
    place-items:center;
    position:relative;
    border-radius:50%;
    background:conic-gradient(from 220deg,#3198d1 0deg,#69b7e3 245deg,#e4f0f7 246deg 360deg);
    animation:dansted-loader-turn 2.2s linear infinite;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .dansted-checkout-loader::before {
    content:"";
    position:absolute;
    inset:13%;
    border-radius:50%;
    background:#fff;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .dansted-checkout-loader span {
    position:relative;
    color:#278bc6;
    font-size:1.15rem;
    font-weight:800;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .dansted-checkout-progress > strong { color:#555; font-size:1.45rem; }
  .hp-root[data-portal-layout="dansted-wifi"] .dansted-checkout-progress small { color:#888; }
  .hp-root[data-portal-layout="dansted-wifi"] .dansted-checkout-progress button:not(.dansted-checkout-close) { margin-top:12px; }
  @keyframes dansted-loader-turn { to { transform:rotate(360deg); } }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-glass,
  .hp-root[data-portal-layout="dansted-wifi"] .hp-plan-card,
  .hp-root[data-portal-layout="dansted-wifi"] [aria-labelledby="hp-loyalty-balance-title"] {
    color:#f5f5f5;
    border:1px solid rgba(255,255,255,.2);
    border-radius:10px;
    background:rgba(77,78,79,.76);
    box-shadow:0 8px 20px rgba(0,0,0,.2);
    backdrop-filter:blur(7px);
  }
  .hp-root[data-portal-layout="dansted-wifi"] [aria-labelledby="hp-loyalty-balance-title"] {
    color:#f5f5f5 !important;
    background:rgba(77,78,79,.76) !important;
    border:1px solid rgba(255,255,255,.2) !important;
    border-radius:10px !important;
    box-shadow:0 8px 20px rgba(0,0,0,.2) !important;
    backdrop-filter:blur(7px);
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-glass-header { border-bottom-color:rgba(255,255,255,.14); }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-glass-title,
  .hp-root[data-portal-layout="dansted-wifi"] .hp-glass-desc { color:#f5f5f5; }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-input,
  .hp-root[data-portal-layout="dansted-wifi"] .hp-tv-input,
  .hp-root[data-portal-layout="dansted-wifi"] .hp-tv-select {
    color:#222;
    background:#fff;
    border-color:#e84c4c;
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-input::placeholder,
  .hp-root[data-portal-layout="dansted-wifi"] .hp-tv-input::placeholder { color:#777; }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-label,
  .hp-root[data-portal-layout="dansted-wifi"] .hp-tv-label { color:rgba(255,255,255,.84); }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-troubleshoot-dialog,
  .hp-root[data-portal-layout="dansted-wifi"] .hp-tv-modal,
  .hp-root[data-portal-layout="dansted-wifi"] .hp-tv-success-card {
    color:#f4f5f3;
    background:#292b2c;
    border-color:rgba(255,255,255,.2);
  }
  .hp-root[data-portal-layout="dansted-wifi"] .hp-footer { color:rgba(255,255,255,.68); }
  .hp-root[data-portal-layout="dansted-wifi"] [aria-labelledby="hp-loyalty-balance-title"] h2,
  .hp-root[data-portal-layout="dansted-wifi"] [aria-labelledby="hp-loyalty-balance-title"] p,
  .hp-root[data-portal-layout="dansted-wifi"] [aria-labelledby="hp-loyalty-balance-title"] div { color:#f5f5f5 !important; }
  @media (max-width:760px) {
    .hp-root[data-portal-layout="dansted-wifi"] .hp-main { padding-inline:0; }
    .hp-root[data-portal-layout="dansted-wifi"] .hp-hero { margin:8px 12px 12px; padding:0; }
    .hp-root[data-portal-layout="dansted-wifi"] .hp-plans-grid { gap:8px; }
    .hp-root[data-portal-layout="dansted-wifi"] .hp-plan {
      flex-basis:calc(25% - 8px);
      min-width:78px;
      min-height:108px;
      padding:8px 5px;
    }
    .hp-root[data-portal-layout="dansted-wifi"] .hp-section { padding:6px 8px 20px; }
  }
`;