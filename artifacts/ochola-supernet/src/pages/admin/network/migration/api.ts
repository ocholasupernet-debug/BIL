import { getAdminApiToken } from "@/lib/supabase";

function getHeaders() {
  const token = getAdminApiToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function fetchRouters() {
  const res = await fetch("/api/router-migrations/routers", { headers: getHeaders() });
  const data = await res.json();
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) throw new Error(data.error || "Failed to load routers");
  return data.routers || [];
}

export async function analyzeSource(sourceRouterId: number) {
  const res = await fetch("/api/router-migrations/analyze", {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ sourceRouterId }),
  });
  const data = await res.json();
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) throw new Error(data.error || "Failed to analyze source router");
  return data;
}

export async function exportSource(sourceRouterId: number) {
  const res = await fetch("/api/router-migrations/export", {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ sourceRouterId }),
  });
  const data = await res.json();
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) throw new Error(data.error || "Failed to export source router config");
  return data;
}

export async function setTargetRouter(id: string, targetRouterId: number) {
  const res = await fetch(`/api/router-migrations/${id}/target`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ targetRouterId }),
  });
  const data = await res.json();
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) throw new Error(data.error || "Failed to set target router");
  return data;
}

export async function runDryRun({ id, approvedItemIds }: { id: string, approvedItemIds?: string[] }) {
  const res = await fetch(`/api/router-migrations/${id}/dry-run`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(approvedItemIds ? { approvedItemIds } : {}),
  });
  const data = await res.json();
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) throw new Error(data.error || "Dry run failed");
  return data;
}

export async function runImport({ id, confirmation, approvedItemIds }: { id: string, confirmation: string, approvedItemIds: string[] }) {
  const res = await fetch(`/api/router-migrations/${id}/import`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ confirmation, approvedItemIds }),
  });
  const data = await res.json();
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) throw new Error(data.error || "Import failed");
  return data;
}

export async function getReport(id: string) {
  const res = await fetch(`/api/router-migrations/${id}/report`, { headers: getHeaders() });
  const data = await res.json();
  if (res.status === 401) throw new Error("Unauthorized");
  if (!res.ok) throw new Error(data.error || "Failed to load migration report");
  return data;
}
