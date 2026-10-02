import { encryptVpnSecret, decryptVpnSecret, type EncryptedSecret } from "../lib/vpn-crypto.js";
import {
  fetchHotspotUserList,
  fetchHotspotUserProfiles,
  fetchPPPSecrets,
  fetchPPPProfiles,
  type HotspotUser,
  type HotspotUserProfile,
  type PPPSecret,
  type PPPProfile,
  type RouterCredentials,
} from "../lib/mikrotik.js";
import { sbRpc } from "../lib/supabase-client.js";

const MAX_SNAPSHOT_BYTES = 6 * 1024 * 1024;

export interface RouterUserSnapshotPayload {
  version: 1 | 2;
  routerId: number;
  routerName: string;
  capturedAt: string;
  pppSecrets: PPPSecret[];
  hotspotUsers: HotspotUser[];
  pppProfiles?: PPPProfile[];
  hotspotProfiles?: HotspotUserProfile[];
}

export interface ClaimedRouterUserSnapshot {
  admin_id: number;
  router_id: number;
  lease_token: string;
}

export interface ResolvedSnapshotRouter {
  name: string;
  creds: RouterCredentials;
}

export class RouterUserSnapshotTooLargeError extends Error {
  constructor() {
    super("The router user snapshot exceeds the secure storage limit.");
    this.name = "RouterUserSnapshotTooLargeError";
  }
}

/** Encrypt the complete payload before it reaches Supabase or any client. */
export function encodeRouterUserSnapshot(payload: RouterUserSnapshotPayload): EncryptedSecret {
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, "utf8") > MAX_SNAPSHOT_BYTES) {
    throw new RouterUserSnapshotTooLargeError();
  }
  return encryptVpnSecret(serialized);
}

/** Server-side only: used by trusted migration code, never returned to a browser. */
export function decodeRouterUserSnapshot(record: EncryptedSecret): RouterUserSnapshotPayload {
  return JSON.parse(decryptVpnSecret(record)) as RouterUserSnapshotPayload;
}

export async function failRouterUserSnapshot(
  adminId: number,
  routerId: number,
  leaseToken: string,
  errorCode: "router_unavailable" | "sync_failed" | "snapshot_too_large",
): Promise<void> {
  await sbRpc<{ failed: boolean }>("fail_router_user_snapshot", {
    p_admin_id: adminId,
    p_router_id: routerId,
    p_lease_token: leaseToken,
    p_error_code: errorCode,
  });
}

export async function syncClaimedRouterUserSnapshot(
  adminId: number,
  routerId: number,
  leaseToken: string,
  routerName: string,
  creds: RouterCredentials,
): Promise<{
  ok: boolean;
  capturedAt?: string;
  pppCount?: number;
  hotspotCount?: number;
  errorCode?: "sync_failed" | "snapshot_too_large";
}> {
  try {
    // Fetch sequentially to avoid opening concurrent API sessions on smaller routers.
    const pppSecrets = await fetchPPPSecrets(creds);
    const hotspotUsers = await fetchHotspotUserList(creds);
    const pppProfiles = await fetchPPPProfiles(creds);
    const hotspotProfiles = await fetchHotspotUserProfiles(creds);
    const capturedAt = new Date().toISOString();
    const encrypted = encodeRouterUserSnapshot({
      version: 2,
      routerId,
      routerName: routerName.slice(0, 100),
      capturedAt,
      pppSecrets,
      hotspotUsers,
      pppProfiles,
      hotspotProfiles,
    });
    const result = await sbRpc<{ completed: boolean }>("complete_router_user_snapshot", {
      p_admin_id: adminId,
      p_router_id: routerId,
      p_lease_token: leaseToken,
      p_ciphertext: encrypted.ciphertext,
      p_iv: encrypted.iv,
      p_auth_tag: encrypted.auth_tag,
      p_ppp_count: pppSecrets.length,
      p_hotspot_count: hotspotUsers.length,
      p_synced_at: capturedAt,
    });
    if (result[0]?.completed !== true) {
      throw new Error("Snapshot lease expired before storage completed.");
    }
    return { ok: true, capturedAt, pppCount: pppSecrets.length, hotspotCount: hotspotUsers.length };
  } catch (error) {
    const errorCode = error instanceof RouterUserSnapshotTooLargeError
      ? "snapshot_too_large"
      : "sync_failed";
    await failRouterUserSnapshot(adminId, routerId, leaseToken, errorCode);
    return { ok: false, errorCode };
  }
}

export async function processDueRouterUserSnapshots(
  resolveRouter: (adminId: number, routerId: number) => Promise<ResolvedSnapshotRouter | null>,
): Promise<{ claimed: number; succeeded: number; failed: number }> {
  const due = await sbRpc<ClaimedRouterUserSnapshot>("claim_due_router_user_snapshots", {
    p_limit: 5,
  });
  let succeeded = 0;
  let failed = 0;

  await Promise.all(due.map(async (claim) => {
    try {
      const router = await resolveRouter(Number(claim.admin_id), Number(claim.router_id));
      if (!router) {
        await failRouterUserSnapshot(
          Number(claim.admin_id),
          Number(claim.router_id),
          claim.lease_token,
          "router_unavailable",
        );
        failed += 1;
        return;
      }
      const result = await syncClaimedRouterUserSnapshot(
        Number(claim.admin_id),
        Number(claim.router_id),
        claim.lease_token,
        router.name,
        router.creds,
      );
      if (result.ok) succeeded += 1;
      else failed += 1;
    } catch {
      try {
        await failRouterUserSnapshot(
          Number(claim.admin_id),
          Number(claim.router_id),
          claim.lease_token,
          "sync_failed",
        );
      } catch {
        // Keep this worker's result bounded; the lease will expire for a later retry.
      }
      failed += 1;
    }
  }));

  return { claimed: due.length, succeeded, failed };
}