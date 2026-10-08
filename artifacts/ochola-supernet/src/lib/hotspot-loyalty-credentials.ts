export interface HotspotAccountCredentials {
  username: string;
  password: string;
}

export interface CredentialStorage {
  getItem(key: string): string | null;
}

/** Reads credentials the portal itself saved after a successful sign-in. Never derived from MAC lookups. */
export function readStoredHotspotCredentials(storage: CredentialStorage | null | undefined, key: string): HotspotAccountCredentials | null {
  try {
    const parsed = JSON.parse(storage?.getItem(key) ?? "null") as Record<string, unknown> | null;
    if (!parsed || typeof parsed.username !== "string" || typeof parsed.password !== "string") return null;
    const username = parsed.username.trim();
    if (!username || !parsed.password) return null;
    return { username, password: parsed.password };
  } catch {
    return null;
  }
}

export function normalizeConfirmedCredentials(username: string, password: string): HotspotAccountCredentials | null {
  const name = username.trim();
  return name && password ? { username: name, password } : null;
}

/** Body fragment only; credentials must never go into URLs or logs. */
export function accountCredentialsPayload(credentials: HotspotAccountCredentials | null): { account_credentials?: HotspotAccountCredentials } {
  return credentials ? { account_credentials: { username: credentials.username, password: credentials.password } } : {};
}

export function isVerificationRequired(status: number, body: unknown): boolean {
  return status === 401 && Boolean(body) && typeof body === "object" && (body as { verificationRequired?: unknown }).verificationRequired === true;
}

/** Only a definite server answer proves nothing was debited; anything else must keep points mode. */
export function redeemOutcomeIsUncertain(status: number | null): boolean {
  return status === null || status >= 500 || status === 408 || status === 429;
}
