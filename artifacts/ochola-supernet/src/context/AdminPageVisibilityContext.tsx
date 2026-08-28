import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_ADMIN_PAGE_VISIBILITY,
  isAdminFeatureVisible,
  type AdminVisibilitySection,
} from "@/lib/admin-page-visibility";
import { getAdminApiToken, isLoggedIn } from "@/lib/supabase";

interface AdminPageVisibilityContextValue {
  visibility: Record<string, boolean>;
  loading: boolean;
  isVisible: (featureKey: string) => boolean;
  refresh: () => Promise<void>;
}

const AdminPageVisibilityContext = createContext<AdminPageVisibilityContextValue | null>(null);

export function AdminPageVisibilityProvider({ children }: { children: React.ReactNode }) {
  const [visibility, setVisibility] = useState(DEFAULT_ADMIN_PAGE_VISIBILITY);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    if (!isLoggedIn()) {
      setVisibility(DEFAULT_ADMIN_PAGE_VISIBILITY);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const token = getAdminApiToken();
      const response = await fetch("/api/admin/page-visibility", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) return;
      const data = await response.json() as { visibility?: Record<string, boolean> };
      if (data.visibility && typeof data.visibility === "object") {
        setVisibility({ ...DEFAULT_ADMIN_PAGE_VISIBILITY, ...data.visibility });
      }
    } catch {
      /* Fail open: a settings outage must not lock admins out of the panel. */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const handleAuthChange = () => { void refresh(); };
    window.addEventListener("ochola-auth-change", handleAuthChange);
    return () => window.removeEventListener("ochola-auth-change", handleAuthChange);
  }, []);

  const value = useMemo<AdminPageVisibilityContextValue>(() => ({
    visibility,
    loading,
    isVisible: (featureKey: string) => isAdminFeatureVisible(visibility, featureKey),
    refresh,
  }), [visibility, loading]);

  return <AdminPageVisibilityContext.Provider value={value}>{children}</AdminPageVisibilityContext.Provider>;
}

export function useAdminPageVisibility(): AdminPageVisibilityContextValue {
  const context = useContext(AdminPageVisibilityContext);
  if (!context) throw new Error("useAdminPageVisibility must be used inside AdminPageVisibilityProvider");
  return context;
}

export type { AdminVisibilitySection };