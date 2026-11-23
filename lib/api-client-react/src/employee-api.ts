import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type EmployeePortalEmployee = {
  id: string;
  employee_number: string;
  username: string;
  display_name: string;
  account_type: "employee" | "technician";
  email: string | null;
  phone: string | null;
  status: "invited" | "active" | "suspended" | "terminated";
  fixed_monthly_salary: string;
  created_at: string;
};

export type EmployeePortalWithdrawal = {
  id: string;
  employee_id: string;
  destination_id: string;
  amount: string;
  status: "pending" | "approved" | "processing" | "reconciliation_required" | "paid" | "rejected" | "cancelled";
  review_note?: string | null;
  paid_reference?: string | null;
  created_at: string;
  paid_at?: string | null;
  destination?: { destination_type: "bank" | "mpesa_b2c" | "pochi" | "paybill" | "till"; masked_label: string } | null;
  payout_transaction?: {
    provider: "manual_bank" | "daraja_b2c" | "daraja_b2b" | "b2pochi";
    status: "created" | "submitted" | "succeeded" | "failed" | "uncertain" | "reconciled";
    provider_receipt?: string | null;
    provider_conversation_id?: string | null;
    updated_at?: string;
  } | null;
};

export type EmployeePortalDashboard = {
  available_balance: string;
  salary_earned: string;
  commissions_earned: string;
  bonuses_earned: string;
  allowances_earned: string;
  deductions: string;
  total_withdrawn: string;
  withdrawn_today: string;
  pending_withdrawals: string;
  recent_withdrawals: EmployeePortalWithdrawal[];
  recent_ledger: Array<{ id: number; entry_type: string; amount: string; currency: "KES"; reference: string; description?: string | null; created_at: string }>;
  payroll_history: Array<{ id: string; payroll_period_id: string; salary: string; commissions: string; bonuses: string; allowances: string; deductions: string; net_amount: string; created_at: string }>;
};

export type EmployeeAdminCredit = {
  id: string; employee_id: string; amount: string; reason: string;
  ledger_entry_id: string | number; created_by: string; created_at: string;
};

export type EmployeeAwardCodeRecord = {
  id: string; employee_id: string; amount: string; reason: string; expires_at: string;
  redeemed_at: string | null; revoked_at: string | null; created_by: string; created_at: string;
};

export type EmployeeCompensationItem = {
  id: string; employee_id: string; component_type: "commission" | "bonus" | "allowance" | "deduction";
  amount: string; period_start: string; period_end: string; description: string; status: string; created_at: string;
};

export type StaffSignupRequest = {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  account_type: "employee" | "technician";
  email_verified_at: string;
  created_at: string;
};

type ApiResult<T> = { ok: true } & T;

