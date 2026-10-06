import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck, Wifi } from "lucide-react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { ADMIN_ID, getAdminApiToken } from "@/lib/supabase";
import { fmtMoney } from "@/lib/utils";

const RECOVERY_CONFIRMATION = "RECOVER_PAID_HOTSPOT_ACCESS";
const RECOVERY_CONFIRMATION_TEXT = "RECOVER PAID HOTSPOT ACCESS";
const EMPTY_RECOVERY_ROWS: PaidHotspotRecoveryRow[] = [];

type PaidHotspotRecoveryRow = {
  transactionId: number;
  amount: number;
  paidAt: string;
  plan: { id: number; name: string };
  scope: { routerId: number | null; portId: number | null; resellerId: number | null };
  recoveryReady: boolean;
  issue?: string;
};

type PaidHotspotRecoveryResult = {
  transactionId: number;
  status: "provisioned" | "retry_needed";
  message: string;
};

type RecoveryReportResponse = { ok: boolean; transactions: PaidHotspotRecoveryRow[]; error?: string };
type RecoveryMutationResponse = { ok: boolean; results: PaidHotspotRecoveryResult[]; error?: string };

function authorizationHeaders(json = false): HeadersInit {
  const token = getAdminApiToken();
  if (!token) throw new Error("Your administrator session is missing. Sign in again, then reload this page.");
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function fetchPaidHotspotRecoveryReport(): Promise<RecoveryReportResponse> {
  const response = await fetch("/api/admin/mpesa/hotspot-recovery", {
    headers: authorizationHeaders(),
    cache: "no-store",
  });
  const body = await response.json().catch(() => null) as RecoveryReportResponse | null;
  if (!response.ok || !body?.ok || !Array.isArray(body.transactions)) {
    throw new Error(body?.error ?? "The paid Hotspot recovery report could not be loaded.");
  }
  return body;
}

async function recoverPaidHotspotTransactions(transactionIds: number[]): Promise<RecoveryMutationResponse> {
  const response = await fetch("/api/admin/mpesa/hotspot-recovery", {
    method: "POST",
    headers: authorizationHeaders(true),
    cache: "no-store",
    body: JSON.stringify({
      confirmation: RECOVERY_CONFIRMATION,
      transactionIds,
    }),
  });
  const body = await response.json().catch(() => null) as RecoveryMutationResponse | null;
  if (!response.ok || !body || !Array.isArray(body.results)) {
    throw new Error(body?.error ?? "Paid Hotspot recovery could not be completed.");
  }
  return body;
}

function issueDescription(issue?: string): string {
  switch (issue) {
    case "missing_router_or_service_assignment":
      return "The package has no usable Hotspot router or service assignment.";
    case "saved_checkout_or_device_details_unavailable":
      return "The original checkout reference or device details are missing.";
    case "saved_purchase_contact_unavailable":
      return "The saved purchase contact cannot be verified.";
    case "service_scope_unavailable":
      return "The assigned Hotspot service or reseller port is not currently available.";
    default:
      return "This transaction needs review before it can be recovered.";
  }
}

function formatPaidAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleString("en-KE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export default function PaidHotspotRecovery() {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [confirmationText, setConfirmationText] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [recoveryResults, setRecoveryResults] = useState<PaidHotspotRecoveryResult[] | null>(null);

  const report = useQuery({
    queryKey: ["paid-hotspot-recovery", ADMIN_ID],
    queryFn: fetchPaidHotspotRecoveryReport,
    refetchInterval: 60_000,
    staleTime: 10_000,
  });
  const rows = report.data?.transactions ?? EMPTY_RECOVERY_ROWS;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedRows = rows.filter(row => selectedSet.has(row.transactionId) && row.recoveryReady);
  const readyCount = rows.filter(row => row.recoveryReady).length;

  const recovery = useMutation({
    mutationFn: recoverPaidHotspotTransactions,
    onSuccess: async result => {
      setRecoveryResults(result.results);
      setSelectedIds([]);
      setConfirmationText("");
      setConfirmOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["paid-hotspot-recovery", ADMIN_ID] }),
        queryClient.invalidateQueries({ queryKey: ["isp_transactions", ADMIN_ID] }),
        queryClient.invalidateQueries({ queryKey: ["prepaid_customers", ADMIN_ID] }),
      ]);
    },
  });

  function toggleSelected(transactionId: number) {
    setSelectedIds(current => {
      if (current.includes(transactionId)) return current.filter(id => id !== transactionId);
      if (current.length >= 20) return current;
      return [...current, transactionId];
    });
    setRecoveryResults(null);
  }

  function selectAllReady() {
    setSelectedIds(rows.filter(row => row.recoveryReady).slice(0, 20).map(row => row.transactionId));
    setRecoveryResults(null);
  }

  function closeConfirmation() {
    if (recovery.isPending) return;
    setConfirmOpen(false);
    setConfirmationText("");
  }

  const succeededCount = recoveryResults?.filter(result => result.status === "provisioned").length ?? 0;
  const retryCount = recoveryResults?.filter(result => result.status === "retry_needed").length ?? 0;
  const canConfirm = confirmationText.trim() === RECOVERY_CONFIRMATION_TEXT && selectedRows.length > 0 && !recovery.isPending;

  return (
    <AdminLayout>
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Transactions</p>
            <h1 className="mt-1 text-2xl font-bold text-foreground">Paid Hotspot Recovery</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Review the 20 newest confirmed M-Pesa Hotspot payments that do not have a linked prepaid account.
              Only transactions in your signed-in ISP or reseller scope are shown.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedIds([]);
              setRecoveryResults(null);
              void report.refetch();
            }}
            disabled={report.isFetching || recovery.isPending}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {report.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh report
          </button>
        </header>

        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5">
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div className="space-y-1">
              <h2 className="text-sm font-bold text-foreground">Recovery is a separate, confirmed action</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                The report is read-only. Recovering selected payments links the existing payment to one prepaid account
                and retries RouterOS access; it does not charge the customer again. A router or service problem may
                still leave access pending. Recovery requires both View Transactions and Edit Customers permissions.
              </p>
            </div>
          </div>
        </section>

        {report.isError && (
          <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {report.error instanceof Error ? report.error.message : "The report could not be loaded."}
          </div>
        )}

        {recovery.isError && (
          <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {recovery.error instanceof Error ? recovery.error.message : "Recovery could not be completed."}
          </div>
        )}

        {recoveryResults && (
          <section aria-live="polite" className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
            <div className="flex items-center gap-2">
              {retryCount === 0
                ? <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                : <AlertTriangle className="h-5 w-5 text-amber-400" />}
              <h2 className="font-bold text-foreground">Recovery result</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              {succeededCount} connected; {retryCount} need another review or retry.
            </p>
            <div className="space-y-2">
              {recoveryResults.map(result => (
                <div key={result.transactionId} className="flex flex-col gap-1 rounded-xl bg-background/60 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-mono text-xs text-muted-foreground">Transaction #{result.transactionId}</span>
                  <span className={result.status === "provisioned" ? "text-emerald-400" : "text-amber-400"}>
                    {result.message}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <h2 className="font-bold text-foreground">Unlinked paid transactions</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {report.isLoading ? "Loading…" : `${rows.length} found · ${readyCount} ready for review`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={selectAllReady}
                disabled={readyCount === 0 || recovery.isPending}
                className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Select ready (up to 20)
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                disabled={selectedIds.length === 0 || recovery.isPending}
                className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear selection
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmationText("");
                  setConfirmOpen(true);
                }}
                disabled={selectedRows.length === 0 || recovery.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Wifi className="h-4 w-4" />
                Review {selectedRows.length} selected
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-background/70 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-12 px-4 py-3"><span className="sr-only">Select</span></th>
                  <th className="px-4 py-3">Transaction</th>
                  <th className="px-4 py-3">Paid</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Service scope</th>
                  <th className="px-4 py-3">Review status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                      <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading paid transactions…</span>
                    </td>
                  </tr>
                ) : report.isError ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">Refresh the report after resolving the error above.</td></tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                      No unlinked confirmed M-Pesa Hotspot transactions were found in this scope.
                    </td>
                  </tr>
                ) : rows.map(row => {
                  const checked = selectedSet.has(row.transactionId);
                  const selectionFull = selectedIds.length >= 20 && !checked;
                  return (
                    <tr key={row.transactionId} className="align-top hover:bg-white/[0.025]">
                      <td className="px-4 py-4">
                        <input
                          type="checkbox"
                          aria-label={`Select transaction ${row.transactionId}`}
                          checked={checked}
                          disabled={!row.recoveryReady || selectionFull || recovery.isPending}
                          onChange={() => toggleSelected(row.transactionId)}
                          className="h-4 w-4 accent-primary disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-mono text-xs font-semibold text-foreground">#{row.transactionId}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{formatPaidAt(row.paidAt)}</div>
                      </td>
                      <td className="px-4 py-4 font-semibold text-emerald-400">{fmtMoney(row.amount)}</td>
                      <td className="px-4 py-4 text-foreground">{row.plan.name}</td>
                      <td className="px-4 py-4 text-xs text-muted-foreground">
                        Router {row.scope.routerId ?? "—"}
                        {row.scope.portId !== null ? ` · Port ${row.scope.portId}` : ""}
                        {row.scope.resellerId !== null ? ` · Reseller ${row.scope.resellerId}` : ""}
                      </td>
                      <td className="px-4 py-4">
                        {row.recoveryReady ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5" /> Needs review
                          </span>
                        )}
                        {!row.recoveryReady && (
                          <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">{issueDescription(row.issue)}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
            Purchase phone numbers and device MAC addresses are not shown here. The report is read-only until an administrator explicitly confirms a recovery.
          </div>
        </section>
      </div>

      {confirmOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
          onMouseDown={event => {
            if (event.target === event.currentTarget) closeConfirmation();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="paid-recovery-dialog-title"
            aria-describedby="paid-recovery-dialog-description"
            className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="paid-recovery-dialog-title" className="text-lg font-bold text-foreground">
                  Confirm paid account recovery
                </h2>
                <p id="paid-recovery-dialog-description" className="mt-2 text-sm leading-6 text-muted-foreground">
                  This will link the selected existing payments to prepaid accounts and attempt RouterOS access for each one.
                  It will not charge the customer again.
                </p>
              </div>
              <button
                type="button"
                onClick={closeConfirmation}
                disabled={recovery.isPending}
                aria-label="Close confirmation"
                className="rounded-lg p-1 text-muted-foreground hover:bg-white/5 hover:text-foreground disabled:opacity-50"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <ul className="mt-4 max-h-36 space-y-1 overflow-y-auto rounded-xl bg-background/60 p-3 text-xs text-muted-foreground">
              {selectedRows.map(row => (
                <li key={row.transactionId} className="flex justify-between gap-3">
                  <span>Transaction #{row.transactionId} · {row.plan.name}</span>
                  <span className="shrink-0">{fmtMoney(row.amount)}</span>
                </li>
              ))}
            </ul>

            <label htmlFor="recovery-confirmation" className="mt-4 block text-sm font-semibold text-foreground">
              Type <span className="font-mono text-primary">{RECOVERY_CONFIRMATION_TEXT}</span> to proceed
            </label>
            <input
              id="recovery-confirmation"
              value={confirmationText}
              onChange={event => setConfirmationText(event.target.value)}
              disabled={recovery.isPending}
              autoComplete="off"
              className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 font-mono text-sm text-foreground outline-none focus:border-primary disabled:opacity-50"
            />

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeConfirmation}
                disabled={recovery.isPending}
                className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => recovery.mutate(selectedRows.map(row => row.transactionId))}
                disabled={!canConfirm}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {recovery.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirm recovery
              </button>
            </div>
          </section>
        </div>
      )}
    </AdminLayout>
  );
}
