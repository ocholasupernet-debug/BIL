
async function accountFromRequest(req: Request) {
  if (!req.authUser) {
    const auth = validateToken(extractToken(req));
    if (auth?.type === "a") req.authUser = auth;
  }
  return authenticatedAccount(req);
}

async function paymentAdminIdFromRequest(req: Request): Promise<number | null> {
  const requested = adminIdFromRequest(req);
  const account = await accountFromRequest(req);
  if (account?.role === "reseller") return account.id;
  return requested;
}

async function portalPaymentAdminIdFromRequest(req: Request): Promise<number | null> {
  const requested = adminIdFromRequest(req);
  const account = await accountFromRequest(req);
  if (account?.role === "reseller") return account.parent_id;
  return requested;
}

async function paymentChangeAdminId(req: Request, requested: unknown): Promise<number | null> {
  const account = await accountFromRequest(req);
  if (account?.role === "reseller") return account.id;
  const adminId = Number(requested);
  return Number.isInteger(adminId) && adminId > 0 ? adminId : null;
}

async function getAdminPaymentSettings(adminId: number | null, options: { useSharedGateway?: boolean } = {}): Promise<{
  paymentGateway: string;
  bankStkPush: BankStkPushConfig;
  mpesaTillPush: MpesaTillPushConfig;
  mpesaPaybill: MpesaPaybillConfig;
  bankTransfer: BankTransferConfig;
  paymentCollectionMode: "shared" | "separate";
  serviceConfigs: Partial<Record<PaymentService, ServicePaymentConfig>>;
}> {
  if (!adminId) {
    return {
      paymentGateway: "mpesa_paybill",
      bankStkPush: { bankName: "", paybillNumber: "", accountNumber: "" },
      mpesaTillPush: { tillNumber: "" },
      mpesaPaybill: { paybillNumber: "", accountNumber: "" },
      bankTransfer: { bankName: "", accountName: "", accountNumber: "", branchCode: "", paymentInstructions: "" },
      paymentCollectionMode: "shared",
      serviceConfigs: {},
    };
  }
  const rows = await sbSelect<{
    payment_gateway?: string;
    payment_gateway_config?: unknown;
    payment_collection_mode?: string;
    payment_service_config?: unknown;
  }>(
    "isp_admins",
    `id=eq.${adminId}&select=payment_gateway,payment_gateway_config,payment_collection_mode,payment_service_config&limit=1`,
  );
  const mode = paymentCollectionMode(rows[0]?.payment_collection_mode);
  const serviceConfigs = servicePaymentConfigMap(rows[0]?.payment_service_config);
  const sharedGatewayId = getPaymentGateway(rows[0]?.payment_gateway);
  const sharedConfigs = gatewayConfigMap(rows[0]?.payment_gateway_config);
  const selected = mode === "separate" && options.useSharedGateway !== true ? undefined : sharedConfigs;
  return {
    paymentGateway: mode === "separate" && options.useSharedGateway !== true
      ? (serviceConfigs.hotspot?.gatewayId ?? "unconfigured")
      : sharedGatewayId,
    bankStkPush: selected ? bankStkPushConfig(selected) : serviceConfigs.hotspot?.gatewayId === "bank_stk_push"
      ? { bankName: serviceConfigs.hotspot.config.bankName ?? "", paybillNumber: serviceConfigs.hotspot.config.paybillNumber ?? "", accountNumber: serviceConfigs.hotspot.config.accountNumber ?? "" }
      : { bankName: "", paybillNumber: "", accountNumber: "" },
    mpesaTillPush: selected ? mpesaTillPushConfig(selected) : { tillNumber: serviceConfigs.hotspot?.config.tillNumber ?? "" },
    mpesaPaybill: selected ? mpesaPaybillConfig(selected) : { paybillNumber: serviceConfigs.hotspot?.config.paybillNumber ?? "", accountNumber: serviceConfigs.hotspot?.config.accountNumber ?? "" },
    bankTransfer: bankTransferConfig(sharedConfigs),
    paymentCollectionMode: mode,
    serviceConfigs,
  };
}

