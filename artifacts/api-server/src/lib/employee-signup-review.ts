export interface EmployeeSignupReviewRow {
  outcome: string;
  email: string | null;
  employee_id: string | null;
}

export type EmployeeSignupReviewResult =
  | { kind: "approved" | "rejected"; email: string | null; employeeId: string | null }
  | { kind: "duplicate" }
  | { kind: "stale" }
  | { kind: "unexpected" };

export function interpretEmployeeSignupReview(
  row: EmployeeSignupReviewRow | undefined,
): EmployeeSignupReviewResult {
  if (!row || typeof row.outcome !== "string") return { kind: "unexpected" };
  if (row.outcome === "approved" || row.outcome === "rejected") {
    return {
      kind: row.outcome,
      email: typeof row.email === "string" ? row.email : null,
      employeeId: typeof row.employee_id === "string" ? row.employee_id : null,
    };
  }
  if (row.outcome === "duplicate") return { kind: "duplicate" };
  if (row.outcome === "invalid") return { kind: "stale" };
  return { kind: "unexpected" };
}

export type EmployeeSignupReviewFailureCategory =
  | "configuration"
  | "permissions"
  | "schema"
  | "conflict"
  | "uncertain"
  | "database";

export interface EmployeeSignupReviewFailure {
  category: EmployeeSignupReviewFailureCategory;
  status: 409 | 503;
  message: string;
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isInteger(status) ? status : null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

export function classifyEmployeeSignupReviewFailure(
  error: unknown,
): EmployeeSignupReviewFailure {
  const status = errorStatus(error);
  const detail = errorText(error);

  if (/service-role access is required|supabase is not configured/i.test(detail)) {
    return {
      category: "configuration",
      status: 503,
      message: "Staff approval is not available because server-side database access is not configured. Contact the system administrator.",
    };
  }

  if (status === 401 || status === 403 || /\b42501\b|permission denied/i.test(detail)) {
    return {
      category: "permissions",
      status: 503,
      message: "The Staff approval service cannot access the required database permissions. Contact the system administrator.",
    };
  }

  if (
    status === 404
    || /\bPGRST202\b|\b42883\b|\b42P01\b|function .* does not exist|relation .* does not exist|schema cache/i.test(detail)
  ) {
    return {
      category: "schema",
      status: 503,
      message: "The Staff approval database setup is incomplete. Contact the system administrator.",
    };
  }

  if (status === 409 || /\b23505\b|duplicate key/i.test(detail)) {
    return {
      category: "conflict",
      status: 409,
      message: "This Staff request may already have been processed. Refresh the request list before trying again.",
    };
  }

  if (
    status === 408
    || status === 504
    || /timeout|timed out|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed/i.test(detail)
  ) {
    return {
      category: "uncertain",
      status: 503,
      message: "We couldn't confirm whether the review completed. Refresh the request list before trying again.",
    };
  }

  return {
    category: "database",
    status: 503,
    message: "The Staff request could not be reviewed. Refresh the request list and try again. If it continues, contact the system administrator.",
  };
}
