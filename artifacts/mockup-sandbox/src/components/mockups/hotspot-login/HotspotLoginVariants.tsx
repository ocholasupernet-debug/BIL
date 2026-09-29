import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Gauge,
  LockKeyhole,
  Radio,
  ShieldCheck,
  Signal,
  Smartphone,
  Ticket,
  Tv,
  UserRound,
  Wifi,
  X,
  Zap,
} from "lucide-react";

type Concept = {
  id: string;
  name: string;
  descriptor: string;
  eyebrow: string;
};

const concepts: Concept[] = [
  { id: "utility", name: "Neighbourhood", descriptor: "Dependable, local, clear", eyebrow: "A connection you can count on" },
  { id: "screen", name: "On screen", descriptor: "Streaming, lively, bold", eyebrow: "Your next good night in" },
  { id: "guest", name: "Guest access", descriptor: "Welcoming, calm, easy", eyebrow: "Come in. Get connected." },
  { id: "signal", name: "Signal desk", descriptor: "Fast, factual, precise", eyebrow: "Know exactly what you get" },
  { id: "home", name: "At home", descriptor: "Warm, familiar, together", eyebrow: "Good Wi-Fi lives here" },
];

type PortalTab = "buy" | "signin" | "voucher" | "tv";

const tabLabels: { id: PortalTab; label: string }[] = [
  { id: "buy", label: "Buy access" },
  { id: "signin", label: "Sign in" },
  { id: "voucher", label: "Voucher" },
  { id: "tv", label: "Connect TV" },
];