async function scrubLegacyDarajaCredentials(adminId: number): Promise<void> {
  const [row] = await sbSelect<{
    payment_gateway_config?: unknown;
    payment_service_config?: unknown;
  }>(
    "isp_admins",
    `id=eq.${adminId}&select=payment_gateway_config,payment_service_config&limit=1`,
  );
  if (!row) return;

  const paymentGatewayConfig = routingGatewayConfigMap(row.payment_gateway_config);
  let gatewayConfigChanged = false;
  for (const gatewayId of ["mpesa_paybill", "mpesa_till_push", "bank_stk_push"]) {
    const config = paymentGatewayConfig[gatewayId];
    if (config && hasDarajaAuthFields(config)) {
      paymentGatewayConfig[gatewayId] = collectionConfig(gatewayId, config);
      gatewayConfigChanged = true;
    }
  }

  const rawServiceConfig = row.payment_service_config;
  const serviceConfig = rawServiceConfig && typeof rawServiceConfig === "object" && !Array.isArray(rawServiceConfig)
    ? { ...rawServiceConfig as Record<string, unknown> }
    : null;
  let serviceConfigChanged = false;
  if (serviceConfig) {
    for (const service of ["hotspot", "pppoe", "vlan"]) {
      const entry = serviceConfig[service];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      const gatewayId = typeof record.gatewayId === "string" ? record.gatewayId : "";
      if (!isDarajaGateway(gatewayId) || !hasDarajaAuthFields(record.config)) continue;
      serviceConfig[service] = {
        ...record,
        config: collectionConfig(gatewayId, record.config),
      };
      serviceConfigChanged = true;
    }
  }

  if (!gatewayConfigChanged && !serviceConfigChanged) return;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (gatewayConfigChanged) updates.payment_gateway_config = paymentGatewayConfig;
  if (serviceConfigChanged) updates.payment_service_config = serviceConfig;
  const updated = await sbUpdate("isp_admins", `id=eq.${adminId}`, updates);
  if (updated.length === 0) {
    throw new Error("Could not remove legacy ISP-owned Daraja credentials.");
  }
}

function respondWithMpesaSettingsUnavailable(res: Response, error: unknown): boolean {
  if (!(error instanceof MpesaSettingsUnavailableError)) return false;
  logger.warn({ err: error }, "[settings/mpesa] global Super Admin Daraja settings unavailable");
  res.status(503).json({ ok: false, configured: false, error: error.message });
  return true;
}

/* ── GET /api/settings/mpesa ── */
router.get("/settings/mpesa", async (req: Request, res: Response): Promise<void> => {
  try {
  const s = await getMpesaSettings();
  const portalScope = req.hotspotPortalContext;
  const adminTest = !portalScope && req.query.adminTest === "true";
  const paymentAdminId = portalScope?.adminId ?? await paymentAdminIdFromRequest(req);
  const { paymentGateway: adminPaymentGateway, bankStkPush, mpesaTillPush, mpesaPaybill, paymentCollectionMode: collectionMode } =
    await getAdminPaymentSettings(paymentAdminId, { useSharedGateway: adminTest });
  const portalRoute = adminTest
    ? null
    : await resellerPortalPaymentStatus(
        portalScope?.adminId ?? await portalPaymentAdminIdFromRequest(req),
        portalScope?.routerId ?? positiveQueryId(req.query.routerId),
        portalScope?.portId ?? positiveQueryId(req.query.portId),
      );
  const paymentGateway = portalScope
    ? portalRoute?.paymentGateway ?? ""
    : portalRoute?.paymentGateway ?? adminPaymentGateway;
  const destinationConfigured = portalScope
    ? portalRoute?.destinationConfigured === true
    : portalRoute?.destinationConfigured ?? (
      paymentGateway === "mpesa_till_push"
        ? !!mpesaTillPush.tillNumber
        : paymentGateway === "mpesa_paybill"
          ? !!(mpesaPaybill.paybillNumber && mpesaPaybill.accountNumber)
          : paymentGateway === "bank_stk_push"
            ? isBankStkPushConfigured(bankStkPush)
            : false
    );
  if (portalScope) {
    logger.info({
      event: "hotspot.payment_gateway",
      incomingNasId: req.hotspotNasIdentifier ?? null,
      hotspotServerName: req.hotspotServerName ?? null,
      mappedResellerId: portalScope.resellerId,
      loadedGateway: paymentGateway || "unavailable",
      destinationConfigured,
    }, "Loaded payment gateway for the mapped reseller Hotspot service");
  }
  res.json({
    ok: true,
    configured: portalScope
      ? isMpesaConfigured(s) && destinationConfigured
      : isMpesaConfigured(s),
    settings: {
      shortcode:      portalScope ? "" : s.shortcode,
      env:            s.env,
      hasTillNumber:  paymentGateway === "mpesa_till_push" && destinationConfigured,
      destinationConfigured,
      paymentGateway,
      bankStkPushConfigured: portalScope
        ? paymentGateway === "bank_stk_push" && destinationConfigured
        : isBankStkPushConfigured(bankStkPush),
      adminTillPushConfigured: portalScope
        ? paymentGateway === "mpesa_till_push" && destinationConfigured
        : !!mpesaTillPush.tillNumber,
      adminPaybillConfigured: portalScope
        ? paymentGateway === "mpesa_paybill" && destinationConfigured
        : !!(mpesaPaybill.paybillNumber && mpesaPaybill.accountNumber),
      paymentCollectionMode: portalScope ? "separate" : collectionMode,
    },
  });
  } catch (error) {
    if (respondWithMpesaSettingsUnavailable(res, error)) return;
    throw error;
  }
});

