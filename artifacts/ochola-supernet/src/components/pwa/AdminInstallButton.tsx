import { useEffect, useState } from "react";
import { Check, Download, Info, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
}

function isStandaloneDisplayMode(): boolean {
  if (typeof window === "undefined") return false;
  const standaloneNavigator = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || standaloneNavigator.standalone === true;
}

function isIosDevice(): boolean {
  if (typeof window === "undefined") return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
    || (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
}

export function AdminInstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandaloneDisplayMode);
  const [helpOpen, setHelpOpen] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const ios = isIosDevice();

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
      setHelpOpen(false);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (installed || prompting) return;
    if (!deferredPrompt) {
      setHelpOpen(open => !open);
      return;
    }

    setPrompting(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
    } finally {
      setDeferredPrompt(null);
      setPrompting(false);
    }
  };

  return (
    <div className="admin-install-wrap">
      <button
        type="button"
        className={`admin-install-button${installed ? " admin-install-button--installed" : ""}`}
        onClick={() => { void handleInstall(); }}
        disabled={prompting}
        aria-label={installed ? "OcholaSuperNet app is installed" : "Install OcholaSuperNet app"}
        aria-expanded={!installed && helpOpen}
        title={installed ? "OcholaSuperNet app is installed" : "Install OcholaSuperNet app"}
      >
        {installed ? <Check size={14} aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
        <span className="admin-install-label">{installed ? "Installed" : prompting ? "Installing…" : "Install app"}</span>
      </button>

      {!installed && helpOpen && (
        <div className="admin-install-help" role="status">
          <button
            type="button"
            className="admin-install-help-close"
            onClick={() => setHelpOpen(false)}
            aria-label="Close install help"
          >
            <X size={13} aria-hidden="true" />
          </button>
          <div className="admin-install-help-title">
            <Info size={14} aria-hidden="true" />
            Install OcholaSuperNet
          </div>
          <p>
            {ios
              ? "Your current admin session stays active. Tap Share in Safari, then choose Add to Home Screen."
              : "Your current admin session stays active. Open this page in Chrome or Edge over HTTPS, then use its install icon or browser menu."}
          </p>
        </div>
      )}
    </div>
  );
}