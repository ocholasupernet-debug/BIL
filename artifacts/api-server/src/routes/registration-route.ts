import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { processDeferredMpesaCallbacks } from "./mpesa-route.js";
import { sbInsert, sbInsertStrict, sbRpc, sbSelect, sbSelectStrict, sbUpdate, supabaseServiceRoleConfigured } from "../lib/supabase-client.js";
import {
  ensureMpesaRegistrationDestination,
  getMpesaSettings,
  getPaymentDestinations,
  isMpesaConfigured,
} from "../lib/settings-store.js";
import { logger } from "../lib/logger.js";
import { hashIspAdminPassword } from "../lib/passwords.js";
import { RESERVED_SUBDOMAINS } from "../lib/tenant-host.js";

const router: IRouter = Router();
const INITIAL_ADMIN_USERNAME = "admin";
const INITIAL_ADMIN_PASSWORD = "admin";

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function subdomainCandidate(base: string, ordinal: number): string {
  const suffix = ordinal === 1 ? "" : `-${ordinal}`;
  return `${base.slice(0, 63 - suffix.length)}${suffix}`;
}

async function findAvailableSubdomain(company: string): Promise<string> {
  const slug = slugify(company);
  const base = RESERVED_SUBDOMAINS.has(slug) ? `${slug}-isp` : slug;
  if (!base) throw new Error("A usable company subdomain could not be generated.");

  for (let ordinal = 1; ordinal <= 1000; ordinal += 1) {
    const candidate = subdomainCandidate(base, ordinal);
    const matches = await sbSelect<{ id: number }>(
      "isp_admins",
      `subdomain=eq.${encodeURIComponent(candidate)}&select=id&limit=1`,
    );
    if (!matches.length) return candidate;
  }

  throw new Error("No available ISP subdomain remains for this company name.");
}

function normalizeKenyanPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.startsWith("254")) return digits;
  return `254${digits}`;
}

function darajaBase(settings: Awaited<ReturnType<typeof getMpesaSettings>>): string {
  return settings.env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
}