/* ── ISP Admin payment gateway preference ── */
router.get("/admin/payment-gateway", async (req: Request, res: Response): Promise<void> => {
  const adminId = await paymentAdminIdFromRequest(req);
  if (!adminId) {
    res.status(400).json({ ok: false, error: "A valid adminId is required." });
    return;
  }
  if (!(await requireAdminPaymentChange(req, res, adminId))) return;
  await scrubLegacyDarajaCredentials(adminId);
  const settings = await getAdminPaymentSettings(adminId);
  res.set("Cache-Control", "no-store").json({
    ok: true,
    settings: { paymentGateway: settings.paymentGateway },
  });
});

router.post("/admin/payment-gateway", async (req: Request, res: Response): Promise<void> => {
  const adminId = await paymentChangeAdminId(req, req.body?.adminId);
  const paymentGateway = getPaymentGateway(req.body?.paymentGateway);
  if (!adminId) {
    res.status(400).json({ ok: false, error: "A valid adminId is required." });
    return;
  }
  if (!(await requireAdminPaymentChange(req, res, adminId))) return;
  await scrubLegacyDarajaCredentials(adminId);

  const updated = await sbUpdate(
    "isp_admins",
    `id=eq.${adminId}`,
    { payment_gateway: paymentGateway },
  );
  if (updated.length === 0) {
    res.status(404).json({ ok: false, error: "ISP admin was not found or the setting could not be saved." });
    return;
  }
  void sendPlatformSecurityNotice(
    "Payment gateway changed",
    `ISP account #${adminId} changed its selected payment gateway to ${paymentGateway}.`,
  );
  res.json({ ok: true, paymentGateway });
});

/* ── ISP Admin shared/separate service collection routing ── */
router.get("/admin/payment-routing", async (req: Request, res: Response): Promise<void> => {
  const adminId = await paymentAdminIdFromRequest(req);
  if (!adminId) {
    res.status(400).json({ ok: false, error: "A valid adminId is required." });
    return;
  }
  if (!(await requireAdminPaymentChange(req, res, adminId))) return;
  await scrubLegacyDarajaCredentials(adminId);
  const settings = await getAdminPaymentSettings(adminId);
  const sharedConfig = settings.paymentGateway === "mpesa_till_push"
    ? settings.mpesaTillPush
    : settings.paymentGateway === "bank_stk_push"
    ? settings.bankStkPush
    : settings.paymentGateway === "bank_transfer"
    ? settings.bankTransfer
    : settings.mpesaPaybill;
  const status = publicServiceStatus(
    settings.paymentCollectionMode,
    settings.paymentGateway,
    { ...sharedConfig },
    settings.serviceConfigs,
  );
  res.json({
    ok: true,
    mode: settings.paymentCollectionMode,
    services: {
      hotspot: { gatewayId: status.hotspot.gatewayId, configured: status.hotspot.configured, config: status.hotspot.config },
      pppoe: { gatewayId: status.pppoe.gatewayId, configured: status.pppoe.configured, config: status.pppoe.config },
    },
  });
});

