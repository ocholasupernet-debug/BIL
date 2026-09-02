import { sbSelectStrict, sbUpdateStrict } from "./supabase-client.js";
import { encryptVpnSecret, decryptVpnSecret } from "./vpn-crypto.js";
import { routerManagementOvpnCredentials, type RouterManagementOvpnCredentials } from "./router-management-vpn.js";

type StoredRouterVpnCredentials = {
  management_vpn_username: string | null;
  management_vpn_password_ciphertext: string | null;
  management_vpn_password_iv: string | null;
  management_vpn_password_auth_tag: string | null;
};

const locks = new Map<number, Promise<RouterManagementOvpnCredentials>>();

/**
 * Load or create the router's dedicated management VPN identity.
 *
 * The password is encrypted before it is stored in isp_routers. The plaintext
 * is returned only to the server-side script generator that needs to place it
 * in the router/VPS setup payload.
 */
export async function ensureRouterManagementOvpnCredentials(input: {
  routerId: number;
  adminId: number;
  routerName: string;
}): Promise<RouterManagementOvpnCredentials> {
  const existing = locks.get(input.routerId);
  if (existing) return existing;

  const operation = (async () => {
    const rows = await sbSelectStrict<StoredRouterVpnCredentials>(
      "isp_routers",
      `id=eq.${encodeURIComponent(String(input.routerId))}&admin_id=eq.${encodeURIComponent(String(input.adminId))}` +
      "&select=management_vpn_username,management_vpn_password_ciphertext,management_vpn_password_iv,management_vpn_password_auth_tag&limit=1",
    );
    if (!rows[0]) throw new Error("Router was not found while loading management VPN credentials.");

    const row = rows[0];
    if (
      row.management_vpn_username
      && row.management_vpn_password_ciphertext
      && row.management_vpn_password_iv
      && row.management_vpn_password_auth_tag
    ) {
      return {
        username: row.management_vpn_username,
        password: decryptVpnSecret({
          ciphertext: row.management_vpn_password_ciphertext,
          iv: row.management_vpn_password_iv,
          auth_tag: row.management_vpn_password_auth_tag,
        }),
      };
    }

    const credentials = routerManagementOvpnCredentials(input.routerName);
    const encrypted = encryptVpnSecret(credentials.password);
    await sbUpdateStrict(
      "isp_routers",
      `id=eq.${encodeURIComponent(String(input.routerId))}&admin_id=eq.${encodeURIComponent(String(input.adminId))}`,
      {
        management_vpn_username: credentials.username,
        management_vpn_password_ciphertext: encrypted.ciphertext,
        management_vpn_password_iv: encrypted.iv,
        management_vpn_password_auth_tag: encrypted.auth_tag,
        updated_at: new Date().toISOString(),
      },
    );
    return credentials;
  })().finally(() => locks.delete(input.routerId));

  locks.set(input.routerId, operation);
  return operation;
}