import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase, ADMIN_ID } from "@/lib/supabase";
import { setAdminCurrency, setAdminCountryLocal } from "@/lib/utils";

export interface Brand {
  ispName:      string;   // e.g. "OcholaSupernet"
  domain:       string;   // e.g. "isplatty.org"
  supportEmail: string;   // e.g. "support@isplatty.org"
  adminName:    string;   // full name of the admin
  phone:        string;
  country:      string;
  currency:     string;   // ISO 4217 e.g. "KES"
  loading:      boolean;
}

const DEFAULT: Brand = {
  ispName:      "OcholaSupernet",
  domain:       "isplatty.org",
  supportEmail: "support@isplatty.org",
  adminName:    "Administrator",
  phone:        "",
  country:      "Kenya",
  currency:     "KES",
  loading:      true,
};

const BrandContext = createContext<Brand>(DEFAULT);

export function useBrand(): Brand {
  return useContext(BrandContext);
}

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [brand, setBrand] = useState<Brand>(DEFAULT);
  const [adminId, setAdminId] = useState<number>(ADMIN_ID);

  useEffect(() => {
    const handler = () => {
      try { setAdminId(parseInt(localStorage.getItem("ochola_admin_id") || "5")); } catch {}
    };
    window.addEventListener("ochola-auth-change", handler);
    return () => window.removeEventListener("ochola-auth-change", handler);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("isp_admins")
          .select("name, email, phone, area, username, subdomain, currency")
          .eq("id", adminId)
          .maybeSingle();

        if (error || !data) throw error ?? new Error("no row");

        /* derive domain from subdomain field or email */
        const row = data as Record<string, string>;
        let domain = row.subdomain || "";
        if (!domain && row.email) {
          domain = row.email.split("@")[1] || "";
        }
        if (!domain) domain = DEFAULT.domain;

        const country  = row.area     || DEFAULT.country;
        const currency = row.currency || DEFAULT.currency;

        /* persist to localStorage so formatCurrency works instantly anywhere */
        setAdminCurrency(currency);
        setAdminCountryLocal(country);

        setBrand({
          ispName:      DEFAULT.ispName,              /* platform name stays hardcoded */
          domain,
          supportEmail: row.email    || `support@${domain}`,
          adminName:    row.name     || row.username  || DEFAULT.adminName,
          phone:        row.phone    || "",
          country,
          currency,
          loading:      false,
        });
      } catch {
        /* table might not exist yet or row is missing — use defaults */
        setBrand(prev => ({ ...prev, loading: false }));
      }
    })();
  }, [adminId]);

  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}
