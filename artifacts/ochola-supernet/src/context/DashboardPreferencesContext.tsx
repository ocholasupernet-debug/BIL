import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getAdminApiToken, isLoggedIn } from "@/lib/supabase";
import {
  DEFAULT_DASHBOARD_PREFERENCES,
  normalizeDashboardPreferences,
  type DashboardPreferences,
} from "@/lib/dashboard-preferences";

interface DashboardPreferencesContextValue {
  preferences: DashboardPreferences;
  loading: boolean;
  saving: boolean;
  refresh: () => Promise<void>;
  savePreferences: (next: DashboardPreferences) => Promise<DashboardPreferences>;
}

const DashboardPreferencesContext = createContext<DashboardPreferencesContextValue | null>(null);

function adminHeaders(): Record<string, string> {
  const token = getAdminApiToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function DashboardPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState(DEFAULT_DASHBOARD_PREFERENCES);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    if (!isLoggedIn()) {
      setPreferences(DEFAULT_DASHBOARD_PREFERENCES);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/admin/dashboard-preferences", {
        cache: "no-store",
        headers: { ...adminHeaders(), "Cache-Control": "no-cache" },
      });
      if (!response.ok) return;
      const data = await response.json() as { preferences?: Partial<DashboardPreferences> };
      if (data.preferences) setPreferences(normalizeDashboardPreferences(data.preferences));
    } catch {
      /* Use the default dashboard when the optional preferences service is unavailable. */
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

  const savePreferences = async (next: DashboardPreferences): Promise<DashboardPreferences> => {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/dashboard-preferences", {
        method: "PUT",
        headers: adminHeaders(),
        body: JSON.stringify({ preferences: normalizeDashboardPreferences(next) }),
      });
      const data = await response.json() as { preferences?: Partial<DashboardPreferences>; error?: string };
      if (!response.ok || !data.preferences) {
        throw new Error(data.error || "Dashboard appearance could not be saved.");
      }
      const saved = normalizeDashboardPreferences(data.preferences);
      setPreferences(saved);
      return saved;
    } finally {
      setSaving(false);
    }
  };

  const value = useMemo<DashboardPreferencesContextValue>(() => ({
    preferences,
    loading,
    saving,
    refresh,
    savePreferences,
  }), [preferences, loading, saving]);

  return <DashboardPreferencesContext.Provider value={value}>{children}</DashboardPreferencesContext.Provider>;
}

export function useDashboardPreferences(): DashboardPreferencesContextValue {
  const context = useContext(DashboardPreferencesContext);
  if (!context) throw new Error("useDashboardPreferences must be used inside DashboardPreferencesProvider");
  return context;
}