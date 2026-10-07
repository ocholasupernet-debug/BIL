import { createHash } from "node:crypto";

export interface DarajaOAuthCredentials {
  consumerKey: string;
  consumerSecret: string;
}

interface CachedToken {
  token?: string;
  expiresAt: number;
  pending?: Promise<string>;
}

interface DarajaTokenProviderOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  maxEntries?: number;
  safetyWindowMs?: number;
}

/**
 * Keeps Daraja OAuth tokens in process memory and coalesces simultaneous
 * refreshes. The cache key is a digest, so credential values are not retained
 * as map keys.
 */
export function createDarajaTokenProvider(
  options: DarajaTokenProviderOptions = {},
): (credentials: DarajaOAuthCredentials, baseUrl: string) => Promise<string> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 128));
  const safetyWindowMs = Math.max(0, options.safetyWindowMs ?? 60_000);
  const cache = new Map<string, CachedToken>();

  const remember = (key: string, entry: CachedToken): void => {
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  return async (credentials, baseUrl): Promise<string> => {
    if (!credentials.consumerKey || !credentials.consumerSecret) {
      throw new Error("Daraja consumer credentials are missing.");
    }

    const cacheKey = createHash("sha256")
      .update(`${baseUrl}\u0000${credentials.consumerKey}\u0000${credentials.consumerSecret}`)
      .digest("hex");
    const currentTime = now();
    const existing = cache.get(cacheKey);
    if (existing?.token && existing.expiresAt > currentTime) {
      remember(cacheKey, existing);
      return existing.token;
    }
    if (existing?.pending) {
      remember(cacheKey, existing);
      return existing.pending;
    }

    let pending!: Promise<string>;
    pending = (async () => {
      const authorization = Buffer
        .from(`${credentials.consumerKey}:${credentials.consumerSecret}`)
        .toString("base64");
      const response = await fetchImpl(
        `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
        { headers: { Authorization: `Basic ${authorization}` } },
      );
      if (!response.ok) throw new Error(`Daraja OAuth failed: ${response.status}`);

      const data = await response.json() as { access_token?: unknown; expires_in?: unknown };
      if (typeof data.access_token !== "string" || !data.access_token) {
        throw new Error("Daraja OAuth response did not include an access token.");
      }

      const expiresInSeconds = Number(data.expires_in);
      const expiresAt = Number.isFinite(expiresInSeconds)
        ? now() + expiresInSeconds * 1000 - safetyWindowMs
        : 0;
      if (expiresAt > now() && cache.get(cacheKey)?.pending === pending) {
        remember(cacheKey, { token: data.access_token, expiresAt });
      } else if (cache.get(cacheKey)?.pending === pending) {
        cache.delete(cacheKey);
      }
      return data.access_token;
    })();

    remember(cacheKey, { expiresAt: 0, pending });
    try {
      return await pending;
    } catch (error) {
      if (cache.get(cacheKey)?.pending === pending) cache.delete(cacheKey);
      throw error;
    }
  };
}
