export interface HotspotFileAuthorizationActor {
  type?: unknown;
  uid?: unknown;
  impersonationSessionId?: unknown;
}

export function hasHotspotFileReplacementConsent(
  actor: HotspotFileAuthorizationActor | undefined,
  consent: unknown,
): boolean {
  return hasSuperAdminHotspotFileConsent(actor, consent);
}

export function hasSuperAdminHotspotFileConsent(
  actor: HotspotFileAuthorizationActor | undefined,
  consent: unknown,
): boolean {
  const isSuperAdmin = actor?.type === "a" && (
    actor.uid === "superadmin"
    || (typeof actor.impersonationSessionId === "string" && actor.impersonationSessionId.length > 0)
  );
  return isSuperAdmin && consent === true;
}