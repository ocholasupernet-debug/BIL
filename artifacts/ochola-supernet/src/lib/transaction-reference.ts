export interface TransactionReferenceSource {
  id: number;
  reference?: string | null;
  mpesa_receipt?: string | null;
  status?: string | null;
}

export function normalizeMpesaReceipt(value: unknown): string | null {
  const receipt = String(value ?? "").trim().toUpperCase();
  return /^[A-Z][A-Z0-9]{8,11}$/.test(receipt) ? receipt : null;
}

export function transactionDisplayId(transaction: TransactionReferenceSource): string {
  const receipt = normalizeMpesaReceipt(transaction.mpesa_receipt);
  if (receipt) return receipt;

  const reference = transaction.reference?.trim() ?? "";
  if (/^ws_CO_/i.test(reference)) {
    return transaction.status === "pending"
      ? "Awaiting M-Pesa receipt"
      : "M-Pesa receipt unavailable";
  }
  return reference || `#${transaction.id}`;
}

export function webhookEventDisplayId(event: {
  id?: number;
  reference?: string | null;
  status?: string | null;
  payload?: unknown;
}): string {
  const payload = event.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const body = (payload as Record<string, unknown>).Body;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const callback = (body as Record<string, unknown>).stkCallback;
      if (callback && typeof callback === "object" && !Array.isArray(callback)) {
        const metadata = (callback as Record<string, unknown>).CallbackMetadata;
        if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
          const items = (metadata as Record<string, unknown>).Item;
          if (Array.isArray(items)) {
            const receiptItem = items.find(item =>
              item && typeof item === "object" && (item as Record<string, unknown>).Name === "MpesaReceiptNumber",
            );
            const receipt = normalizeMpesaReceipt(
              receiptItem && typeof receiptItem === "object"
                ? (receiptItem as Record<string, unknown>).Value
                : null,
            );
            if (receipt) return receipt;
          }
        }
      }
    }
  }

  return transactionDisplayId({
    id: event.id ?? 0,
    reference: event.reference,
    status: event.status,
  });
}
