export function normalizeMpesaReceipt(value: unknown): string | null {
  const receipt = String(value ?? "").trim().toUpperCase();
  return /^[A-Z][A-Z0-9]{8,11}$/.test(receipt) ? receipt : null;
}

export function extractMpesaReceipt(message: unknown): string {
  if (typeof message !== "string") return "";
  const text = message.trim();
  const directReceipt = normalizeMpesaReceipt(text);
  if (directReceipt) return directReceipt;
  const match = text.match(/\b([A-Z][A-Z0-9]{8,11})\s+Confirmed\b/i)
    ?? text.match(/\b(?:transaction|receipt|code)\s*(?:number|id|no\.?)?\s*[:#-]?\s*([A-Z][A-Z0-9]{8,11})\b/i);
  return normalizeMpesaReceipt(match?.[1]) ?? "";
}