router.post("/admin/payment-routing", async (req: Request, res: Response): Promise<void> => {
  const adminId = await paymentChangeAdminId(req, req.body?.adminId);
  const mode = paymentCollectionMode(req.body?.mode);
  if (!adminId) {
    res.status(400).json({ ok: false, error: "A valid adminId is required." });
    return;
  }
  if (!(await requireAdminPaymentChange(req, res, adminId))) return;
  await scrubLegacyDarajaCredentials(adminId);
  if (req.body?.mode !== "shared" && req.body?.mode !== "separate") {
    res.status(400).json({ ok: false, error: "Choose shared or separate payment collection." });
    return;
  }

  const rawServices = req.body?.services;
  const serviceConfigs: Partial<Record<PaymentService, ServicePaymentConfig>> = {};
  if (mode === "separate") {
    for (const service of ["hotspot", "pppoe"] as PaymentService[]) {
      const raw = rawServices?.[service];
      const gatewayId = routingPaymentGateway(raw?.gatewayId);
      if (!raw || raw.gatewayId !== gatewayId || !PAYMENT_GATEWAY_IDS.has(gatewayId)) {
        res.status(400).json({ ok: false, error: `Choose a gateway from the available list for ${service.toUpperCase()}.` });
        return;
      }
      const config = collectionConfig(gatewayId, raw.config);
      if (CHECKOUT_READY_GATEWAY_IDS.has(gatewayId) && !isGatewayConfigComplete(gatewayId, config)) {
        res.status(400).json({ ok: false, error: `Complete the ${gatewayId.replaceAll("_", " ")} destination for ${service.toUpperCase()}.` });
        return;
      }
      serviceConfigs[service] = { gatewayId, config };
    }
  }

  const current = await sbSelect<{ payment_service_config?: unknown }>(
    "isp_admins",
    `id=eq.${adminId}&select=payment_service_config&limit=1`,
  );
  const preservedConfigs = servicePaymentConfigMap(current[0]?.payment_service_config);
  const updated = await sbUpdate("isp_admins", `id=eq.${adminId}`, {
    payment_collection_mode: mode,
    payment_service_config: mode === "separate" ? serviceConfigs : preservedConfigs,
  });
  if (updated.length === 0) {
    res.status(404).json({ ok: false, error: "ISP admin was not found or the payment routing could not be saved." });
    return;
  }
  res.json({
    ok: true,
    mode,
    services: Object.fromEntries(
      (["hotspot", "pppoe"] as PaymentService[]).map(service => {
        const selected = mode === "separate" ? serviceConfigs[service] : null;
        return [service, {
          gatewayId: selected?.gatewayId ?? getPaymentGateway(req.body?.sharedGatewayId),
          configured: selected
            ? isGatewayCheckoutReady(selected.gatewayId, selected.config)
            : true,
        }];
      }),
    ),
  });
});

/* ── ISP Admin BankStkPush configuration ── */
router.get("/admin/bank-stk-push", async (req: Request, res: Response): Promise<void> => {
  const adminId = await paymentAdminIdFromRequest(req);
  if (!adminId) {
    res.status(400).json({ ok: false, error: "A valid adminId is required." });
    return;
  }
  if (!(await requireAdminPaymentChange(req, res, adminId))) return;
  await scrubLegacyDarajaCredentials(adminId);
  const { bankStkPush } = await getAdminPaymentSettings(adminId);
  res.json({ ok: true, config: bankStkPush, configured: isBankStkPushConfigured(bankStkPush) });
});

router.post("/admin/bank-stk-push", async (req: Request, res: Response): Promise<void> => {
  const adminId = await paymentChangeAdminId(req, req.body?.adminId);
  const config: BankStkPushConfig = {
    bankName: typeof req.body?.config?.bankName === "string" ? req.body.config.bankName.trim() : "",
    paybillNumber: typeof req.body?.config?.paybillNumber === "string" ? req.body.config.paybillNumber.trim() : "",
    accountNumber: typeof req.body?.config?.accountNumber === "string" ? req.body.config.accountNumber.trim() : "",
  };

  if (!adminId) {
    res.status(400).json({ ok: false, error: "A valid adminId is required." });
    return;
  }
  if (!(await requireAdminPaymentChange(req, res, adminId))) return;
  await scrubLegacyDarajaCredentials(adminId);
  if (!isBankStkPushConfigured(config)) {
    res.status(400).json({ ok: false, error: "Select a bank and enter its PayBill Number plus Account / Business Number." });
    return;
  }

  const admins = await sbSelect<{ payment_gateway_config?: unknown }>(
    "isp_admins",
    `id=eq.${adminId}&select=payment_gateway_config&limit=1`,
  );
  if (admins.length === 0) {
    res.status(404).json({ ok: false, error: "ISP admin was not found." });
    return;
  }

  const existing = gatewayConfigMap(admins[0]?.payment_gateway_config);
  const updated = await sbUpdate(
    "isp_admins",
    `id=eq.${adminId}`,
    {
      payment_gateway_config: { ...existing, bank_stk_push: config },
      updated_at: new Date().toISOString(),
    },
  );
  if (updated.length === 0) {
    res.status(500).json({ ok: false, error: "Could not save BankStkPush settings." });
    return;
  }
  res.json({ ok: true, config, configured: true });
});

