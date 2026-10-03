export interface HotspotFileAuthorizationActor {
  type?: unknown;
  uid?: unknown;
  impersonationSessionId?: unknown;
}

export function hasHotspotFileMutationConfirmation(
  actor: HotspotFileAuthorizationActor | undefined,
  confirmed: unknown,
): boolean {
  return actor?.type === "a" && confirmed === true;
}
