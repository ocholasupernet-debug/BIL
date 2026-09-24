/**
 * Billing-only Supabase access. Replit can supply BILLING_SUPABASE_SERVICE_KEY
 * without enabling service-role access in the shared API client. Existing VPS
 * installations using the global service-role name remain compatible.
 */
type BillingTable = "platform_billing_config" | "platform_billing_invoices" | "revenue_ledger";

function credentials(): { url: string; key: string } {
  const rawUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const url = /^https?:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const key = [
    process.env.BILLING_SUPABASE_SERVICE_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SERVICE_KEY,
  ].find(value => !!value?.trim())?.trim() ?? "";
  if (!/^https:\/\//.test(url) || !key) {
    throw new Error("Server-side billing database access is not configured.");
  }
  return { url, key };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T[]> {
  const { url, key } = credentials();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`Billing database request failed (HTTP ${response.status}).`);
  return response.json() as Promise<T[]>;
}

export function billingSelect<T>(table: BillingTable, query: string): Promise<T[]> {
  return request<T>(`${table}?${query}`);
}

/** Insert once on the unique account/period constraint; never merge over a paid invoice. */
export function billingCreateInvoice<T>(payload: Record<string, unknown>): Promise<T[]> {
  return request<T>("platform_billing_invoices?on_conflict=account_id%2Cbilling_period", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(payload),
  });
}

export function billingUpdateInvoice<T>(query: string, payload: Record<string, unknown>): Promise<T[]> {
  return request<T>(`platform_billing_invoices?${query}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
}

export function billingRevenueSummary<T>(accountId: number): Promise<T[]> {
  return request<T>("rpc/get_revenue_summary", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ p_account_id: accountId }),
  });
}