async function getDarajaToken(settings: Awaited<ReturnType<typeof getMpesaSettings>>): Promise<string> {
  const credentials = Buffer.from(`${settings.consumerKey}:${settings.consumerSecret}`).toString("base64");
  const response = await fetch(`${darajaBase(settings)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!response.ok) throw new Error(`Daraja OAuth failed: ${response.status}`);
  return (await response.json() as { access_token: string }).access_token;
}

async function reconcileInitiatedRegistration(transactionId: number, checkoutId: string, merchantRequestId: string, notes: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const updated = await sbUpdate("isp_transactions", `id=eq.${transactionId}&status=eq.initiating`, {
      reference: checkoutId, merchant_request_id: merchantRequestId, status: "pending", notes,
    });
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

async function registrationSchemaReady(): Promise<boolean> {
  if (!supabaseServiceRoleConfigured) return false;
  try {
    const versions = await sbRpc<{ schema_version: number; payment_phone_available: boolean }>(
      "registration_payment_schema_version",
      {},
    );
    return versions[0]?.schema_version === 1 && versions[0]?.payment_phone_available === true;
  } catch (error) {
    logger.warn({ err: error }, "[registration] settlement schema readiness check failed");
    return false;
  }
}

async function adminPasswordSetupSchemaReady(): Promise<boolean> {
  try {
    await sbSelectStrict<{ must_change_password: boolean }>(
      "isp_admins",
      "select=must_change_password&limit=1",
    );
    return true;
  } catch (error) {
    logger.warn({ err: error }, "[registration] password setup schema readiness check failed");
    return false;
  }
}

router.get("/registration/config", async (_req: Request, res: Response): Promise<void> => {
  let destinations = getPaymentDestinations();
  const mpesaSettings = await getMpesaSettings();
  const [paymentSchemaReady, passwordSetupSchemaReady] = await Promise.all([
    registrationSchemaReady(),
    adminPasswordSetupSchemaReady(),
  ]);
  const schemaReady = paymentSchemaReady && passwordSetupSchemaReady;
  let destination = destinations.destinations.find(row => row.id === destinations.registrationDestinationId && row.active);
  if (isMpesaConfigured(mpesaSettings)) {
    destinations = ensureMpesaRegistrationDestination(mpesaSettings);
    destination = destinations.destinations.find(row => row.id === destinations.registrationDestinationId && row.active);
  }
  const automaticPaymentAvailable = !!destination && destination.type !== "bank" &&
    schemaReady && isMpesaConfigured(mpesaSettings) && hasUsableCallback(mpesaSettings) &&
    !!destination.number;

  res.json({
    ok: true,
    registrationFee: { amount: destinations.registrationFee, currency: "KES" },
    registrationAvailable: (destination?.type === "bank" && schemaReady) || automaticPaymentAvailable,
    manualPaymentRequired: destination?.type === "bank" && schemaReady,
    automaticPaymentAvailable,
    destination: destination ? {
      type: destination.type, name: destination.name, number: destination.number,
      accountReference: destination.accountReference, instructions: destination.instructions,
    } : null,
  });
});

router.post("/registration/payment", async (req: Request, res: Response): Promise<void> => {
  const company = typeof req.body?.company === "string" ? req.body.company.trim() : "";
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  const paymentPhone = typeof req.body?.paymentPhone === "string" ? req.body.paymentPhone.trim() : "";
  const slug = slugify(company);
  const formattedPhone = normalizeKenyanPhone(phone);
  const formattedPaymentPhone = normalizeKenyanPhone(paymentPhone);

  if (company.length < 2 || !slug || !/^2547\d{8}$/.test(formattedPhone) ||
      !/^2547\d{8}$/.test(formattedPaymentPhone)) {
    res.status(400).json({ ok: false, error: "Enter a company name and valid contact and M-Pesa payment numbers." });
    return;
  }

  let settings = getPaymentDestinations();
  const registrationFee = settings.registrationFee;
  let destination = settings.destinations.find(row => row.id === settings.registrationDestinationId && row.active);
  const config = destination?.type === "bank" ? null : await getMpesaSettings();
  if (config && isMpesaConfigured(config)) {
    settings = ensureMpesaRegistrationDestination(config);
    destination = settings.destinations.find(row => row.id === settings.registrationDestinationId && row.active);
  }
  if (!destination) {
    res.status(503).json({ ok: false, error: "No active payment destination has been selected for registration." });
    return;
  }
  if (!await registrationSchemaReady() || !await adminPasswordSetupSchemaReady()) {
    res.status(503).json({ ok: false, error: "Registration is temporarily unavailable while the account setup database migration is completed." });
    return;
  }
  if (destination.type !== "bank" && (!config || !isMpesaConfigured(config))) {
    res.status(503).json({ ok: false, error: "Registration payments are not configured yet. Contact support." });
    return;
  }
  if (!supabaseServiceRoleConfigured) {
    res.status(503).json({ ok: false, error: destination.type === "bank"
      ? "Registration is temporarily unavailable. Please try again later."
      : "Live M-Pesa settlement is temporarily unavailable." });
    return;
  }

  const phoneMatches = await sbSelect<{ id: number }>(
    "isp_admins",
    `phone=eq.${encodeURIComponent(phone)}&select=id&limit=1`,
  );
  if (phoneMatches.length) {
    res.status(409).json({ ok: false, error: "This phone number is already registered." });
    return;
  }

  let pendingAdmin: { id: number; username: string; subdomain: string } | undefined;
  for (let attempt = 0; attempt < 5 && !pendingAdmin; attempt += 1) {
    const candidate = await findAvailableSubdomain(company);
    try {
      const inserted = await sbInsertStrict<{ id: number; username: string; subdomain: string }>("isp_admins", {
        name: company, phone, payment_phone: formattedPaymentPhone, username: INITIAL_ADMIN_USERNAME,
        password: await hashIspAdminPassword(INITIAL_ADMIN_PASSWORD), must_change_password: true,
        is_active: false, role: "isp_admin", subdomain: candidate, status: "pending_payment",
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      pendingAdmin = inserted[0];
    } catch (error) {
      if (!String(error).includes("HTTP 409")) throw error;
      /* Another registration won the candidate between SELECT and INSERT. */
    }
  }
  if (!pendingAdmin) {
    res.status(503).json({ ok: false, error: "Could not allocate a unique ISP subdomain. Please try again." });
    return;
  }

  try {
    if (destination.type === "bank") {
      const manualTransactions = await sbInsert<{ id: number }>("isp_transactions", {
        admin_id: pendingAdmin.id, customer_id: null, plan_id: null, amount: registrationFee,
        payment_method: "manual_registration", payment_phone: formattedPaymentPhone,
        reference: `manual:${randomUUID()}`, status: "pending",
        notes: `Pending manual registration payment for ${slug}`, created_at: new Date().toISOString(),
      });
      if (!manualTransactions[0]) {
        await sbUpdate("isp_admins", `id=eq.${pendingAdmin.id}`, { status: "payment_failed", updated_at: new Date().toISOString() });
        res.status(503).json({ ok: false, error: "Could not safely create the registration request. Please try again." });
        return;
      }
      res.json({
        ok: true, manualPayment: true, registrationFee: { amount: registrationFee, currency: "KES" },
        destination: {
          type: destination.type, name: destination.name, number: destination.number,
          accountReference: destination.accountReference, instructions: destination.instructions,
        },
        username: pendingAdmin.username, subdomain: pendingAdmin.subdomain,
      });
      return;
    }

    if (!config) {
      res.status(503).json({ ok: false, error: "Registration payments are not configured yet. Contact support." });
      return;
    }
    if (!hasUsableCallback(config)) {
      res.status(503).json({ ok: false, error: "M-Pesa requires a saved HTTPS callback URL." });
      return;
    }
    const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
    const darajaPassword = Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString("base64");
    const initiatedTransactions = await sbInsert<{ id: number }>("isp_transactions", {
      admin_id: pendingAdmin.id, customer_id: null, plan_id: null, amount: registrationFee,
      payment_method: "mpesa_registration", payment_phone: formattedPaymentPhone,
      reference: `initiating:${randomUUID()}`, status: "initiating",
      notes: `Registration STK request is being created for ${slug}`, created_at: new Date().toISOString(),
    });
    const initiatedTransaction = initiatedTransactions[0];
    if (!initiatedTransaction) {
      await sbUpdate("isp_admins", `id=eq.${pendingAdmin.id}`, { status: "payment_failed", updated_at: new Date().toISOString() });
      res.status(503).json({ ok: false, error: "Could not safely create the registration payment request. Please try again." });
      return;
    }
    const token = await getDarajaToken(config);
    const response = await fetch(`${darajaBase(config)}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: config.shortcode, Password: darajaPassword, Timestamp: timestamp,
        TransactionType: destination.type === "till" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
        Amount: registrationFee, PartyA: formattedPaymentPhone, PartyB: destination.number,
        PhoneNumber: formattedPaymentPhone, CallBackURL: config.callbackUrl,
        AccountReference: destination.accountReference || slug, TransactionDesc: "ISPlatty account registration",
      }),
    });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok || data.ResponseCode !== "0") {
      await sbUpdate("isp_transactions", `id=eq.${initiatedTransaction.id}&status=eq.initiating`, {
        status: "failed", notes: `Registration STK prompt request failed: ${String(data.errorMessage ?? data.ResponseDescription ?? "Unknown error")}`,
      });
      await sbUpdate("isp_admins", `id=eq.${pendingAdmin.id}`, { status: "payment_failed", updated_at: new Date().toISOString() });
      res.status(400).json({ ok: false, error: String(data.errorMessage ?? data.ResponseDescription ?? "Could not send the registration payment prompt.") });
      return;
    }

    const checkoutId = String(data.CheckoutRequestID ?? "");
    const reconciled = checkoutId && await reconcileInitiatedRegistration(
      initiatedTransaction.id, checkoutId, String(data.MerchantRequestID ?? ""), `Pending ISP registration for ${slug}`,
    );
    if (!reconciled) {
      await sbUpdate("isp_admins", `id=eq.${pendingAdmin.id}`, { status: "payment_failed", updated_at: new Date().toISOString() });
      res.status(500).json({ ok: false, error: "Could not record the registration payment. Please contact support." });
      return;
    }
    await processDeferredMpesaCallbacks(checkoutId);
    res.json({
      ok: true, CheckoutRequestID: checkoutId, registrationFee: { amount: registrationFee, currency: "KES" },
      username: pendingAdmin.username, subdomain: pendingAdmin.subdomain,
    });
  } catch (error) {
    await sbUpdate("isp_admins", `id=eq.${pendingAdmin.id}`, { status: "payment_failed", updated_at: new Date().toISOString() });
    logger.error({ err: error, adminId: pendingAdmin.id }, "[registration/payment] failed");
    res.status(500).json({ ok: false, error: "Could not send the registration payment prompt. Please try again." });
  }
});

export default router;