/* ── ISP Admin M-Pesa gateway destinations ── */
router.get("/admin/mpesa-gateway-config", async (req: Request, res: Response): Promise<void> => {
  const adminId = await paymentAdminIdFromRequest(req);
  if (!adminId) {
    res.status(400).json({ ok: false, error: "A valid adminId is required." });
    return;
  }
  if (!(await requireAdminPaymentChange(req, res, adminId))) return;
  await scrubLegacyDarajaCredentials(adminId);
  const { bankStkPush, mpesaTillPush, mpesaPaybill, bankTransfer } = await getAdminPaymentSettings(adminId);
  res.json({
    ok: true,
    configs: {
      bank_stk_push: bankStkPush,
      mpesa_till_push: mpesaTillPush,
      mpesa_paybill: mpesaPaybill,
      bank_transfer: bankTransfer,
    },
  });
});

router.post("/admin/mpesa-gateway-config", async (req: Request, res: Response): Promise<void> => {
  const adminId = await paymentChangeAdminId(req, req.body?.adminId);
  const gatewayId = req.body?.gatewayId;
  const rawConfig = req.body?.config;
  const allowedGatewayIds = new Set(["bank_stk_push", "mpesa_till_push", "mpesa_paybill", "bank_transfer"]);

  if (!adminId) {
    res.status(400).json({ ok: false, error: "A valid adminId is required." });
    return;
  }
  if (!(await requireAdminPaymentChange(req, res, adminId))) return;
  if (typeof gatewayId !== "string" || !allowedGatewayIds.has(gatewayId)) {
    res.status(400).json({ ok: false, error: "Unsupported payment gateway configuration." });
    return;
  }

  const input = rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
    ? rawConfig as Record<string, unknown>
    : {};
  if (isDarajaGateway(gatewayId) && hasDarajaAuthFields(input)) {
    res.status(400).json({
      ok: false,
      error: "Daraja API credentials are managed separately. Enter only the collection account details here.",
    });
    return;
  }
  await scrubLegacyDarajaCredentials(adminId);
  const config = collectionConfig(gatewayId, input);

  const isValid = gatewayId === "bank_transfer"
    ? isGatewayConfigComplete(gatewayId, config)
    : gatewayId === "bank_stk_push"
    ? !!(config.bankName && config.paybillNumber && config.accountNumber)
    : gatewayId === "mpesa_till_push"
    ? !!config.tillNumber
    : !!(config.paybillNumber && config.accountNumber);
  if (!isValid) {
    res.status(400).json({
      ok: false,
      error: gatewayId === "bank_transfer"
        ? "Enter Bank Name, Account Name, and Account Number before saving."
        : gatewayId === "mpesa_till_push"
        ? "Enter the ISP’s Till Number before saving."
        : "Enter the PayBill Number and Account / Business Number before saving.",
    });
    return;
  }

  const admins = await sbSelect<{ payment_gateway_config?: unknown; name?: string | null }>(
    "isp_admins",
    `id=eq.${adminId}&select=payment_gateway_config,name&limit=1`,
  );
  if (admins.length === 0) {
    res.status(404).json({ ok: false, error: "ISP admin was not found." });
    return;
  }

  const existing = gatewayConfigMap(admins[0]?.payment_gateway_config);
  const updated = await sbUpdate(
    "isp_admins",
    `id=eq.${adminId}`,
    {
      payment_gateway_config: { ...existing, [gatewayId]: config },
      updated_at: new Date().toISOString(),
    },
  );
  if (updated.length === 0) {
    res.status(500).json({ ok: false, error: "Could not save the M-Pesa gateway settings." });
    return;
  }
  void sendPlatformSecurityNotice(
    "Payment gateway configuration changed",
    `ISP account "${admins[0]?.name || `#${adminId}`}" saved settings for ${gatewayId}. Gateway credentials are not included in this notice.`,
  );
  res.json({ ok: true, gatewayId, config });
});

/* ── GET /api/settings/mpesa/status ── */
router.get("/settings/mpesa/status", async (_req: Request, res: Response): Promise<void> => {
  try {
    const settings = await getMpesaSettings();
    res.json({ ok: true, configured: isMpesaConfigured(settings), env: settings.env });
  } catch (error) {
    if (respondWithMpesaSettingsUnavailable(res, error)) return;
    throw error;
  }
});

/* ── POST /api/settings/mpesa ── */
router.post("/settings/mpesa", (req: Request, res: Response): void => {
  res.status(403).json({
    ok: false,
    error: "M-Pesa credentials are managed separately from this page.",
  });
});

