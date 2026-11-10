import { createHash, randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { billingRpc, billingSelect } from "../lib/platform-billing-store.js";
import { sbSelectStrict } from "../lib/supabase-client.js";
import { activeSuperAdminName } from "./super-admin-auth-route.js";

const router: IRouter = Router();

function superAdmin(req: Request, res: Response): string | null {
  const name = activeSuperAdminName(String(req.headers["x-sa-token"] ?? ""));
  if (!name) res.status(401).json({ ok: false, error: "Super Admin authentication required." });
  return name;
}

router.get("/super-admin/admin-renewal-vouchers/accounts", async (req, res): Promise<void> => {
  if (!superAdmin(req, res)) return;
  try {
    const admins = await sbSelectStrict<{
      id: number; name: string | null; username: string | null; role: string; is_active: boolean;
    }>("isp_admins",
    "role=in.(isp_admin,reseller)&is_active=is.true&select=id,name,username,role,is_active&order=name.asc,id.asc&limit=2000");
    res.json({
      ok: true,
      accounts: admins.map(account => ({
        id: account.id,
        name: account.name || account.username || `Admin #${account.id}`,
        role: account.role,
      })),
    });
  } catch {
    res.status(503).json({ ok: false, error: "Eligible admin accounts could not be loaded." });
  }
});

router.get("/super-admin/admin-renewal-vouchers", async (req, res): Promise<void> => {
  if (!superAdmin(req, res)) return;
  try {
    const [vouchers, redemptions] = await Promise.all([
      billingSelect<Record<string, unknown>>("admin_renewal_vouchers",
        "select=id,benefit_type,target_admin_id,created_by,max_uses,expires_at,status,created_at,revoked_at,revoked_by&order=created_at.desc&limit=2000"),
      billingSelect<Record<string, unknown>>("admin_renewal_voucher_redemptions",
        "select=id,voucher_id,account_id,billing_invoice_id,actor_admin_id,renewal_period,renewal_applied,redeemed_at&order=redeemed_at.desc&limit=10000"),
    ]);
    const accountIds = [...new Set([
      ...vouchers.map(row => Number(row.target_admin_id)).filter(Number.isSafeInteger),
      ...redemptions.map(row => Number(row.account_id)).filter(Number.isSafeInteger),
    ].filter(id => id > 0))];
    const accounts = accountIds.length
      ? await sbSelectStrict<{ id: number; name: string | null; username: string | null }>(
        "isp_admins", `id=in.(${accountIds.join(",")})&select=id,name,username&limit=3000`,
      )
      : [];
    const names = new Map(accounts.map(row => [row.id, row.name || row.username || `Admin #${row.id}`]));
    const now = Date.now();
    res.json({
      ok: true,
      vouchers: vouchers.map(voucher => {
        const uses = redemptions.filter(row => Number(row.voucher_id) === Number(voucher.id));
        const status = voucher.status === "revoked" ? "revoked"
          : voucher.expires_at && Date.parse(String(voucher.expires_at)) <= now ? "expired"
          : uses.length >= Number(voucher.max_uses) ? "exhausted" : "active";
        return {
          id: voucher.id,
          benefit: "Covers one monthly platform renewal invoice",
          targetAdminId: voucher.target_admin_id,
          targetAdminName: voucher.target_admin_id == null ? null : names.get(Number(voucher.target_admin_id)) ?? "Unavailable account",
          createdBy: voucher.created_by,
          maxUses: voucher.max_uses,
          redemptionCount: uses.length,
          expiresAt: voucher.expires_at,
          status,
          createdAt: voucher.created_at,
          revokedAt: voucher.revoked_at,
          revokedBy: voucher.revoked_by,
          redemptions: uses.map(row => ({
            accountId: row.account_id,
            accountName: names.get(Number(row.account_id)) ?? `Admin #${row.account_id}`,
            invoiceId: row.billing_invoice_id,
            period: row.renewal_period,
            amountCovered: Number(row.renewal_applied),
            redeemedAt: row.redeemed_at,
          })),
        };
      }),
    });
  } catch {
    res.status(503).json({ ok: false, error: "Renewal vouchers could not be loaded." });
  }
});

router.post("/super-admin/admin-renewal-vouchers", async (req, res): Promise<void> => {
  const actor = superAdmin(req, res);
  if (!actor) return;
  const rawTarget = req.body?.targetAdminId;
  const targetAdminId = rawTarget === null || rawTarget === "" || rawTarget === undefined
    ? null : Number(rawTarget);
  const maxUses = Number(req.body?.maxUses);
  const rawExpiry = typeof req.body?.expiresAt === "string" ? req.body.expiresAt.trim() : "";
  const expiresAt = rawExpiry ? new Date(rawExpiry) : null;
  if ((targetAdminId !== null && (!Number.isSafeInteger(targetAdminId) || targetAdminId < 1))
    || !Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 10000
    || (rawExpiry && (!expiresAt || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()))) {
    res.status(400).json({ ok: false, error: "Choose an eligible admin, a use limit from 1 to 10,000, and a future expiry date." });
    return;
  }
  try {
    const code = `AR-${randomBytes(24).toString("hex").toUpperCase()}`;
    const codeHash = createHash("sha256").update(code).digest("hex");
    const created = await billingRpc<Array<{ id: number }>>("create_admin_renewal_voucher", {
      p_code_hash: codeHash,
      p_target_admin_id: targetAdminId,
      p_created_by: actor,
      p_max_uses: maxUses,
      p_expires_at: expiresAt?.toISOString() ?? null,
    });
    if (!Array.isArray(created) || !created[0]?.id) throw new Error("Voucher record was not created.");
    res.status(201).json({ ok: true, voucher: { id: created[0].id, code } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/Target account is not eligible/i.test(message)) {
      res.status(400).json({ ok: false, error: "Choose an active ISP admin or reseller account." });
      return;
    }
    res.status(503).json({ ok: false, error: "Voucher could not be created. Confirm the renewal-voucher migration is applied." });
  }
});

router.post("/super-admin/admin-renewal-vouchers/:id/revoke", async (req, res): Promise<void> => {
  const actor = superAdmin(req, res);
  if (!actor) return;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ ok: false, error: "Choose a valid voucher." });
    return;
  }
  try {
    const revoked = await billingRpc<boolean>("revoke_admin_renewal_voucher", {
      p_voucher_id: id,
      p_actor: actor,
    });
    if (revoked !== true) {
      res.status(409).json({ ok: false, error: "Voucher is already revoked or unavailable." });
      return;
    }
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: "Voucher could not be revoked." });
  }
});

export default router;
