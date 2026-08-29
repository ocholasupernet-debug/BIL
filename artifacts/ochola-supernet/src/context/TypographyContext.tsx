import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { isLoggedIn, ADMIN_ID } from "@/lib/supabase";
import { DEFAULT_TYPOGRAPHY, type TypographyPreferences } from "@/lib/typography";

interface TypographyContextValue extends TypographyPreferences {
  loading: boolean;
  refresh: () => Promise<void>;
}

const TypographyContext = createContext<TypographyContextValue>({
  ...DEFAULT_TYPOGRAPHY,
  loading: true,
  refresh: async () => {},
});

function contextAdminId(): number {
  try {
    const params = new URLSearchParams(window.location.search);
    const queryId = Number(params.get("adminId") ?? params.get("ispId"));
    if (Number.isSafeInteger(queryId) && queryId > 0) return queryId;
  } catch {}
  return ADMIN_ID;
}

function applyTypography(preferences: TypographyPreferences) {
  const root = document.documentElement;
  root.style.setProperty("--isp-font-family", `"${preferences.fontFamily}", system-ui, sans-serif`);
  root.style.setProperty("--isp-font-size", `${preferences.fontSize}px`);
  root.style.setProperty("--isp-font-style", preferences.fontStyle);
  root.style.setProperty("--isp-font-weight", String(preferences.fontWeight));
}

export function TypographyProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<TypographyPreferences>(DEFAULT_TYPOGRAPHY);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const id = contextAdminId();
    if (!id || (!isLoggedIn() && window.location.pathname.startsWith("/admin"))) {
      setPreferences(DEFAULT_TYPOGRAPHY);
      applyTypography(DEFAULT_TYPOGRAPHY);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/public/typography?adminId=${id}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Typography request failed");
      const data = await response.json() as Partial<TypographyPreferences>;
      const next: TypographyPreferences = {
        fontFamily: typeof data.fontFamily === "string" ? data.fontFamily : DEFAULT_TYPOGRAPHY.fontFamily,
        fontStyle: data.fontStyle === "italic" || data.fontStyle === "oblique" ? data.fontStyle : "normal",
        fontWeight: typeof data.fontWeight === "number" ? data.fontWeight : DEFAULT_TYPOGRAPHY.fontWeight,
        fontSize: typeof data.fontSize === "number" ? data.fontSize : DEFAULT_TYPOGRAPHY.fontSize,
      };
      setPreferences(next);
      applyTypography(next);
    } catch {
      applyTypography(DEFAULT_TYPOGRAPHY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handleAuthChange = () => { void refresh(); };
    const handleTypographyChange = () => { void refresh(); };
    window.addEventListener("ochola-auth-change", handleAuthChange);
    window.addEventListener("isp-typography-change", handleTypographyChange);
    return () => {
      window.removeEventListener("ochola-auth-change", handleAuthChange);
      window.removeEventListener("isp-typography-change", handleTypographyChange);
    };
  }, [refresh]);

  return (
    <TypographyContext.Provider value={{ ...preferences, loading, refresh }}>
      {children}
    </TypographyContext.Provider>
  );
}

export function useTypography() {
  return useContext(TypographyContext);
}