/* ── Super Admin-only M-Pesa management ── */
router.get("/super-admin/mpesa", async (req: Request, res: Response): Promise<void> => {
  if (!isSuperAdminRequest(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return;
  }

  try {
    const s = await getMpesaSettings();
    res.json({
      ok: true,
      configured: isMpesaConfigured(s),
      settings: {
        consumerKey:    s.consumerKey    ? "**hidden**" : "",
        consumerSecret: s.consumerSecret ? "**hidden**" : "",
        shortcode:      s.shortcode,
        passkey:        s.passkey        ? "**hidden**" : "",
        callbackUrl:    automaticCallbackUrl(req) || s.callbackUrl,
        env:            s.env,
        tillNumber:     s.tillNumber,
        hasTillNumber:  !!s.tillNumber,
        hasConsumerKey:    !!s.consumerKey,
        hasConsumerSecret: !!s.consumerSecret,
        hasPasskey:        !!s.passkey,
      },
    });
  } catch (error) {
    if (respondWithMpesaSettingsUnavailable(res, error)) return;
    throw error;
  }
});

router.post("/super-admin/mpesa", async (req: Request, res: Response): Promise<void> => {
  if (!isSuperAdminRequest(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return;
  }

  const { consumerKey, consumerSecret, shortcode, passkey, callbackUrl, env, tillNumber, replacePassword } =
    req.body as Partial<MpesaSettings> & { replacePassword?: string };

  /* Read global Super Admin settings before processing masked form values. */
  let current: MpesaSettings;
  try {
    current = await getMpesaSettings();
  } catch (error) {
    if (respondWithMpesaSettingsUnavailable(res, error)) return;
    throw error;
  }
  const hasNewCredential = [consumerKey, consumerSecret, passkey].some(value =>
    typeof value === "string" && value.trim().length > 0 && value !== "**hidden**"
  );
  const changingDarajaSettings =
    hasNewCredential ||
    shortcode !== undefined ||
    callbackUrl !== undefined ||
    env !== undefined ||
    tillNumber !== undefined;
  const replacementPasscode = process.env.SUPERADMIN_PASSWORD?.trim();

  if (!replacementPasscode) {
    res.status(503).json({
      ok: false,
      error: "M-Pesa settings are temporarily unavailable. Contact support.",
    });
    return;
  }
  /* All Daraja edits are protected server-side. The passcode is never returned
     to the browser or included in logs. */
  if (changingDarajaSettings && replacePassword !== replacementPasscode) {
    res.status(401).json({
      ok: false,
      error: "Changing M-Pesa settings requires the replacement passcode.",
    });
    return;
  }

  const next: MpesaSettings = {
    consumerKey:    (consumerKey    && consumerKey    !== "**hidden**") ? consumerKey    : current.consumerKey,
    consumerSecret: (consumerSecret && consumerSecret !== "**hidden**") ? consumerSecret : current.consumerSecret,
    shortcode:      shortcode      ?? current.shortcode,
    passkey:        (passkey        && passkey        !== "**hidden**") ? passkey        : current.passkey,
    callbackUrl:    automaticCallbackUrl(req) || current.callbackUrl,
    env:            (env === "production" || env === "sandbox") ? env : current.env,
    tillNumber:     typeof tillNumber === "string" ? tillNumber.trim() : current.tillNumber,
  };
  if (next.env === "production" && !isValidLiveCallback(next.callbackUrl)) {
    res.status(400).json({
      ok: false,
      error: "Live M-Pesa requires a saved HTTPS callback URL ending in /api/mpesa/callback.",
    });
    return;
  }

  try {
    await saveMpesaSettings(next);
    if (changingDarajaSettings) {
      void sendPlatformSecurityNotice(
        "Global M-Pesa gateway settings changed",
        "Global Daraja settings were saved after successful Super Admin security re-authentication. No gateway credentials are included in this notice.",
      );
    }
    res.json({ ok: true, configured: isMpesaConfigured(next) });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "The secure settings write could not be completed.";
    console.error("[settings/mpesa] secure settings save failed", { reason });
    res.status(503).json({
      ok: false,
      error: reason,
    });
  }
});

/* ── Super Admin collection destinations ── */
router.get("/super-admin/payment-destinations", (req: Request, res: Response): void => {
  if (!isSuperAdminRequest(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return;
  }
  const settings = getPaymentDestinations();
  res.json({ ok: true, ...settings, registrationFee: { amount: settings.registrationFee, currency: "KES" } });
});

router.post("/super-admin/payment-destinations", async (req: Request, res: Response): Promise<void> => {
  if (!isSuperAdminRequest(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return;
  }
  if (!requireSuperAdminReplacementPasscode(req, res)) return;

  if (req.body?.action === "set-registration-fee") {
    const registrationFee = normaliseRegistrationFee(req.body?.registrationFee);
    if (req.body?.registrationFee !== registrationFee) {
      res.status(400).json({ ok: false, error: "Registration fee must be a whole KSh amount between 1 and 1,000,000." });
      return;
    }
    const next = { ...getPaymentDestinations(), registrationFee };
    try {
      savePaymentDestinations(next);
    } catch {
      sendPaymentSettingsWriteFailure(res);
      return;
    }
    void sendPlatformSecurityNotice(
      "Platform registration fee changed",
      "The Super Admin changed the platform registration fee.",
    );
    res.json({ ok: true, ...next, registrationFee: { amount: next.registrationFee, currency: "KES" } });
    return;
  }

  if (req.body?.action === "select") {
    const current = getPaymentDestinations();
    const registrationDestinationId = typeof req.body?.registrationDestinationId === "string"
      ? req.body.registrationDestinationId.trim()
      : "";
    const renewalDestinationId = typeof req.body?.renewalDestinationId === "string"
      ? req.body.renewalDestinationId.trim()
      : "";
    const registrationWhatsappNumber = req.body?.registrationWhatsappNumber === undefined
      ? current.registrationWhatsappNumber
      : normaliseRegistrationWhatsappNumber(req.body.registrationWhatsappNumber);
    if (!registrationWhatsappNumber) {
      res.status(400).json({ ok: false, error: "Enter a WhatsApp number in international format, such as +254798088650." });
      return;
    }
    const registrationFee = normaliseRegistrationFee(req.body?.registrationFee);
    if (req.body?.registrationFee !== undefined &&
        registrationFee !== req.body.registrationFee) {
      res.status(400).json({ ok: false, error: "Registration fee must be a whole KSh amount between 1 and 1,000,000." });
      return;
    }
    const activeIds = new Set(current.destinations.filter(row => row.active).map(row => row.id));
    if ((registrationDestinationId && !activeIds.has(registrationDestinationId)) ||
        (renewalDestinationId && !activeIds.has(renewalDestinationId))) {
      res.status(400).json({ ok: false, error: "Choose an active destination for each payment purpose." });
      return;
    }
    if (registrationDestinationId) {
      const destination = current.destinations.find(row => row.id === registrationDestinationId);
      if (destination && destination.type !== "bank") {
        const mpesa = await getMpesaSettings();
        if (!isMpesaConfigured(mpesa)) {
          res.status(400).json({ ok: false, error: "Save matching M-Pesa Daraja settings before selecting an automatic registration destination." });
          return;
        }
      }
    }
    const next = {
      ...current,
      registrationFee,
      registrationDestinationId,
      renewalDestinationId,
      registrationWhatsappNumber,
    };
    try {
      savePaymentDestinations(next);
    } catch {
      sendPaymentSettingsWriteFailure(res);
      return;
    }
    void sendPlatformSecurityNotice(
      "Platform payment destinations changed",
      "The Super Admin changed platform payment destinations, the registration fee, or registration support contact.",
    );
    res.json({ ok: true, ...next, registrationFee: { amount: next.registrationFee, currency: "KES" } });
    return;
  }

  if (req.body?.action !== "upsert") {
    res.status(400).json({ ok: false, error: "Unsupported destination action." });
    return;
  }

  const source = req.body?.destination ?? {};
  const type = source.type;
  const name = typeof source.name === "string" ? source.name.trim() : "";
  const number = typeof source.number === "string" ? source.number.trim().replace(/\s+/g, "") : "";
  const accountReference = typeof source.accountReference === "string" ? source.accountReference.trim() : "";
  const instructions = typeof source.instructions === "string" ? source.instructions.trim() : "";
  const id = typeof source.id === "string" ? source.id.trim() : "";
  if ((type !== "bank" && type !== "till" && type !== "paybill") || !name || !number) {
    res.status(400).json({ ok: false, error: "Choose a type and enter a destination name plus receiving number." });
    return;
  }
  if (!isValidCollectionNumber(type, number)) {
    res.status(400).json({
      ok: false,
      error: type === "bank"
        ? "Enter a valid bank account number."
        : "Enter a numeric PayBill or Till number between 5 and 10 digits.",
    });
    return;
  }
  if (type === "paybill" && !accountReference) {
    res.status(400).json({ ok: false, error: "PayBill destinations require an Account / Business Number." });
    return;
  }
  if (type === "bank" && (!accountReference || !instructions)) {
    res.status(400).json({
      ok: false,
      error: "Bank destinations require an account reference and payment instructions for manual registration.",
    });
    return;
  }

  let next: ReturnType<typeof upsertPaymentDestination>;
  try {
    next = upsertPaymentDestination({
      id: id || undefined,
      type: type as PaymentDestinationType,
      name,
      number,
      accountReference,
      instructions,
      active: source.active !== false,
    });
  } catch {
    sendPaymentSettingsWriteFailure(res);
    return;
  }
  void sendPlatformSecurityNotice(
    "Platform payment destination changed",
    `The Super Admin added or updated a ${type} payment destination named "${name}". Payment account details are not included in this notice.`,
  );
  res.json({ ok: true, ...next, registrationFee: { amount: next.registrationFee, currency: "KES" } });
});

router.delete("/super-admin/payment-destinations/:id", (req: Request, res: Response): void => {
  if (!isSuperAdminRequest(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return;
  }
  if (!requireSuperAdminReplacementPasscode(req, res)) return;
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ ok: false, error: "A destination is required." });
    return;
  }
  let next: ReturnType<typeof deletePaymentDestination>;
  try {
    next = deletePaymentDestination(id);
  } catch {
    sendPaymentSettingsWriteFailure(res);
    return;
  }
  void sendPlatformSecurityNotice(
    "Platform payment destination removed",
    "The Super Admin removed a platform payment destination.",
  );
  res.json({ ok: true, ...next, registrationFee: { amount: next.registrationFee, currency: "KES" } });
});

/* ── Super Admin manual bank-registration settlement ── */
interface ManualRegistrationTransaction {
  id: number;
  admin_id: number;
  amount: number | string;
  payment_phone: string | null;
  notes: string | null;
  created_at: string;
}

interface RegistrationSettlement {
  settled: boolean;
  payment_method: string | null;
  admin_id: number | null;
}

router.get("/super-admin/manual-registration-payments", async (req: Request, res: Response): Promise<void> => {
  if (!isSuperAdminRequest(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return;
  }
  const payments = await sbSelect<ManualRegistrationTransaction>(
    "isp_transactions",
    "payment_method=eq.manual_registration&status=eq.pending&select=id,admin_id,amount,payment_phone,notes,created_at&order=created_at.asc&limit=100",
  );
  res.json({ ok: true, payments });
});

router.post("/super-admin/manual-registration-payments/:id/verify", async (req: Request, res: Response): Promise<void> => {
  if (!isSuperAdminRequest(req)) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return;
  }
  if (!requireSuperAdminReplacementPasscode(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ ok: false, error: "A valid manual registration payment is required." });
    return;
  }
  const payments = await sbSelect<{ id: number }>(
    "isp_transactions",
    `id=eq.${id}&payment_method=eq.manual_registration&status=eq.pending&select=id&limit=1`,
  );
  if (!payments[0]) {
    res.status(404).json({ ok: false, error: "This manual registration payment is no longer awaiting verification." });
    return;
  }
  try {
    const settlements = await sbRpc<RegistrationSettlement>("settle_verified_mpesa_transaction", {
      p_transaction_id: id,
      p_status: "completed",
      p_note: "Manual bank registration payment verified by Super Admin.",
    });
    if (!settlements[0]?.settled || settlements[0].payment_method !== "manual_registration") {
      res.status(409).json({ ok: false, error: "This payment was already settled or could not be verified." });
      return;
    }
    if (!settlements[0].admin_id) {
      res.status(500).json({ ok: false, error: "The verified payment is not linked to an ISP registration." });
      return;
    }
    const admins = await sbSelect<{ is_active: boolean; status: string }>(
      "isp_admins",
      `id=eq.${settlements[0].admin_id}&select=is_active,status&limit=1`,
    );
    if (admins[0]?.is_active !== true || admins[0].status !== "active") {
      res.status(503).json({
        ok: false,
        error: "Payment was recorded but the ISP was not activated. Confirm the registration payments migration is applied before retrying.",
      });
      return;
    }
    void provisionTenantCertificateForAdmin(settlements[0].admin_id).catch(error => {
      console.error("[registration] immediate tenant certificate provisioning failed; timer will retry", error);
    });
    void sendRegistrationConfirmationEmail(settlements[0].admin_id);
    res.json({ ok: true, adminId: settlements[0].admin_id });
  } catch {
    res.status(503).json({ ok: false, error: "Manual payment verification is unavailable. Apply the registration payments migration, then try again." });
  }
});

export default router;