async function request<T>(path: string, init: RequestInit = {}, admin = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (admin && typeof localStorage !== "undefined") {
    const token = localStorage.getItem("ochola_superadmin_token") || "";
    if (token) headers.set("x-sa-token", token);
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
  const raw = await response.text();
  let body: { ok?: boolean; error?: string } & T;
  try {
    body = JSON.parse(raw) as { ok?: boolean; error?: string } & T;
  } catch {
    throw new Error(`Staff API returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || `Staff API request failed (HTTP ${response.status}).`);
  }
  return body;
}

export function useEmployeePortalStatus() {
  return useQuery({
    queryKey: ["employee-portal", "status"],
    queryFn: () => request<ApiResult<{ enabled: boolean; portal: "admin" | "staff" | "unmatched" }>>("/api/employee/status"),
  });
}

export function useEmployeeLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { username: string; password: string; turnstileToken: string }) =>
      request<ApiResult<{ step: "email_otp"; challengeId: string; email: string }>>(
        "/api/employee/login", { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-portal"] }),
  });
}

export function useEmployeeLoginVerifyOtp() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { challengeId: string; email: string; code: string; turnstileToken: string }) =>
      request<ApiResult<{ employee: { id: string; username: string; displayName: string; accountType: "employee" | "technician" } }>>(
        "/api/employee/login/verify-otp", { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-portal"] }),
  });
}

export function useRequestStaffSignupOtp() {
  return useMutation({
    mutationFn: (input: { email: string; turnstileToken: string }) =>
      request<ApiResult<{ challengeId: string; expiresInSeconds: number }>>(
        "/api/employee/signup/request-otp", { method: "POST", body: JSON.stringify(input) },
      ),
  });
}

export function useVerifyStaffSignupOtp() {
  return useMutation({
    mutationFn: (input: { email: string; challengeId: string; code: string; turnstileToken: string }) =>
      request<ApiResult<{ emailVerificationToken: string; expiresInSeconds: number }>>(
        "/api/employee/signup/verify-otp", { method: "POST", body: JSON.stringify(input) },
      ),
  });
}

export function useSubmitStaffSignup() {
  return useMutation({
    mutationFn: (input: {
      fullName: string; phone: string; email: string; password: string; confirmPassword: string;
      emailVerificationToken: string; turnstileToken: string; accountType: "employee" | "technician";
    }) => request<ApiResult<{ status: "pending_approval"; message: string }>>(
      "/api/employee/signup", { method: "POST", body: JSON.stringify(input) },
    ),
  });
}

export function useEmployeeActivate() {
  return useMutation({
    mutationFn: (input: { token: string; password: string; turnstileToken: string }) =>
      request<ApiResult<Record<string, never>>>("/api/employee/activate", {
        method: "POST", body: JSON.stringify(input),
      }),
  });
}

export function useEmployeeLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => request<ApiResult<Record<string, never>>>("/api/employee/logout", { method: "POST" }),
    onSuccess: () => client.clear(),
  });
}

export function useEmployeeMe() {
  return useQuery({
    queryKey: ["employee-portal", "me"],
    retry: false,
    queryFn: () => request<ApiResult<{ employee: { id: string; username: string; displayName: string; accountType: "employee" | "technician" } }>>("/api/employee/me"),
  });
}

export function useEmployeeDashboard() {
  return useQuery({
    queryKey: ["employee-portal", "dashboard"],
    queryFn: async () => (await request<ApiResult<{ dashboard: EmployeePortalDashboard }>>("/api/employee/dashboard")).dashboard,
  });
}

export function useAdminEmployeeCredits() {
  return useQuery({
    queryKey: ["employee-portal", "admin", "credits"],
    queryFn: () => request<ApiResult<{
      credits: EmployeeAdminCredit[];
      awardCodes: EmployeeAwardCodeRecord[];
    }>>("/api/employee/admin/credits", {}, true),
  });
}

export function usePostEmployeeAdminCredit() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { employeeId: string; amount: string; reason: string; idempotencyKey: string }) =>
      request<ApiResult<{ credit: { status: string; credit_id: string; ledger_entry_id: number; amount: string } }>>(
        "/api/employee/admin/credits", { method: "POST", body: JSON.stringify(input) }, true,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-portal"] }),
  });
}

export function useIssueEmployeeAwardCode() {
  const client = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (input: {
      employeeId: string; amount: string; reason: string; expiresAt: string; idempotencyKey: string;
    }) => request<ApiResult<{
      awardCode: { id: string; amount: string; expiresAt: string; code: string };
    }>>(
      "/api/employee/admin/award-codes", { method: "POST", body: JSON.stringify(input) }, true,
    ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-portal", "admin", "credits"] }),
  });
}

export function useRedeemEmployeeAwardCode() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { code: string }) =>
      request<ApiResult<{ redemption: { status: string; amount: string; ledger_entry_id: number } }>>(
        "/api/employee/award-codes/redeem", { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-portal"] }),
  });
}

export function useEmployeeDestinations() {
  return useQuery({
    queryKey: ["employee-portal", "destinations"],
    queryFn: async () => (await request<ApiResult<{ destinations: Array<{
      id: string; destination_type: string; masked_label: string; status: string; created_at: string;
    }> }>>("/api/employee/destinations")).destinations,
  });
}

export function useRequestEmployeeWithdrawal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { amount: string; destinationId: string; idempotencyKey: string }) =>
      request<ApiResult<{ withdrawal: EmployeePortalWithdrawal }>>("/api/employee/withdrawals", {
        method: "POST",
        headers: { "Idempotency-Key": input.idempotencyKey },
        body: JSON.stringify(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-portal"] }),
  });
}

export function useCancelEmployeeWithdrawal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<ApiResult<{ withdrawal: { id: string; status: string } }>>(
      `/api/employee/withdrawals/${encodeURIComponent(id)}/cancel`, { method: "POST" },
    ),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["employee-portal", "dashboard"] });
      client.invalidateQueries({ queryKey: ["employee-portal", "withdrawals"] });
    },
  });
}

export function useAdminEmployees() {
  return useQuery({
    queryKey: ["employee-portal", "admin", "employees"],
    queryFn: async () => (await request<ApiResult<{ employees: EmployeePortalEmployee[] }>>(
      "/api/employee/admin/employees", {}, true,
    )).employees,
  });
}

export function useCreateEmployee() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      employeeNumber: string; username: string; displayName: string; email?: string; phone?: string;
      monthlySalary: string; destinationType: string; destinationDetails: Record<string, string>;
    }) => request<ApiResult<{ employee: EmployeePortalEmployee; invitationUrl: string; invitationExpiresAt: string }>>(
      "/api/employee/admin/employees", { method: "POST", body: JSON.stringify(input) }, true,
    ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-portal", "admin"] }),
  });
}

export function useUpdateStaffContact() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; email: string; phone?: string }) =>
      request<ApiResult<{
        staff: { id: string; email: string | null; phone: string | null };
        message: string;
      }>>(
        `/api/employee/admin/employees/${encodeURIComponent(input.id)}/contact`,
        { method: "PATCH", body: JSON.stringify({ email: input.email, phone: input.phone ?? "" }) },
        true,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-portal", "admin"] }),
  });
}

export function usePendingStaffSignups() {
  return useQuery({
    queryKey: ["employee-portal", "admin", "signups"],
    queryFn: async () => (await request<ApiResult<{ signups: StaffSignupRequest[] }>>(
      "/api/employee/admin/signups", {}, true,
    )).signups,
  });
}

export function useReviewStaffSignup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; decision: "approve" | "reject"; note?: string }) =>
      request<ApiResult<{ request: { id: string; status: string; employeeId: string | null }; notificationSent: boolean }>>(
        `/api/employee/admin/signups/${encodeURIComponent(input.id)}/review`,
        { method: "POST", body: JSON.stringify({ decision: input.decision, note: input.note }) },
        true,
      ),
    onSettled: () => client.invalidateQueries({ queryKey: ["employee-portal", "admin"] }),
  });
}

export function useAdminWithdrawals() {
  return useQuery({
    queryKey: ["employee-portal", "admin", "withdrawals"],
    queryFn: async () => (await request<ApiResult<{ withdrawals: EmployeePortalWithdrawal[] }>>(
      "/api/employee/admin/withdrawals", {}, true,
    )).withdrawals,
  });
}

export function usePendingEmployeeDestinations() {
  return useQuery({
    queryKey: ["employee-portal", "admin", "destinations"],
    queryFn: async () => (await request<ApiResult<{ destinations: Array<{
      id: string; employee_id: string; destination_type: string; masked_label: string; status: string; created_at: string;
    }> }>>("/api/employee/admin/destinations/pending", {}, true)).destinations,
  });
}

export function useRequestEmployeeDestinationChange() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { destinationType: string; destinationDetails: Record<string, string> }) =>
      request<ApiResult<{ destination: { id: string; status: string; masked_label: string } }>>(
        "/api/employee/destinations/change-request", { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-portal", "destinations"] }),
  });
}

export function useReviewEmployeeDestination() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; decision: "approve" | "reject" }) =>
      request<ApiResult<{ destination: { id: string; status: string } }>>(
        `/api/employee/admin/destinations/${encodeURIComponent(input.id)}/review`,
        { method: "POST", body: JSON.stringify({ decision: input.decision }) },
        true,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-portal", "admin"] }),
  });
}

export function useEmployeeAdminSummary() {
  return useQuery({
    queryKey: ["employee-portal", "admin", "summary"],
    queryFn: () => request<ApiResult<{ summary: {
      employee_count: number; active_employee_count: number; pending_withdrawal_count: number;
      total_withdrawn: string; withdrawn_today: string;
    }; payoutControls: {
      enabled: boolean; enabled_destination_types: string[]; max_withdrawal: string; daily_limit: string;
    } | null }>>("/api/employee/admin/summary", {}, true),
  });
}

export function useEmployeeCompensation() {
  return useQuery({
    queryKey: ["employee-portal", "admin", "compensation"],
    queryFn: async () => (await request<ApiResult<{ items: EmployeeCompensationItem[] }>>(
      "/api/employee/admin/compensation", {}, true,
    )).items,
  });
}

export function useEmployeeCommissionRules() {
  return useQuery({
    queryKey: ["employee-portal", "admin", "commission-rules"],
    queryFn: async () => (await request<ApiResult<{ rules: Array<{
      id: string; employee_id: string | null; rule_name: string; rate: string;
      amount_per_unit: string | null; active: boolean; created_at: string;
    }> }>>("/api/employee/admin/commission-rules", {}, true)).rules,
  });
}

export function useCreateEmployeeCommissionRule() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { employeeId?: string | null; ruleName: string; rate: string; amountPerUnit?: string | null }) =>
      request<ApiResult<{ rule: { id: string; active: boolean } }>>(
        "/api/employee/admin/commission-rules", { method: "POST", body: JSON.stringify(input) }, true,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-portal", "admin", "commission-rules"] }),
  });
}

export function useCreateEmployeeCompensation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      employeeId: string; componentType: "commission" | "bonus" | "allowance" | "deduction";
      amount: string; periodStart: string; periodEnd: string; description: string; idempotencyKey: string;
    }) => request<ApiResult<{ item: { id: string; status: string } }>>(
      "/api/employee/admin/compensation", { method: "POST", body: JSON.stringify(input) }, true,
    ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-portal", "admin", "compensation"] }),
  });
}

export function useReviewEmployeeCompensation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; decision: "approve" | "reject" }) =>
      request<ApiResult<{ item: { id: string; status: string } }>>(
        `/api/employee/admin/compensation/${encodeURIComponent(input.id)}/review`,
        { method: "POST", body: JSON.stringify({ decision: input.decision }) }, true,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-portal", "admin", "compensation"] }),
  });
}

export function useUpdateEmployeeSalary() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { employeeId: string; monthlySalary: string; effectiveFrom: string }) =>
      request<ApiResult<{ salary: Record<string, unknown> }>>(
        "/api/employee/admin/salary", { method: "POST", body: JSON.stringify(input) }, true,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-portal", "admin"] }),
  });
}

export function useEmployeeSalaryHistory(employeeId: string) {
  return useQuery({
    queryKey: ["employee-portal", "admin", "salary-history", employeeId],
    enabled: !!employeeId,
    queryFn: async () => (await request<ApiResult<{ history: Array<{
      id: string; monthly_salary: string; effective_from: string; effective_to: string | null; changed_by: string;
    }> }>>(`/api/employee/admin/salary-history?employeeId=${encodeURIComponent(employeeId)}`, {}, true)).history,
  });
}

export function usePostEmployeePayroll() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { periodStart: string; periodEnd: string; confirmation: string }) =>
      request<ApiResult<{ payroll: { id: string; status: string; record_count: number } }>>(
        "/api/employee/admin/payroll/post", { method: "POST", body: JSON.stringify(input) }, true,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-portal"] }),
  });
}

export function usePreviewEmployeePayroll() {
  return useMutation({
    mutationFn: (input: { periodStart: string; periodEnd: string }) =>
      request<ApiResult<{ preview: {
        period_start: string; period_end: string; employee_count: number;
        totals: Record<string, string>; employees: Array<Record<string, string>>;
      } }>>(
        "/api/employee/admin/payroll/preview", { method: "POST", body: JSON.stringify(input) }, true,
      ),
  });
}

export function useEmployeePayoutSettings() {
  return useQuery({
    queryKey: ["employee-portal", "admin", "payout-settings"],
    queryFn: () => request<ApiResult<{
      controls: { enabled: boolean; enabled_destination_types: string[]; max_withdrawal: string; daily_limit: string } | null;
      automationSchemaReady: boolean;
      automaticB2cEnabled: boolean;
      b2cEnvironment: "sandbox" | "production";
      runtimeAutomationEnabled: boolean;
      b2cCredentialsReady: boolean;
      callbackOriginReady: boolean;
      liveDisbursementsEnabled: boolean;
      credentials: {
        hasB2cConsumerKey: boolean; hasB2cConsumerSecret: boolean;
        hasB2cInitiator: boolean; hasB2cShortcode: boolean;
        hasB2cSecurityCredential: boolean; hasB2pochiConfiguration: boolean;
        hasB2bShortcode: boolean; hasB2bInitiator: boolean; hasB2bSecurityCredential: boolean;
      };
    }>>("/api/employee/admin/payout-settings", {}, true),
  });
}

export function useSaveEmployeePayoutSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      enabled: boolean; enabledDestinationTypes: string[]; maxWithdrawal: string; dailyLimit: string;
      automaticB2cEnabled: boolean; b2cEnvironment: "sandbox" | "production";
      replacePassword: string; credentials: Record<string, string>;
    }) => request<ApiResult<{
      enabled: boolean; enabledDestinationTypes: string[]; automaticB2cEnabled: boolean;
      b2cEnvironment: "sandbox" | "production"; runtimeAutomationEnabled: boolean;
      liveDisbursementsEnabled: boolean;
    }>>(
      "/api/employee/admin/payout-settings",
      { method: "PUT", body: JSON.stringify(input) },
      true,
    ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-portal", "admin"] }),
  });
}

export function useReviewEmployeeWithdrawal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; decision: "approve" | "reject"; note?: string }) =>
      request<ApiResult<{
        withdrawal: EmployeePortalWithdrawal;
        payout?: { status: string; message: string };
      }>>(
        `/api/employee/admin/withdrawals/${encodeURIComponent(input.id)}/review`,
        { method: "POST", body: JSON.stringify({ decision: input.decision, note: input.note }) },
        true,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-portal", "admin"] }),
  });
}

export function useRecordEmployeePayment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; reference: string }) =>
      request<ApiResult<{ withdrawal: EmployeePortalWithdrawal }>>(
        `/api/employee/admin/withdrawals/${encodeURIComponent(input.id)}/record-payment`,
        { method: "POST", body: JSON.stringify({ reference: input.reference }) },
        true,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["employee-portal", "admin"] }),
  });
}