export default function HotspotLoginVariants() {
  const [conceptId, setConceptId] = useState("utility");
  const [activeTab, setActiveTab] = useState<PortalTab>("buy");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [voucher, setVoucher] = useState("");
  const concept = concepts.find((item) => item.id === conceptId) ?? concepts[0];

  function onDemoSubmit(event: FormEvent<HTMLFormElement>, message: string) {
    event.preventDefault();
    setNotice(message);
  }

  function switchTab(tab: PortalTab) {
    setActiveTab(tab);
    setNotice("");
  }

  return (
    <div className={`hotspot-demo concept-${concept.id}`}>
      <style>{styles}</style>
      <div className="demo-shell">
        <header className="demo-topbar">
          <div className="demo-mark">
            <span className="brand-symbol"><Wifi size={18} strokeWidth={2.5} /></span>
            <span>Ochola<span className="brand-light">Supernet</span></span>
            <span className="prototype-pill">CONCEPT PREVIEW</span>
          </div>
          <div className="topbar-right">
            <span className="network-status"><span className="live-dot" /> Hotspot ready</span>
            <button className="help-button" type="button" onClick={() => setNotice("Demo help: choose a package, then select how you want to connect.")}>
              <CircleHelp size={16} /> Help
            </button>
          </div>
        </header>

        <section className="concept-picker" aria-label="Choose a visual concept">
          <div className="picker-copy">
            <span className="picker-label">FIVE WAYS TO SAY CONNECTED</span>
            <span className="picker-hint">Choose a direction</span>
          </div>
          <div className="concept-options" role="tablist" aria-label="Hotspot page concepts">
            {concepts.map((item, index) => (
              <button
                className={`concept-option ${concept.id === item.id ? "selected" : ""}`}
                type="button"
                role="tab"
                aria-selected={concept.id === item.id}
                key={item.id}
                onClick={() => { setConceptId(item.id); setNotice(""); }}
              >
                <span className="option-index">0{index + 1}</span>
                <span className="option-name">{item.name}</span>
              </button>
            ))}
          </div>
        </section>

        <main className="portal-stage">
          <div className="visual-column">
            <div className="hero-art" aria-hidden="true">
              {concept.id === "utility" && (
                <div className="utility-art">
                  <div className="utility-sun" />
                  <div className="utility-roof" />
                  <div className="utility-house"><span /><i /><b /></div>
                  <div className="utility-pole"><i /><i /><i /></div>
                  <span className="utility-caption">YOUR STREET<br />YOUR SIGNAL</span>
                  <div className="art-stamp"><Wifi size={18} /> LOCAL<br />&amp; RELIABLE</div>
                </div>
              )}
              {concept.id === "screen" && (
                <div className="screen-art">
                  <div className="screen-glow" />
                  <div className="screen-window">
                    <span className="screen-window-dot" />
                    <span className="screen-window-dot" />
                    <span className="screen-window-dot" />
                    <div className="screen-play" />
                  </div>
                  <div className="screen-orbit orbit-one" />
                  <div className="screen-orbit orbit-two" />
                  <span className="screen-side-note">STREAM<br />TOGETHER</span>
                  <span className="screen-number">01—24</span>
                </div>
              )}
              {concept.id === "guest" && (
                <div className="guest-art">
                  <div className="guest-sun" />
                  <div className="guest-arch arch-back" />
                  <div className="guest-arch arch-front"><Wifi size={35} /></div>
                  <div className="guest-plant plant-left"><i /><i /><i /></div>
                  <div className="guest-plant plant-right"><i /><i /><i /></div>
                  <span className="guest-art-note">A LITTLE ROOM<br />TO ROAM</span>
                </div>
              )}
              {concept.id === "signal" && (
                <div className="signal-art">
                  <div className="signal-grid" />
                  <div className="signal-ring ring-a" />
                  <div className="signal-ring ring-b" />
                  <div className="signal-ring ring-c" />
                  <div className="signal-core"><Signal size={32} /></div>
                  <span className="signal-label label-a">100<br /><small>MBPS MAX</small></span>
                  <span className="signal-label label-b">1.0<br /><small>GB FUP</small></span>
                  <span className="signal-coord">01°17' S / 36°49' E</span>
                </div>
              )}
              {concept.id === "home" && (
                <div className="home-art">
                  <div className="home-window"><span /><span /><span /><span /></div>
                  <div className="home-shelf" />
                  <div className="home-plant"><i /><i /><i /><b /></div>
                  <div className="home-lamp"><i /><b /></div>
                  <div className="home-sofa"><span /><i /><b /></div>
                  <div className="home-wifi"><Wifi size={21} /></div>
                  <span className="home-note">EVERY ROOM.<br />EVERYONE.</span>
                </div>
              )}
            </div>
            <div className="hero-copy">
              <p className="hero-eyebrow">{concept.eyebrow}</p>
              <h1>
                {concept.id === "utility" && <>Internet that<br /><em>shows up.</em></>}
                {concept.id === "screen" && <>Make tonight<br /><em>a good one.</em></>}
                {concept.id === "guest" && <>Welcome to<br /><em>your Wi-Fi.</em></>}
                {concept.id === "signal" && <>Clear terms.<br /><em>Full signal.</em></>}
                {concept.id === "home" && <>Better together,<br /><em>at home.</em></>}
              </h1>
              <p className="hero-description">
                {concept.id === "utility" && "Straightforward Wi-Fi for the people and places right around you."}
                {concept.id === "screen" && "Reliable neighbourhood internet for the show, match or movie you came for."}
                {concept.id === "guest" && "A simple connection for your visit. Pick a pass and settle in."}
                {concept.id === "signal" && "No guesswork. Review the exact allowance, time and speed before you connect."}
                {concept.id === "home" && "One simple pass for the family calls, catch-ups and screen time."}
              </p>
              <div className="trust-line"><ShieldCheck size={16} /> Clear pricing · Secure M-Pesa checkout</div>
            </div>
          </div>

          <section className="access-panel" aria-label="Hotspot access options">
            <div className="panel-heading">
              <div>
                <span className="panel-overline">{concept.id === "signal" ? "AVAILABLE PASS / 01" : "GET CONNECTED"}</span>
                <h2>{activeTab === "buy" ? "Choose your access" : tabLabels.find((tab) => tab.id === activeTab)?.label}</h2>
              </div>
              <span className="secure-mark"><LockKeyhole size={13} /> SECURE</span>
            </div>

            <nav className="access-tabs" aria-label="Access method">
              {tabLabels.map((tab) => (
                <button key={tab.id} type="button" className={activeTab === tab.id ? "active" : ""} onClick={() => switchTab(tab.id)}>
                  {tab.id === "buy" && <Radio size={15} />}
                  {tab.id === "signin" && <UserRound size={15} />}
                  {tab.id === "voucher" && <Ticket size={15} />}
                  {tab.id === "tv" && <Tv size={15} />}
                  <span>{tab.label}</span>
                </button>
              ))}
            </nav>

            {activeTab === "buy" && (
              <div className="buy-content">
                <article className="package-card">
                  <div className="package-topline">
                    <span className="plan-tag"><span /> DAILY PASS</span>
                    <span className="plan-code">OSN / 01</span>
                  </div>
                  <div className="package-price">
                    <span className="currency">KSh</span>
                    <strong>10</strong>
                    <span className="price-unit">one-time<br />payment</span>
                  </div>
                  <div className="package-rule" />
                  <div className="package-facts">
                    <div className="fact">
                      <Clock3 size={17} />
                      <span><small>VALID FOR</small><b>24 hours</b></span>
                    </div>
                    <div className="fact">
                      <Gauge size={17} />
                      <span><small>DATA ALLOWANCE</small><b>1 GB <i>FUP</i></b></span>
                    </div>
                    <div className="fact">
                      <Zap size={17} />
                      <span><small>DOWNLOAD SPEED</small><b>Up to 100 Mbps</b></span>
                    </div>
                  </div>
                  <p className="fup-note"><span>FUP</span> 1 GB fair-use data allowance is included with this 24-hour pass.</p>
                  <button className="primary-action" type="button" onClick={() => { setPaymentOpen(true); setNotice(""); }}>
                    <Smartphone size={17} /> Continue with M-Pesa <ArrowRight size={17} />
                  </button>
                  <p className="package-footnote"><ShieldCheck size={13} /> Pay KSh 10 once. No recurring charges.</p>
                </article>
                <div className="other-ways">
                  <span>Already have access?</span>
                  <button type="button" onClick={() => switchTab("signin")}>Sign in <ChevronRight size={14} /></button>
                </div>
              </div>
            )}

            {activeTab === "signin" && (
              <form className="simple-form" onSubmit={(event) => onDemoSubmit(event, "Sign-in is a visual preview. No account was checked.")}>
                <p className="form-intro">Already bought a pass? Enter the hotspot details you received.</p>
                <label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Your hotspot username" autoComplete="username" /></label>
                <label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" type="password" autoComplete="current-password" /></label>
                <button className="primary-action" type="submit">Sign in to Wi-Fi <ArrowRight size={17} /></button>
                <p className="form-foot"><LockKeyhole size={13} /> Credentials are only for this demo form.</p>
              </form>
            )}

            {activeTab === "voucher" && (
              <form className="simple-form" onSubmit={(event) => onDemoSubmit(event, "Voucher redemption is not active in this visual demo.")}>
                <div className="form-icon"><Ticket size={21} /></div>
                <p className="form-intro">Have a prepaid voucher? Enter its code to continue.</p>
                <label>Voucher code<input value={voucher} onChange={(event) => setVoucher(event.target.value.toUpperCase())} placeholder="e.g. OCH-4821" /></label>
                <button className="primary-action" type="submit">Redeem voucher <ArrowRight size={17} /></button>
                <p className="form-foot">Voucher codes are not validated in this preview.</p>
              </form>
            )}

            {activeTab === "tv" && (
              <div className="tv-content">
                <div className="tv-banner">
                  <div className="tv-icon"><Tv size={22} /></div>
                  <div><strong>Connect a television</strong><span>Choose the TV or streaming device on this network.</span></div>
                </div>
                <div className="tv-device">
                  <span className="tv-device-icon"><Tv size={18} /></span>
                  <span><b>Living room TV</b><small>Smart TV · this network</small></span>
                  <span className="radio-check"><Check size={13} /></span>
                </div>
                <div className="tv-pass">
                  <span><small>SELECTED PASS</small><b>KSh 10 · 24 hours</b></span>
                   <span className="tv-speed">1 GB FUP · 100 Mbps</span>
                </div>
                <button className="primary-action" type="button" onClick={() => { setPaymentOpen(true); setNotice(""); }}>
                  Choose TV access <ArrowRight size={17} />
                </button>
                <p className="form-foot">TV connection is shown for preview only.</p>
              </div>
            )}
            {notice && <div className="demo-notice" role="status"><Check size={15} />{notice}</div>}
          </section>
        </main>

        <footer className="portal-footer">
          <span><span className="footer-wifi"><Wifi size={13} /></span> OcholaSupernet <span className="footer-sep">/</span> Neighbourhood internet</span>
          <span>Need a hand? <button type="button" onClick={() => setNotice("For real service support, contact your local OcholaSupernet agent.")}>Talk to your local agent <ArrowRight size={12} /></button></span>
        </footer>
      </div>

      {paymentOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaymentOpen(false); }}>
          <section className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-title">
            <button className="modal-close" type="button" aria-label="Close" onClick={() => setPaymentOpen(false)}><X size={18} /></button>
            <div className="modal-kicker"><Smartphone size={15} /> M-PESA CHECKOUT PREVIEW</div>
            <h2 id="payment-title">Ready when you are.</h2>
            <p>Enter the mobile number you would use to pay. This mockup will not send a payment request.</p>
            <label className="phone-label">M-Pesa phone number
              <div className="phone-input"><span>+254</span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="7XX XXX XXX" inputMode="tel" /></div>
            </label>
            <div className="modal-summary"><span>Daily pass · 24 hours · 1 GB FUP</span><b>KSh 10</b></div>
            <button className="primary-action" type="button" onClick={() => { setPaymentOpen(false); setNotice("Preview only — no M-Pesa request was sent and no access was activated."); }}>
              Review payment <ArrowRight size={17} />
            </button>
            <div className="modal-safe"><ShieldCheck size={14} /> Visual demonstration only. No payment or service activation.</div>
          </section>
        </div>
      )}
    </div>
  );
}

