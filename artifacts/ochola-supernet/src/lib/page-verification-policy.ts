export type PageAuthMethod = "none" | "password" | "whatsapp" | "sms" | "email";

const ALLOWED_METHODS = new Set<PageAuthMethod>([
  "none",
  "password",
  "whatsapp",
  "sms",
  "email",
]);

export interface PageVerificationPolicyResponse {
  ok?: boolean;
  error?: string;
  role?: string;
  feature?: string;
  method?: unknown;
  methods?: Record<string, unknown>;
}

export function resolvePageVerificationMethods(
  data: PageVerificationPolicyResponse,
  feature: string,
  role: string,
): Record<string, PageAuthMethod> {
  if (!data.ok || data.role !== role) {
    throw new Error(data.error || "Password security policy could not be checked.");
  }

  const methods: Record<string, PageAuthMethod> = {};
  if (data.methods !== undefined) {
    if (!data.methods || typeof data.methods !== "object" || Array.isArray(data.methods)) {
      throw new Error("Page verification policy response was invalid.");
    }
    for (const [key, method] of Object.entries(data.methods)) {
      if (typeof method !== "string" || !ALLOWED_METHODS.has(method as PageAuthMethod)) {
        throw new Error("Page verification policy response was invalid.");
      }
      methods[key] = method as PageAuthMethod;
    }
  }

  // The server's per-feature decision is authoritative. This keeps the gate
  // compatible when a page is added before every server's catalog is updated.
  if (data.feature === feature) {
    if (typeof data.method !== "string" || !ALLOWED_METHODS.has(data.method as PageAuthMethod)) {
      throw new Error("Page verification policy response was invalid.");
    }
    methods[feature] = data.method as PageAuthMethod;
  }

  if (!Object.prototype.hasOwnProperty.call(methods, feature)) {
    throw new Error("Page verification policy response was incomplete.");
  }
  return methods;
}
