import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          action: string;
          size?: "normal" | "compact" | "flexible";
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ) => string;
      remove: (widgetId: string) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Cloudflare verification could not load."));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function TurnstileCheck({
  action,
  resetKey,
  onToken,
  size = "normal",
}: {
  action: "admin_login";
  resetKey: number;
  onToken: (token: string) => void;
  size?: "normal" | "compact" | "flexible";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState(false);
  const siteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "").trim();

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let disposed = false;
    let widgetId: string | undefined;

    void loadTurnstile().then(() => {
      if (disposed || !containerRef.current || !window.turnstile) return;
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        size,
        callback: onToken,
        "expired-callback": () => onToken(""),
        "error-callback": () => {
          onToken("");
          setLoadError(true);
        },
      });
    }).catch(() => {
      if (!disposed) setLoadError(true);
    });

    return () => {
      disposed = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [action, onToken, resetKey, siteKey, size]);

  if (!siteKey) {
    return <p role="alert" className="text-sm text-red-600">Cloudflare verification is not configured.</p>;
  }

  return (
    <div>
      <div ref={containerRef} aria-label="Cloudflare security verification" style={{ width: "100%", maxWidth: "100%" }} />
      {loadError && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          Cloudflare verification could not load. Refresh the page and try again.
        </p>
      )}
    </div>
  );
}