const styles = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap');
.hotspot-demo{--ink:#24342f;--muted:#788780;--paper:#f5f4ed;--panel:#fffefa;--line:#dfe4dc;--accent:#d65c39;--accent-ink:#fffaf3;--soft:#e8eee2;--heading:'Manrope',sans-serif;--body:'DM Sans',sans-serif;--mono:'DM Mono',monospace;min-height:100vh;background:var(--paper);color:var(--ink);font-family:var(--body);padding:0 20px 28px;transition:background .25s,color .25s}
.hotspot-demo *{box-sizing:border-box}
.demo-shell{max-width:1160px;margin:0 auto}
.demo-topbar{height:65px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}
.demo-mark{display:flex;align-items:center;gap:9px;font:800 15px var(--heading);letter-spacing:-.5px}
.brand-symbol{width:30px;height:30px;display:grid;place-items:center;background:var(--accent);color:var(--accent-ink);border-radius:9px}
.brand-light{font-weight:500}
.prototype-pill{margin-left:5px;padding:5px 7px;border:1px solid var(--line);border-radius:4px;color:var(--muted);font:500 9px var(--mono);letter-spacing:.08em}
.topbar-right{display:flex;align-items:center;gap:22px}
.network-status{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:12px}
.live-dot{width:7px;height:7px;border-radius:50%;background:#66a77f;box-shadow:0 0 0 3px #66a77f22}
.help-button,.portal-footer button{display:flex;align-items:center;gap:7px;padding:7px 0;border:0;background:none;color:var(--ink);font:600 12px var(--body);cursor:pointer}
.concept-picker{min-height:75px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line)}
.picker-copy{display:flex;align-items:center;gap:13px;white-space:nowrap}
.picker-label{font:500 9px var(--mono);letter-spacing:.1em;color:var(--muted)}
.picker-hint{font-size:11px;color:var(--muted);border-left:1px solid var(--line);padding-left:13px}
.concept-options{display:flex;gap:6px;align-items:center}
.concept-option{display:flex;align-items:center;gap:7px;padding:8px 10px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--muted);font:600 11px var(--body);cursor:pointer;white-space:nowrap;transition:background .2s, color .2s, border-color .2s}
.concept-option:hover{background:var(--panel);color:var(--ink)}
.concept-option.selected{background:var(--panel);border-color:var(--line);color:var(--ink);box-shadow:0 2px 6px #26392c0a}
.option-index{font:500 9px var(--mono);opacity:.65}
.portal-stage{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:70px;align-items:center;max-width:1060px;margin:24px auto 22px;min-height:570px}
.visual-column{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:center}
.hero-art{height:360px;position:relative;overflow:hidden;border-radius:var(--art-radius,22px);background:var(--art-bg,#dfe8d6);isolation:isolate}
.hero-copy{padding:12px 3px}
.hero-eyebrow{margin:0 0 13px;color:var(--accent);font:500 10px var(--mono);letter-spacing:.1em;text-transform:uppercase}
.hero-copy h1{font:700 clamp(30px,3vw,43px)/1.07 var(--heading);letter-spacing:-2.1px;margin:0 0 16px;max-width:340px}
.hero-copy h1 em{font-family:'Newsreader',serif;font-weight:400;letter-spacing:-1.3px;color:var(--accent)}
.hero-description{font-size:14px;line-height:1.65;color:var(--muted);max-width:310px;margin:0 0 22px}
.trust-line{display:flex;align-items:center;gap:8px;color:var(--ink);font-size:11px;font-weight:600}
.trust-line svg{color:var(--accent)}
.access-panel{background:var(--panel);border:1px solid var(--line);border-radius:17px;padding:22px 22px 18px;box-shadow:0 12px 35px #28352a0b;min-height:528px;position:relative}
.panel-heading{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:15px}
.panel-overline{display:block;color:var(--muted);font:500 9px var(--mono);letter-spacing:.12em;margin-bottom:6px}
.panel-heading h2{font:700 20px var(--heading);letter-spacing:-.7px;margin:0}
.secure-mark{display:flex;align-items:center;gap:5px;color:#5f8069;font:500 9px var(--mono);letter-spacing:.05em;margin-top:3px}
.access-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;border-bottom:1px solid var(--line);padding-bottom:9px;margin-bottom:16px}
.access-tabs button{min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:8px 3px 7px;border:0;border-radius:7px;background:transparent;color:var(--muted);font:600 9px var(--body);white-space:nowrap;cursor:pointer;transition:background .18s,color .18s}
.access-tabs button svg{width:15px;height:15px}
.access-tabs button:hover{background:var(--soft);color:var(--ink)}
.access-tabs button.active{background:var(--accent);color:var(--accent-ink)}
.package-card{padding:15px 15px 11px;background:var(--package-bg,#f3f5ed);border:1px solid var(--package-border,#e1e8d9);border-radius:12px}
.package-topline{display:flex;align-items:center;justify-content:space-between}
.plan-tag{display:flex;align-items:center;gap:6px;color:var(--accent);font:500 9px var(--mono);letter-spacing:.09em}
.plan-tag span{width:6px;height:6px;border-radius:50%;background:var(--accent)}
.plan-code{font:400 9px var(--mono);color:#98a198}
.package-price{display:flex;align-items:center;margin:7px 0 12px}
.currency{font:600 14px var(--heading);margin:0 6px 0 0;align-self:flex-start;padding-top:10px}
.package-price strong{font:800 51px/.95 var(--heading);letter-spacing:-3px}
.price-unit{border-left:1px solid var(--line);margin-left:12px;padding:1px 0 1px 12px;color:var(--muted);font-size:10px;line-height:1.45}
.package-rule{height:1px;background:var(--line);margin-bottom:11px}
.package-facts{display:grid;gap:10px}
.fact{display:flex;align-items:center;gap:10px;color:var(--accent)}
.fact>span{display:flex;align-items:baseline;justify-content:space-between;flex:1;gap:10px;color:var(--ink)}
.fact small{font:500 8px var(--mono);letter-spacing:.07em;color:var(--muted)}
.fact b{font:700 11px var(--body);white-space:nowrap}
.fact b i{font:500 8px var(--mono);color:var(--accent);font-style:normal;vertical-align:1px;margin-left:2px}
.fup-note{margin:11px 0 12px;color:var(--muted);font-size:9px;line-height:1.5}
.fup-note span{font:500 8px var(--mono);color:var(--accent);padding:2px 4px;border:1px solid var(--accent);border-radius:3px;margin-right:4px}
.primary-action{width:100%;min-height:44px;padding:0 13px;display:flex;align-items:center;justify-content:center;gap:9px;border:0;border-radius:8px;background:var(--accent);color:var(--accent-ink);font:700 12px var(--body);cursor:pointer;transition:transform .18s,filter .18s}
.primary-action:hover{filter:brightness(.95);transform:translateY(-1px)}
.primary-action svg:last-child{margin-left:auto}
.package-footnote{display:flex;justify-content:center;align-items:center;gap:5px;color:var(--muted);font-size:9px;margin:9px 0 0}
.other-ways{display:flex;justify-content:space-between;align-items:center;padding:13px 2px 0;color:var(--muted);font-size:10px}
.other-ways button{display:flex;align-items:center;gap:2px;border:0;background:none;color:var(--ink);font:700 10px var(--body);cursor:pointer}
.simple-form,.tv-content{padding-top:2px}
.form-intro{font-size:12px;line-height:1.55;color:var(--muted);margin:0 0 17px}
.simple-form label,.phone-label{display:block;font:600 10px var(--body);color:var(--ink);margin:0 0 13px}
.simple-form input,.phone-input input{width:100%;height:42px;padding:0 12px;border:1px solid var(--line);border-radius:7px;background:var(--panel);color:var(--ink);font:500 12px var(--body);outline:none;margin-top:6px}
.simple-form input:focus,.phone-input:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 15%,transparent)}
.simple-form input::placeholder,.phone-input input::placeholder{color:#a7aea8}
.simple-form .primary-action{margin-top:18px}
.form-foot{display:flex;align-items:center;justify-content:center;gap:5px;text-align:center;color:var(--muted);font-size:9px;margin:12px 0 0}
.form-icon{width:42px;height:42px;display:grid;place-items:center;color:var(--accent);background:var(--soft);border-radius:11px;margin-bottom:13px}
.tv-banner{display:flex;align-items:center;gap:11px;padding:13px;background:var(--soft);border-radius:9px;margin:0 0 13px}
.tv-icon{height:38px;width:38px;display:grid;place-items:center;color:var(--accent);background:var(--panel);border-radius:9px;flex:none}
.tv-banner strong,.tv-banner span{display:block}
.tv-banner strong{font:700 12px var(--heading);margin-bottom:4px}
.tv-banner div:last-child span{font-size:9px;line-height:1.4;color:var(--muted)}
.tv-device{display:flex;align-items:center;gap:9px;border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:11px}
.tv-device-icon{width:31px;height:31px;display:grid;place-items:center;color:var(--accent);background:var(--soft);border-radius:7px}
.tv-device>span:nth-child(2){flex:1}
.tv-device b,.tv-device small{display:block}
.tv-device b{font:700 10px var(--body);margin-bottom:3px}
.tv-device small{font-size:9px;color:var(--muted)}
.radio-check{width:19px;height:19px;display:grid;place-items:center;border-radius:50%;background:var(--accent);color:var(--accent-ink)}
.tv-pass{display:flex;align-items:center;justify-content:space-between;padding:11px 2px 13px}
.tv-pass small,.tv-pass b{display:block}
.tv-pass small{font:500 8px var(--mono);color:var(--muted);letter-spacing:.08em;margin-bottom:5px}
.tv-pass b{font:700 11px var(--body)}
.tv-speed{font:500 9px var(--mono);color:var(--accent);padding:5px 7px;background:var(--soft);border-radius:4px}
.demo-notice{display:flex;align-items:flex-start;gap:7px;padding:10px 11px;margin-top:11px;background:var(--soft);border:1px solid var(--line);border-radius:7px;color:var(--ink);font-size:10px;line-height:1.45}
.demo-notice svg{color:var(--accent);flex:none;margin-top:1px}
.portal-footer{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:15px;color:var(--muted);font-size:10px}
.portal-footer>span{display:flex;align-items:center;gap:7px}
.portal-footer button{color:var(--ink);font-size:10px}
.footer-wifi{display:grid;place-items:center;width:22px;height:22px;color:var(--accent);background:var(--soft);border-radius:6px}
.footer-sep{color:var(--line)}

/* Neighbourhood utility: reassuring municipal signage and dependable green ink. */
.concept-utility{--paper:#f4f4ec;--panel:#fffefa;--ink:#26382e;--muted:#77847a;--accent:#3d7654;--accent-ink:#fff;--soft:#e6eee4;--line:#dce4da;--art-bg:#dce8d5;--art-radius:14px;--package-bg:#f1f5ed;--package-border:#dfe9db}
.concept-utility .hero-copy h1{font-size:44px;letter-spacing:-2.6px}
.concept-utility .portal-stage{grid-template-columns:minmax(0,1fr) 400px;gap:54px}
.concept-utility .hero-art{border:1px solid #c9d7c5}
.utility-art{position:absolute;inset:0;background:linear-gradient(160deg,#dce8d5 0 62%,#c5d8bf 62%);overflow:hidden}
.utility-sun{position:absolute;width:92px;height:92px;right:29px;top:24px;border-radius:50%;background:#e9cc84}
.utility-roof{position:absolute;width:187px;height:125px;left:25px;bottom:84px;background:#657b63;clip-path:polygon(50% 0,100% 48%,93% 48%,93% 100%,7% 100%,7% 48%,0 48%)}
.utility-house{position:absolute;left:53px;bottom:47px;width:132px;height:131px;background:#f4efdb;border:3px solid #657b63}
.utility-house span{position:absolute;left:19px;top:23px;width:33px;height:42px;border:4px solid #71927a;background:#c1d3ba}
.utility-house i{position:absolute;right:19px;top:23px;width:33px;height:42px;border:4px solid #71927a;background:#c1d3ba}
.utility-house b{position:absolute;left:52px;bottom:0;width:30px;height:55px;border:4px solid #657b63;border-bottom:0;background:#bc9563}
.utility-pole{position:absolute;right:36px;bottom:48px;width:9px;height:198px;background:#566d5c}
.utility-pole:before,.utility-pole:after{content:"";position:absolute;height:4px;background:#566d5c;left:-27px;width:62px}
.utility-pole:before{top:32px}.utility-pole:after{top:67px}
.utility-pole i{position:absolute;z-index:2;left:-28px;top:28px;width:4px;height:10px;background:#e0bd72}.utility-pole i:nth-child(2){left:0}.utility-pole i:nth-child(3){left:29px}
.utility-caption{position:absolute;left:20px;top:20px;color:#58715c;font:500 9px/1.6 var(--mono);letter-spacing:.1em}
.art-stamp{position:absolute;right:18px;bottom:17px;width:73px;height:73px;border:1px solid #628368;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:#55725b;text-align:center;font:500 8px/1.35 var(--mono);transform:rotate(10deg)}

/* On screen: graphic film-frame composition, vivid vermilion, ink and electric yellow. */
.concept-screen{--paper:#f8eee4;--panel:#fffaf4;--ink:#24231f;--muted:#80756d;--accent:#ed4d32;--accent-ink:#fff7ec;--soft:#f4dfce;--line:#ead8c7;--art-bg:#24231f;--package-bg:#fff4e9;--package-border:#f1d9c4;--heading:'Manrope',sans-serif}
.concept-screen .hero-art{border-radius:3px 28px 3px 28px}
.concept-screen .hero-copy h1{font-size:42px;line-height:1.02;letter-spacing:-2.5px}
.concept-screen .hero-copy h1 em{color:#e84f32}
.concept-screen .access-panel{border-radius:4px;box-shadow:7px 7px 0 #e9d8c6}
.concept-screen .package-card{border-radius:3px}
.concept-screen .primary-action{border-radius:3px}
.concept-screen .access-tabs button.active{border-radius:3px}
.screen-art{position:absolute;inset:0;background:#24231f;overflow:hidden}
.screen-glow{position:absolute;width:225px;height:225px;border-radius:50%;background:#e94c32;filter:blur(1px);left:45px;top:66px}
.screen-window{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-7deg);width:230px;height:163px;border:8px solid #f4e5d3;background:linear-gradient(140deg,#ec5535 0 45%,#eea63e 45% 64%,#506254 64%);box-shadow:13px 14px 0 #141411}
.screen-window-dot{position:absolute;top:-4px;left:8px;width:4px;height:4px;border-radius:50%;background:#24231f}
.screen-window-dot:nth-child(2){left:17px}.screen-window-dot:nth-child(3){left:26px}
.screen-play{position:absolute;left:50%;top:50%;transform:translate(-40%,-50%);width:0;height:0;border-top:19px solid transparent;border-bottom:19px solid transparent;border-left:28px solid #fff4dd}
.screen-orbit{position:absolute;border:1px solid #f2d899;border-radius:50%;width:310px;height:310px;left:-120px;top:184px;transform:rotate(-20deg)}
.orbit-two{width:340px;height:340px;left:auto;right:-244px;top:-144px;border-color:#e95438;transform:rotate(24deg)}
.screen-side-note{position:absolute;right:19px;top:19px;font:500 9px/1.6 var(--mono);letter-spacing:.12em;color:#f1d69f}
.screen-number{position:absolute;left:20px;bottom:18px;color:#fff4dd;font:500 10px var(--mono);letter-spacing:.12em}

/* Guest access: quiet hospitality, generous breathing room and soft botanical details. */
.concept-guest{--paper:#edf3ef;--panel:#fbfffc;--ink:#29403d;--muted:#7c9290;--accent:#3e827c;--accent-ink:#f9fffb;--soft:#e3efeb;--line:#d9e7e1;--art-bg:#dcece4;--package-bg:#eff7f2;--package-border:#dcebe2;--heading:'Newsreader',serif}
.concept-guest .hero-copy h1{font-size:44px;line-height:1.02;letter-spacing:-1.4px;font-weight:500}
.concept-guest .hero-copy h1 em{color:#4e8e83;font-style:italic}
.concept-guest .access-panel{border-radius:24px;padding:23px 24px 19px;box-shadow:0 15px 40px #47675d10}
.concept-guest .package-card{border-radius:16px}
.concept-guest .primary-action{border-radius:22px}
.concept-guest .hero-art{border-radius:48% 48% 22px 22px}
.guest-art{position:absolute;inset:0;background:#dcece4;overflow:hidden}
.guest-sun{position:absolute;width:178px;height:178px;left:50%;top:47px;transform:translateX(-50%);border-radius:50%;background:#eadbb9}
.guest-arch{position:absolute;bottom:-68px;left:50%;transform:translateX(-50%);width:240px;height:320px;border-radius:130px 130px 0 0}
.arch-back{width:277px;height:293px;bottom:-102px;background:#b4d2c4}
.arch-front{bottom:-130px;background:#4d8276;color:#e8f0de;display:flex;justify-content:center;padding-top:57px}
.guest-plant{position:absolute;bottom:33px;width:60px;height:100px;border-bottom:8px solid #a27c5e}
.plant-left{left:18px}.plant-right{right:17px;transform:scaleX(-1)}
.guest-plant i{position:absolute;bottom:5px;left:25px;width:25px;height:48px;border-radius:100% 0 100% 0;background:#668b70;transform:rotate(-22deg)}
.guest-plant i:nth-child(2){left:8px;bottom:23px;transform:rotate(-52deg) scale(.8)}
.guest-plant i:nth-child(3){left:31px;bottom:42px;transform:rotate(10deg) scale(.78)}
.guest-art-note{position:absolute;left:22px;top:21px;color:#537c70;font:500 8px/1.6 var(--mono);letter-spacing:.12em}

/* Signal desk: instrument-panel typography, graph paper and precise labels. */
.concept-signal{--paper:#eff3f2;--panel:#fcfefd;--ink:#21383c;--muted:#74888c;--accent:#147b73;--accent-ink:#f3fffb;--soft:#e0efeb;--line:#d9e5e3;--art-bg:#d8e9e6;--package-bg:#edf6f3;--package-border:#d7e9e4;--mono:'DM Mono',monospace;--heading:'DM Sans',sans-serif}
.concept-signal .hero-copy h1{font-size:43px;letter-spacing:-2px}
.concept-signal .hero-copy h1 em{font-style:normal;font-family:var(--mono);font-size:.9em;letter-spacing:-3px}
.concept-signal .hero-art{border-radius:8px}
.concept-signal .access-panel{border-radius:8px;box-shadow:none}
.concept-signal .package-card{border-radius:6px}
.concept-signal .primary-action{border-radius:5px}
.concept-signal .access-tabs button.active{border-radius:5px}
.signal-art{position:absolute;inset:0;background:#d8e9e6;overflow:hidden}
.signal-grid{position:absolute;inset:0;background-image:linear-gradient(#739b9620 1px,transparent 1px),linear-gradient(90deg,#739b9620 1px,transparent 1px);background-size:24px 24px}
.signal-ring{position:absolute;left:50%;top:48%;transform:translate(-50%,-50%);border:1px solid #438a80;border-radius:50%}
.ring-a{width:110px;height:110px}.ring-b{width:195px;height:195px;border-style:dashed;opacity:.8}.ring-c{width:286px;height:286px;opacity:.55}
.signal-core{position:absolute;left:50%;top:48%;transform:translate(-50%,-50%);width:64px;height:64px;display:grid;place-items:center;background:#267f75;color:#f0fff9;border-radius:50%;box-shadow:0 0 0 9px #267f7522}
.signal-label{position:absolute;padding:6px 8px;background:#f5fbf8;border:1px solid #a8c9c1;color:#267f75;font:500 13px/1.1 var(--mono)}
.signal-label small{font-size:7px;letter-spacing:.08em}
.label-a{top:63px;right:23px}.label-b{bottom:54px;left:20px}
.signal-coord{position:absolute;left:18px;top:17px;color:#668782;font:400 8px var(--mono);letter-spacing:.08em}

/* At home: intimate mid-century illustration, peach walls and tactile shapes. */
.concept-home{--paper:#f6eee5;--panel:#fffaf4;--ink:#41352f;--muted:#938179;--accent:#c76747;--accent-ink:#fff9ef;--soft:#f2e0d0;--line:#ead9cb;--art-bg:#f2ddc5;--package-bg:#fbf0e4;--package-border:#efddc9;--heading:'Manrope',sans-serif}
.concept-home .hero-copy h1{font-size:41px;line-height:1.06;letter-spacing:-2.4px}
.concept-home .hero-copy h1 em{color:#b86346}
.concept-home .hero-art{border-radius:24px 24px 72px 24px}
.concept-home .access-panel{border-radius:24px 24px 9px 24px}
.concept-home .package-card{border-radius:17px 17px 6px 17px}
.concept-home .primary-action{border-radius:7px 17px 7px 7px}
.home-art{position:absolute;inset:0;background:#f2ddc5;overflow:hidden}
.home-window{position:absolute;right:22px;top:21px;width:94px;height:106px;display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:6px;background:#f8eddb;border:5px solid #9e7155;border-radius:3px}
.home-window span{background:#b8c8a3}
.home-window span:nth-child(2),.home-window span:nth-child(3){background:#ead19c}
.home-shelf{position:absolute;left:0;right:0;bottom:54px;height:11px;background:#9b6749}
.home-sofa{position:absolute;left:45px;bottom:65px;width:208px;height:90px;border-radius:28px 28px 10px 10px;background:#ce7857}
.home-sofa:before{content:"";position:absolute;left:-15px;right:-15px;bottom:-11px;height:32px;background:#bb694c;border-radius:8px}
.home-sofa span{position:absolute;left:19px;top:15px;width:68px;height:52px;background:#e9a77b;border-radius:12px}
.home-sofa i{position:absolute;right:18px;top:15px;width:68px;height:52px;background:#e8a57b;border-radius:12px}
.home-sofa b{position:absolute;left:50%;top:16px;width:1px;height:50px;background:#bc704e}
.home-plant{position:absolute;left:13px;bottom:66px;width:34px;height:90px}
.home-plant b{position:absolute;left:7px;bottom:0;width:23px;height:26px;background:#a86d4e;border-radius:4px 4px 9px 9px}
.home-plant i{position:absolute;left:11px;bottom:23px;width:14px;height:47px;background:#66836a;border-radius:100% 0 100% 0;transform:rotate(-17deg)}
.home-plant i:nth-child(2){left:0;bottom:32px;transform:rotate(-51deg) scale(.8)}
.home-plant i:nth-child(3){left:20px;bottom:42px;transform:rotate(25deg) scale(.8)}
.home-lamp{position:absolute;left:54px;top:55px;width:61px;height:88px}
.home-lamp i{position:absolute;top:0;left:0;width:57px;height:39px;border-radius:50% 50% 8px 8px;background:#d99b50}
.home-lamp b{position:absolute;left:27px;top:37px;width:4px;height:49px;background:#9d704f}
.home-lamp:after{content:"";position:absolute;left:13px;bottom:0;width:33px;height:4px;background:#9d704f;border-radius:3px}
.home-wifi{position:absolute;right:34px;bottom:32px;width:42px;height:42px;border-radius:50%;display:grid;place-items:center;color:#fff6e9;background:#c76747}
.home-note{position:absolute;left:18px;top:19px;color:#a96749;font:500 8px/1.6 var(--mono);letter-spacing:.1em}

.modal-backdrop{position:fixed;z-index:20;inset:0;display:grid;place-items:center;padding:18px;background:#1d2826a6;backdrop-filter:blur(4px)}
.payment-modal{position:relative;width:min(100%,420px);padding:29px;background:var(--panel);border:1px solid var(--line);border-radius:18px;box-shadow:0 22px 80px #16211f44;animation:modalIn .22s ease-out}
.modal-close{position:absolute;right:15px;top:15px;display:grid;place-items:center;width:32px;height:32px;border:1px solid var(--line);border-radius:50%;background:transparent;color:var(--muted);cursor:pointer}
.modal-kicker{display:flex;align-items:center;gap:7px;color:var(--accent);font:500 9px var(--mono);letter-spacing:.1em;margin-bottom:13px}
.payment-modal h2{font:700 26px var(--heading);letter-spacing:-1px;margin:0 0 8px}
.payment-modal>p{font-size:12px;line-height:1.6;color:var(--muted);margin:0 0 22px}
.phone-input{display:flex;align-items:center;height:45px;border:1px solid var(--line);border-radius:8px;margin-top:7px;overflow:hidden}
.phone-input:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 15%,transparent)}
.phone-input>span{padding:0 12px;border-right:1px solid var(--line);font:600 12px var(--mono);color:var(--muted)}
.phone-input input{height:100%;border:0;border-radius:0;margin:0;box-shadow:none!important}
.modal-summary{display:flex;align-items:center;justify-content:space-between;margin:18px 0;padding:13px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:10px;color:var(--muted)}
.modal-summary b{font:700 14px var(--heading);color:var(--ink)}
.modal-safe{display:flex;align-items:center;justify-content:center;gap:6px;color:var(--muted);font-size:9px;margin-top:13px;text-align:center}
.modal-safe svg{color:var(--accent);flex:none}
@keyframes modalIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:1000px){.portal-stage,.concept-utility .portal-stage{grid-template-columns:minmax(0,1fr) 380px;gap:28px}.visual-column{grid-template-columns:1fr;gap:17px;align-content:center}.hero-art{height:255px}.hero-copy h1,.concept-utility .hero-copy h1,.concept-screen .hero-copy h1,.concept-guest .hero-copy h1,.concept-signal .hero-copy h1,.concept-home .hero-copy h1{font-size:36px}.hero-copy h1 br{display:none}.hero-description{margin-bottom:14px}.portal-stage{min-height:540px}.concept-picker{align-items:flex-start;flex-direction:column;justify-content:center;padding:13px 0;gap:9px}.picker-copy{gap:10px}}
@media(max-width:740px){.hotspot-demo{padding:0 15px 20px}.demo-topbar{height:58px}.prototype-pill{display:none}.topbar-right{gap:13px}.network-status{font-size:10px}.help-button{font-size:11px}.concept-picker{margin-bottom:17px;min-height:0;padding:12px 0}.picker-copy{width:100%;justify-content:space-between}.picker-label{font-size:8px}.picker-hint{font-size:10px}.concept-options{width:100%;overflow:auto;padding:0 0 3px;scrollbar-width:none}.concept-options::-webkit-scrollbar{display:none}.concept-option{padding:7px 9px;font-size:10px}.portal-stage,.concept-utility .portal-stage{display:flex;flex-direction:column;align-items:stretch;gap:19px;margin:0 auto;min-height:0}.visual-column{display:grid;grid-template-columns: minmax(0,1fr) minmax(0,1fr);gap:14px;align-items:center}.hero-art{height:205px;min-width:0}.hero-copy{padding:0}.hero-eyebrow{font-size:8px;line-height:1.5;margin-bottom:8px}.hero-copy h1,.concept-utility .hero-copy h1,.concept-screen .hero-copy h1,.concept-guest .hero-copy h1,.concept-signal .hero-copy h1,.concept-home .hero-copy h1{font-size:clamp(24px,7vw,34px);line-height:1.05;letter-spacing:-1.5px;margin-bottom:9px}.hero-copy h1 br{display:block}.hero-description{font-size:11px;line-height:1.48;margin-bottom:11px}.trust-line{font-size:9px;gap:5px}.trust-line svg{width:14px}.access-panel{min-height:0;padding:17px 16px 14px;border-radius:14px}.panel-heading{margin-bottom:12px}.panel-heading h2{font-size:18px}.access-tabs{margin-bottom:13px}.access-tabs button{font-size:9px}.package-card{padding:13px 12px 10px}.package-price{margin:6px 0 10px}.package-price strong{font-size:48px}.fact{gap:8px}.fact>span{gap:4px}.fact small{font-size:7px}.fact b{font-size:10px}.fup-note{font-size:9px}.primary-action{min-height:45px}.portal-footer{gap:12px;align-items:flex-start;font-size:9px}.portal-footer>span:last-child{display:block;text-align:right}.portal-footer button{justify-content:flex-end;font-size:9px;margin-left:auto}.footer-sep{display:none}.footer-wifi{flex:none}}
@media(max-width:380px){.hotspot-demo{padding:0 11px 17px}.visual-column{grid-template-columns:1fr;gap:10px}.hero-art{height:174px}.hero-copy h1,.concept-utility .hero-copy h1,.concept-screen .hero-copy h1,.concept-guest .hero-copy h1,.concept-signal .hero-copy h1,.concept-home .hero-copy h1{font-size:31px}.hero-copy h1 br{display:none}.hero-description{max-width:none}.trust-line{display:none}.concept-option{padding:7px;font-size:9px}.option-index{display:none}.access-panel{padding:15px 12px}.access-tabs button{font-size:8px}.fact small{letter-spacing:0}.package-price strong{font-size:45px}}
`;