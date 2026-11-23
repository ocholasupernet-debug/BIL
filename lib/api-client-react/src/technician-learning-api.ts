import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type TechnicianGuideCategory =
  | "setup"
  | "ports"
  | "wireless"
  | "recovery"
  | "connectivity"
  | "fiber"
  | "customer-care";

export type TechnicianDiagram = {
  kind: "router-ports" | "pon-leds" | "connection-path" | "decision-tree" | "wifi-coverage";
  caption: string;
  labels: string[];
};

export type TechnicianGuideStep = {
  title: string;
  instruction: string;
  check?: string;
  caution?: string;
};

export type TechnicianLearningGuide = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: TechnicianGuideCategory;
  brands: string[];
  models: string[];
  firmwareNotes: string;
  symptomTags: string[];
  likelyCauses: string[];
  safeChecks: string[];
  escalateWhen: string[];
  warnings: string[];
  steps: TechnicianGuideStep[];
  diagrams: TechnicianDiagram[];
  imageUrl: string | null;
  imageCaption: string;
  customerScript: string;
  manualUrl: string | null;
  status: "draft" | "published" | "archived";
  updatedAt: string;
};

export type TechnicianDeviceModel = {
  id: string;
  brand: string;
  model: string;
  deviceType: string;
  hardwareRevisions: string[];
  firmwareVariants: string[];
  notes: string;
  warning: string;
  manualUrl: string | null;
  imageUrl: string | null;
  imageCaption: string;
  diagram: TechnicianDiagram | null;
  status: "draft" | "published" | "archived";
  updatedAt: string;
};

export type TechnicianGuideFilters = {
  query?: string;
  category?: TechnicianGuideCategory | "";
  brand?: string;
  model?: string;
};

type GuideInput = Omit<TechnicianLearningGuide, "id" | "updatedAt">;
type ModelInput = Omit<TechnicianDeviceModel, "id" | "updatedAt">;

async function request<T>(path: string, init: RequestInit = {}, admin = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (admin && typeof localStorage !== "undefined") {
    const token = localStorage.getItem("ochola_superadmin_token") || "";
    if (token) headers.set("x-sa-token", token);
  }
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  const raw = await response.text();
  let body: { ok?: boolean; error?: string } & T;
  try {
    body = JSON.parse(raw) as { ok?: boolean; error?: string } & T;
  } catch {
    throw new Error(`Learning Center API returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || `Learning Center request failed (HTTP ${response.status}).`);
  }
  return body;
}

function filterParams(filters: TechnicianGuideFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.query?.trim()) params.set("q", filters.query.trim());
  if (filters.category) params.set("category", filters.category);
  if (filters.brand) params.set("brand", filters.brand);
  if (filters.model) params.set("model", filters.model);
  return params.toString();
}

export function useTechnicianGuides(filters: TechnicianGuideFilters = {}) {
  const query = filterParams(filters);
  return useQuery({
    queryKey: ["technician-learning", "guides", query],
    queryFn: () => request<{ guides: TechnicianLearningGuide[] }>(
      `/api/employee/learning/guides${query ? `?${query}` : ""}`,
    ),
  });
}

export function useTechnicianGuide(slug: string) {
  return useQuery({
    queryKey: ["technician-learning", "guide", slug],
    enabled: !!slug,
    queryFn: () => request<{ guide: TechnicianLearningGuide }>(
      `/api/employee/learning/guides/${encodeURIComponent(slug)}`,
    ),
  });
}

export function useTechnicianModels(queryText = "") {
  const query = queryText.trim() ? `?q=${encodeURIComponent(queryText.trim())}` : "";
  return useQuery({
    queryKey: ["technician-learning", "models", queryText.trim()],
    queryFn: () => request<{ models: TechnicianDeviceModel[] }>(`/api/employee/learning/models${query}`),
  });
}

export function useAdminTechnicianGuides(status: "draft" | "published" | "archived" | "all" = "all") {
  return useQuery({
    queryKey: ["technician-learning", "admin-guides", status],
    queryFn: () => request<{ guides: TechnicianLearningGuide[] }>(
      `/api/employee/admin/learning/guides?status=${encodeURIComponent(status)}`,
      {}, true,
    ),
  });
}

export function useCreateTechnicianGuide() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (guide: GuideInput) => request<{ guide: TechnicianLearningGuide }>(
      "/api/employee/admin/learning/guides",
      { method: "POST", body: JSON.stringify(guide) },
      true,
    ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["technician-learning"] }),
  });
}

export function useUpdateTechnicianGuide() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; guide: Partial<GuideInput> }) =>
      request<{ guide: TechnicianLearningGuide }>(
        `/api/employee/admin/learning/guides/${encodeURIComponent(input.id)}`,
        { method: "PATCH", body: JSON.stringify(input.guide) },
        true,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["technician-learning"] }),
  });
}

export function useArchiveTechnicianGuide() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<{ guide: TechnicianLearningGuide }>(
      `/api/employee/admin/learning/guides/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ status: "archived" }) },
      true,
    ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["technician-learning"] }),
  });
}

export function useAdminTechnicianModels(status: "draft" | "published" | "archived" | "all" = "all") {
  return useQuery({
    queryKey: ["technician-learning", "admin-models", status],
    queryFn: () => request<{ models: TechnicianDeviceModel[] }>(
      `/api/employee/admin/learning/models?status=${encodeURIComponent(status)}`,
      {}, true,
    ),
  });
}

export function useCreateTechnicianModel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (model: ModelInput) => request<{ model: TechnicianDeviceModel }>(
      "/api/employee/admin/learning/models",
      { method: "POST", body: JSON.stringify(model) },
      true,
    ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["technician-learning"] }),
  });
}

export function useUpdateTechnicianModel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; model: Partial<ModelInput> }) =>
      request<{ model: TechnicianDeviceModel }>(
        `/api/employee/admin/learning/models/${encodeURIComponent(input.id)}`,
        { method: "PATCH", body: JSON.stringify(input.model) },
        true,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["technician-learning"] }),
  });
}

export function useArchiveTechnicianModel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<{ model: TechnicianDeviceModel }>(
      `/api/employee/admin/learning/models/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ status: "archived" }) },
      true,
    ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["technician-learning"] }),
  });
}
