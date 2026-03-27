import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase, ADMIN_ID } from "@/lib/supabase";

export interface Brand {
  ispName:      string;   // e.g. "OcholaSupernet"
  domain:       string;   // e.g. "isplatty.org"
  supportEmail: string;   // e.g. "support@isplatty.org"
  adminName:    string;   // full name of the admin
  phone:        string;
  country:      string;
  loading:      boolean;
}

const DEFAULT: Brand = {
  ispName:      "OcholaSupernet",
  domain:       "isplatty.org",
  supportEmail: "support@isplatty.org",
  adminName:    "Administrator",
  phone:        "",
  country:      "Kenya",
  loading:      true,
};

const BrandContext = createContext<Brand>(DEFAULT);

export function useBrand(): Brand {
  return useContext(BrandContext);
}

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [brand, setBrand] = useState<Brand>(DEFAULT);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("isp_admins")
          .select("name, email, admin_name, phone, country")
          .eq("id", ADMIN_ID)
          .single();

        if (error || !data) throw error ?? new Error("no row");

        /* derive domain from email */
        const row = data as Record<string, string>;
        let domain = "";
        if (row.email) {
          domain = row.email.split("@")[1] || "";
        }
        if (!domain) domain = DEFAULT.domain;

        setBrand({
          ispName:      row.name       || DEFAULT.ispName,
          domain,
          supportEmail: row.email      || `support@${domain}`,
          adminName:    row.admin_name || DEFAULT.adminName,
          phone:        row.phone      || "",
          country:      row.country    || DEFAULT.country,
          loading:      false,
        });
      } catch {
        /* table might not exist yet or row is missing — use defaults */
        setBrand(prev => ({ ...prev, loading: false }));
      }
    })();
  }, []);

  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}
