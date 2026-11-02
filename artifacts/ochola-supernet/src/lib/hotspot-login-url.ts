/**
 * RouterOS macros are expanded only when the page is served by the router.
 * Do not treat an unresolved macro or its common rendered placeholder as a
 * usable handoff URL; doing so sends customers to a dead POST endpoint.
 */
export function isResolvedHotspotLoginUrl(value: string): boolean {
  const candidate = value.trim();
  if (!candidate) return false;

  if (
    /\$\s*\(\s*link-login(?:-only)?\s*\)/i.test(candidate)
    || /\/(?:\(\s*)?link-login-only(?:\s*\))?(?:[/?#]|$)/i.test(candidate)
  ) {
    return false;
  }

  try {
    const url = new URL(candidate);
    return (url.protocol === "http:" || url.protocol === "https:")
      && Boolean(url.hostname)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}
