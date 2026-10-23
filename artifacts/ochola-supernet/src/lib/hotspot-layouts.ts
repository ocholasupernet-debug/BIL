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
    value: "night-market",
    label: "Night Market",
    description: "A textured dark portal with bright green branding and compact outlined packages.",
    background: "#101112",
    panel: "#292b2c",
    accent: "#39e75f",
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
  "night-market": `
    html[data-portal-layout="night-market"] body {
      color: #f4f6f3 !important;
      background-color: #111314 !important;
      background-image:
        radial-gradient(ellipse at 50% 5%,rgba(255,255,255,.13),transparent 44%),
        repeating-linear-gradient(45deg,rgba(255,255,255,.045) 0 2px,transparent 2px 8px),
        repeating-linear-gradient(-45deg,rgba(0,0,0,.18) 0 2px,transparent 2px 8px) !important;
      background-attachment: fixed !important;
      font-family: "DM Sans","Trebuchet MS",sans-serif !important;
    }
    html[data-portal-layout="night-market"] .hdr {
      color: #f4f6f3 !important;
      background: rgba(18,19,20,.9) !important;
      border-bottom: 1px solid rgba(255,255,255,.12) !important;
      backdrop-filter: blur(14px);
    }
    html[data-portal-layout="night-market"] #portalNameHeader,
    html[data-portal-layout="night-market"] #portalNameFooter,
    html[data-portal-layout="night-market"] #portalHeroTitle,
    html[data-portal-layout="night-market"] #plansSection h2 {
      color: #39e75f !important;
      -webkit-text-fill-color: #39e75f !important;
      background: none !important;
      text-shadow: 0 2px 18px rgba(57,231,95,.15);
    }
    html[data-portal-layout="night-market"] #portalHeroTitle {
      font-size: clamp(2rem,5vw,3.5rem) !important;
      letter-spacing: -.045em !important;
    }
    html[data-portal-layout="night-market"] #portalTagline,
    html[data-portal-layout="night-market"] #plansSection > div:first-child > p,
    html[data-portal-layout="night-market"] #portalHero > div > div:first-child {
      color: rgba(255,255,255,.76) !important;
    }
    html[data-portal-layout="night-market"] body > .hdr + section,
    html[data-portal-layout="night-market"] .sec-card,
    html[data-portal-layout="night-market"] #plansGrid .plan-card {
      color: #f5f6f5 !important;
      border: 1px solid rgba(255,255,255,.22) !important;
      border-radius: 12px !important;
      background: rgba(47,49,50,.78) !important;
      box-shadow: 0 12px 30px rgba(0,0,0,.28) !important;
      backdrop-filter: blur(10px);
    }
    html[data-portal-layout="night-market"] #portalHero {
      padding: 1.25rem !important;
    }
    html[data-portal-layout="night-market"] #portalHero > div[style*="radial-gradient"],
    html[data-portal-layout="night-market"] #portalHero .grid-bg { opacity: .18 !important; }
    html[data-portal-layout="night-market"] .sec-head,
    html[data-portal-layout="night-market"] #plansGrid .plan-card > div:first-child {
      color: #fff !important;
      background: rgba(255,255,255,.08) !important;
      border-bottom-color: rgba(255,255,255,.16) !important;
      border-top-color: #39e75f !important;
    }
    html[data-portal-layout="night-market"] .sec-head *,
    html[data-portal-layout="night-market"] .sec-body,
    html[data-portal-layout="night-market"] .sec-body *,
    html[data-portal-layout="night-market"] #plansGrid .plan-card > div:first-child * {
      color: #f5f6f5 !important;
      -webkit-text-fill-color: #f5f6f5 !important;
    }
    html[data-portal-layout="night-market"] #plansGrid .plan-card {
      border: 2px solid #39e75f !important;
      border-radius: 3px !important;
      background: rgba(27,29,30,.88) !important;
    }
    html[data-portal-layout="night-market"] #plansGrid {
      grid-template-columns: repeat(auto-fit,minmax(118px,1fr)) !important;
      gap: .7rem !important;
    }
    html[data-portal-layout="night-market"] #plansGrid .plan-card {
      min-width: 0;
    }
    html[data-portal-layout="night-market"] #plansGrid .plan-card > div:first-child > span {
      color: #39e75f !important;
      -webkit-text-fill-color: #39e75f !important;
      background: rgba(57,231,95,.12) !important;
    }
    html[data-portal-layout="night-market"] .inp {
      color: #f5f6f5 !important;
      background: rgba(18,19,20,.82) !important;
      border-color: #39e75f !important;
    }
    html[data-portal-layout="night-market"] .inp::placeholder { color: rgba(255,255,255,.58) !important; }
    html[data-portal-layout="night-market"] .plan-connect-button,
    html[data-portal-layout="night-market"] .sec-body .btn,
    html[data-portal-layout="night-market"] .sec-body button {
      color: #111 !important;
      background: linear-gradient(100deg,#f04432,#b8f64a) !important;
      border-color: #39e75f !important;
    }
    html[data-portal-layout="night-market"] #portalFooter {
      color: rgba(255,255,255,.7) !important;
      background: rgba(25,26,27,.76) !important;
      border-top-color: rgba(255,255,255,.14) !important;
    }
    html[data-portal-layout="night-market"] #portalFooter * { color: rgba(255,255,255,.7) !important; }
    @media (max-width: 640px) {
      html[data-portal-layout="night-market"] body { padding: 0 !important; }
      html[data-portal-layout="night-market"] body > .hdr + section {
        margin: .75rem !important;
        padding: 1.5rem .9rem !important;
      }
      html[data-portal-layout="night-market"] #plansSection { padding-inline: .75rem !important; }
      html[data-portal-layout="night-market"] #plansGrid { gap: .65rem !important; }
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
  .hp-root[data-portal-layout="night-market"] {
    color:#f4f5f3;
    background-color:#111314;
    background-image:
      radial-gradient(ellipse at 50% 4%,rgba(255,255,255,.16),transparent 42%),
      repeating-linear-gradient(45deg,rgba(255,255,255,.045) 0 2px,transparent 2px 8px),
      repeating-linear-gradient(-45deg,rgba(0,0,0,.18) 0 2px,transparent 2px 8px);
    background-attachment:fixed;
    font-family:"DM Sans","Trebuchet MS",sans-serif;
    --isp-accent:#39e75f !important;
    --isp-accent-glow:rgba(57,231,95,.15) !important;
    --isp-accent-border:rgba(57,231,95,.55) !important;
    --isp-accent-strong:#39e75f !important;
  }
  .hp-root[data-portal-layout="night-market"]::before {
    opacity:.16;
    background-image:radial-gradient(rgba(255,255,255,.55) .8px,transparent .8px);
    background-size:15px 15px;
    mask-image:linear-gradient(to bottom,black,transparent 88%);
  }
  .hp-root[data-portal-layout="night-market"] .hp-header {
    color:#f4f5f3;
    background:rgba(18,19,20,.88);
    border-bottom:1px solid rgba(255,255,255,.13);
    box-shadow:0 8px 26px rgba(0,0,0,.22);
    backdrop-filter:blur(14px);
  }
  .hp-root[data-portal-layout="night-market"] .hp-brand-name,
  .hp-root[data-portal-layout="night-market"] .hp-title { color:#39e75f; }
  .hp-root[data-portal-layout="night-market"] .hp-title {
    background:none;
    -webkit-text-fill-color:#39e75f;
    letter-spacing:-.045em;
    font-size:clamp(2rem,5vw,3.4rem);
    text-shadow:0 2px 20px rgba(57,231,95,.17);
  }
  .hp-root[data-portal-layout="night-market"] .hp-logo-sub,
  .hp-root[data-portal-layout="night-market"] .hp-subtitle,
  .hp-root[data-portal-layout="night-market"] .hp-badge { color:rgba(255,255,255,.76); }
  .hp-root[data-portal-layout="night-market"] .hp-status {
    color:#8df6a2;background:rgba(57,231,95,.1);border-color:rgba(57,231,95,.28);
  }
  .hp-root[data-portal-layout="night-market"] .hp-status-dot { background:#39e75f; }
  .hp-root[data-portal-layout="night-market"] .hp-main { max-width:1080px; }
  .hp-root[data-portal-layout="night-market"] .hp-hero {
    margin:18px auto 14px;
    padding:18px 16px;
    border:1px solid rgba(255,255,255,.23);
    border-radius:12px;
    background:rgba(55,57,58,.72);
    box-shadow:0 12px 30px rgba(0,0,0,.25);
    backdrop-filter:blur(10px);
  }
  .hp-root[data-portal-layout="night-market"] .hp-glass,
  .hp-root[data-portal-layout="night-market"] .hp-plan-card {
    color:#f5f6f5;
    border:1px solid rgba(255,255,255,.23);
    border-radius:10px;
    background:rgba(45,47,48,.8);
    box-shadow:0 12px 30px rgba(0,0,0,.27);
    backdrop-filter:blur(10px);
  }
  .hp-root[data-portal-layout="night-market"] .hp-glass-header { border-bottom-color:rgba(255,255,255,.15); }
  .hp-root[data-portal-layout="night-market"] .hp-glass-title,
  .hp-root[data-portal-layout="night-market"] .hp-glass-desc,
  .hp-root[data-portal-layout="night-market"] .hp-plan-title,
  .hp-root[data-portal-layout="night-market"] .hp-plan-meta { color:#f4f5f3; }
  .hp-root[data-portal-layout="night-market"] .hp-purchase-hero {
    color:#f5f6f5;background:rgba(255,255,255,.09);border-color:rgba(255,255,255,.2);
  }
  .hp-root[data-portal-layout="night-market"] .hp-purchase-title,
  .hp-root[data-portal-layout="night-market"] .hp-purchase-copy { color:#f4f5f3; }
  .hp-root[data-portal-layout="night-market"] .hp-trust-item {
    color:rgba(255,255,255,.84);background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.18);
  }
  .hp-root[data-portal-layout="night-market"] .hp-plan {
    min-height:128px;
    padding:12px 11px;
    color:#f4f5f3;
    border:2px solid #39e75f;
    border-radius:3px;
    background:rgba(27,29,30,.9);
    box-shadow:0 8px 20px rgba(0,0,0,.24);
  }
  .hp-root[data-portal-layout="night-market"] .hp-plans-grid {
    grid-template-columns:repeat(auto-fit,minmax(126px,1fr));
    gap:10px;
  }
  .hp-root[data-portal-layout="night-market"] .hp-plans-grid.has-expanded { grid-template-columns:1fr; }
  .hp-root[data-portal-layout="night-market"] .hp-plan-top { padding:11px 10px 0; }
  .hp-root[data-portal-layout="night-market"] .hp-plan-body { padding:6px 10px 11px; }
  .hp-root[data-portal-layout="night-market"] .hp-plan:hover { border-color:#b8f64a; }
  .hp-root[data-portal-layout="night-market"] .hp-plan-name { color:#7cf394; }
  .hp-root[data-portal-layout="night-market"] .hp-plan-price { color:#ff6b63; }
  .hp-root[data-portal-layout="night-market"] .hp-plan-price span,
  .hp-root[data-portal-layout="night-market"] .hp-plan-meta-row,
  .hp-root[data-portal-layout="night-market"] .hp-plan-action { color:rgba(255,255,255,.8); }
  .hp-root[data-portal-layout="night-market"] .hp-plan-action,
  .hp-root[data-portal-layout="night-market"] .hp-plan-pay { border-top-color:rgba(255,255,255,.18); }
  .hp-root[data-portal-layout="night-market"] .hp-input,
  .hp-root[data-portal-layout="night-market"] .hp-tv-input,
  .hp-root[data-portal-layout="night-market"] .hp-tv-select {
    color:#f5f6f5;background:rgba(18,19,20,.82);border-color:#39e75f;
  }
  .hp-root[data-portal-layout="night-market"] .hp-input::placeholder,
  .hp-root[data-portal-layout="night-market"] .hp-tv-input::placeholder { color:rgba(255,255,255,.58); }
  .hp-root[data-portal-layout="night-market"] .hp-label,
  .hp-root[data-portal-layout="night-market"] .hp-tv-label { color:rgba(255,255,255,.8); }
  .hp-root[data-portal-layout="night-market"] .hp-btn {
    color:#151715;background:linear-gradient(100deg,#f04432,#b8f64a);border-color:#39e75f;
    box-shadow:0 7px 18px rgba(0,0,0,.2);
  }
  .hp-root[data-portal-layout="night-market"] .hp-btn:hover:not(:disabled) { filter:brightness(1.08); }
  .hp-root[data-portal-layout="night-market"] .hp-troubleshoot-dialog,
  .hp-root[data-portal-layout="night-market"] .hp-tv-modal,
  .hp-root[data-portal-layout="night-market"] .hp-tv-success-card {
    color:#f4f5f3;background:#252728;border-color:rgba(255,255,255,.2);
  }
  .hp-root[data-portal-layout="night-market"] .hp-troubleshoot-dialog-title,
  .hp-root[data-portal-layout="night-market"] .hp-troubleshoot-dialog-description,
  .hp-root[data-portal-layout="night-market"] .hp-tv-modal-head h3,
  .hp-root[data-portal-layout="night-market"] .hp-tv-modal-head p,
  .hp-root[data-portal-layout="night-market"] .hp-tv-device-row strong,
  .hp-root[data-portal-layout="night-market"] .hp-tv-save-device strong { color:#f4f5f3; }
  .hp-root[data-portal-layout="night-market"] .hp-footer { color:rgba(255,255,255,.68); }
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
  @media (max-width:760px) {
    .hp-root[data-portal-layout="night-market"] .hp-hero { margin:12px 12px 10px; padding:16px 13px; }
    .hp-root[data-portal-layout="night-market"] .hp-main { padding-inline:12px; }
    .hp-root[data-portal-layout="night-market"] .hp-plans-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .hp-root[data-portal-layout="night-market"] .hp-plan { min-height:118px; padding:10px 8px; }
  }
`;