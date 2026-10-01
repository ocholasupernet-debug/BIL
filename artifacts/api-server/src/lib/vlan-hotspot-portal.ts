/**
 * Add the RouterOS router identity and active HotSpot server name to the
 * reseller portal handoff. NAS-Identifier is router-wide; server-name
 * disambiguates the reseller VLAN served by that router.
 */
export function addVlanIdentityToRlogin(html: string): string {
  const withoutRefresh = html
    .replace(/<meta\b[^>]*http-equiv=["']refresh["'][^>]*>/i, "")
    .replace(/<script\b[^>]*id=["']vlan-portal-identity-redirect["'][^>]*>[\s\S]*?<\/script>/i, "");
  const redirect = `<script id="vlan-portal-identity-redirect" data-login-url="$(link-login-only)" data-nasid="$(identity)" data-server-name="$(server-name)">
(function(){
  var source=document.getElementById("vlan-portal-identity-redirect");
  if(!source)return;
  var target=new URL(source.getAttribute("data-login-url")||window.location.href,window.location.href);
  target.searchParams.set("nasid",source.getAttribute("data-nasid")||"");
  target.searchParams.set("server",source.getAttribute("data-server-name")||"");
  window.location.replace(target.toString());
})();
</script>`;
  return /<\/body\s*>/i.test(withoutRefresh)
    ? withoutRefresh.replace(/<\/body\s*>/i, `${redirect}\n</body>`)
    : `${withoutRefresh}\n${redirect}`;
}