import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { sbInsert, sbSelect, sbUpdate, supabaseServiceRoleConfigured } from "../lib/supabase-client.js";
import { getMpesaSettings, getPaymentDestinations, isMpesaConfigured } from "../lib/settings-store.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const REGISTRATION_FEE = 500;

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function normalizeKenyanPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.startsWith("254")) return digits;
  return `254${digits}`;
}

function darajaBase(settings: Awaited<ReturnType<typeof getMpesaSettings>>): string {
  return settings.env === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

async function getDarajaToken(settings: Awaited<ReturnType<typeof getMpesaSettings>>): Promise<string> {
  const { consumerKey, consumerSecret } = settings;
  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const response = await fetch(`${darajaBase(settings)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!response.ok) throw new Error(`Daraja OAuth failed: ${response.status}`);
  return (await response.json() as { access_token: string }).access_token;
}

async function reconcileInitiatedRegistration(
  transactionId: number,
  checkoutId: string,
  merchantRequestId: string,
  notes: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const updated = await sbUpdate(
      "isp_transactions",
      `id=eq.${transactionId}&status=eq.initiating`,
      {
        reference: checkoutId,
        merchant_request_id: merchantRequestId,
        status: "pending",
        notes,
      },
    );
    if (updated[0]) return true;
    await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
  }
  return false;
}

function hasUsableCallback(settings: Awaited<ReturnType<typeof getMpesaSettings>>): boolean {
  try {
    const callback = new URL(settings.callbackUrl);
    return callback.protocol === "https:" && callback.pathname === "/api/mpesa/callback";
  } catch {
    return false;
  }
}

router.get("/registration/config", async (_req: Request, res: Response): Promise<void> => {
  const destinations = getPaymentDestinations();
  const mpesaSettings = await getMpesaSettings();
  const destination = destinations.destinations.find(row =>
    row.id === destinations.registrationDestinationId && row.active,
  );
  res.json({
    ok: true,
    registrationFee: { amount: REGISTRATION_FEE, currency: "KES" },
    automaticPaymentAvailable: !!destination && destination.type !== "bank" &&
      isMpesaConfigured(mpesaSettings) && hasUsableCallback(mpesaSettings),
    destination: destination ? {
      type: destination.type,
      name: destination.name,
      number: destination.number,
    } : null,
  });
});

router.post("/registration/payment", async (req: Request, res: Response): Promise<void> => {
  const company = typeof req.body?.company === "string" ? req.body.company.trim() : "";
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  const slug = slugify(company);
  const formattedPhone = normalizeKenyanPhone(phone);

  if (company.length < 2 || !slug || !phone || !/^2547\d{8}$/.test(formattedPhone)) {
    res.status(400).json({ ok: false, error: "Enter a company name and a valid Kenyan mobile number." });
    return;
  }
  const config = await getMpesaSettings();
  if (!isMpesaConfigured(config)) {
    res.status(503).json({ ok: false, error: "Registration payments are not configured yet. Contact support." });
    return;
  }
  if (!supabaseServiceRoleConfigured) {
    res.status(503).json({ ok: false, error: "Live M-Pesa settlement is temporarily unavailable." });
    return;
  }

  const settings = getPaymentDestinations();
  const destination = settings.destinations.find(row =>
    row.id === settings.registrationDestinationId && row.active,
  );
  if (!destination) {
    res.status(503).json({ ok: false, error: "No active payment destination has been selected for registration." });
    return;
  }
  if (destination.type === "bank") {
    res.status(409).json({
      ok: false,
      error: "The selected bank destination requires manual verification. Select a Till or PayBill for automatic registration.",
    });
    return;
  }

  const [nameMatches, phoneMatches] = await Promise.all([
    sbSelect<{ id: number }>("isp_admins", `subdomain=eq.${encodeURIComponent(slug)}&select=id&limit=1`),
    sbSelect<{ id: number }>("isp_admins", `phone=eq.${encodeURIComponent(phone)}&select=id&limit=1`),
  ]);
  if (nameMatches.length || phoneMatches.length) {
    res.status(409).json({ ok: false, error: "This company name or phone number is already registered." });
    return;
  }

  const pendingAdmins = await sbInsert<{ id: number; username: string }>("isp_admins", {
    name: company,
    phone,
    username: slug,
    password: "admin",
    is_active: false,
    role: "isp_admin",
    subdomain: slug,
    status: "pending_payment",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const pendingAdmin = pendingAdmins[0];
  if (!pendingAdmin) {
    res.status(500).json({ ok: false, error: "Could not start the registration. Please try again." });
    return;
  }

  try {
    const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
    const password = Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString("base64");
    const callbackUrl = config.callbackUrl;
    if (!hasUsableCallback(config)) {
      res.status(503).json({ ok: false, error: "M-Pesa requires a saved HTTPS callback URL." });
      return;
    }
    const initiatedTransactions = await sbInsert<{ id: number }>("isp_transactions", {
      admin_id: pendingAdmin.id,
      customer_id: null,
      plan_id: null,
      amount: REGISTRATION_FEE,
      payment_method: "mpesa_registration",
      payment_phone: formattedPhone,
      reference: `initiating:${randomUUID()}`,
      status: "initiating",
      notes: `Registration STK request is being created for ${slug}`,
      created_at: new Date().toISOString(),
    });
    const initiatedTransaction = initiatedTransactions[0];
    if (!initiatedTransaction) {
      await sbUpdate("isp_admins", `id=eq.${pendingAdmin.id}`, {
        status: "payment_failed",
        updated_at: new Date().toISOString(),
      });
      res.status(503).json({ ok: false, error: "Could not safely create the registration payment request. Please try again." });
      return;
    }
    const token = await getDarajaToken(config);
    const response = await fetch(`${darajaBase(config)}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: config.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: destination.type === "till" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
        Amount: REGISTRATION_FEE,
        PartyA: formattedPhone,
        PartyB: destination.number,
        PhoneNumber: formattedPhone,
        CallBackURL: callbackUrl,
        AccountReference: destination.accountReference || slug,
        TransactionDesc: "ISPlatty account registration",
      }),
    });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok || data.ResponseCode !== "0") {
      await sbUpdate("isp_transactions", `id=eq.${initiatedTransaction.id}&status=eq.initiating`, {
        status: "failed",
        notes: `Registration STK prompt request failed: ${String(data.errorMessage ?? data.ResponseDescription ?? "Unknown error")}`,
      });
      await sbUpdate("isp_admins", `id=eq.${pendingAdmin.id}`, {
        status: "payment_failed",
        updated_at: new Date().toISOString(),
      });
      res.status(400).json({
        ok: false,
        error: String(data.errorMessage ?? data.ResponseDescription ?? "Could not send the registration payment prompt."),
      });
      return;
    }

    const checkoutId = String(data.CheckoutRequestID ?? "");
    const reconciled = checkoutId && await reconcileInitiatedRegistration(
      initiatedTransaction.id,
      checkoutId,
      String(data.MerchantRequestID ?? ""),
      `Pending ISP registration for ${slug}`,
    );
    if (!reconciled) {
      await sbUpdate("isp_admins", `id=eq.${pendingAdmin.id}`, {
        status: "payment_failed",
        updated_at: new Date().toISOString(),
      });
      res.status(500).json({ ok: false, error: "Could not record the registration payment. Please contact support." });
      return;
    }

    res.json({
      ok: true,
      CheckoutRequestID: checkoutId,
      registrationFee: { amount: REGISTRATION_FEE, currency: "KES" },
      username: pendingAdmin.username,
    });
  } catch (error) {
    await sbUpdate("isp_admins", `id=eq.${pendingAdmin.id}`, {
      status: "payment_failed",
      updated_at: new Date().toISOString(),
    });
    logger.error({ err: error, adminId: pendingAdmin.id }, "[registration/payment] failed");
    res.status(500).json({ ok: false, error: "Could not send the registration payment prompt. Please try again." });
  }
});

export default router;