type VisualPage = "admin-dashboard" | "reseller-dashboard" | "storage";

const now = Date.now();
const day = 86_400_000;

function monthsAgo(months: number, dayOfMonth = 12): string {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - months);
  date.setDate(dayOfMonth);
  date.setHours(9, 30, 0, 0);
  return date.toISOString();
}

const customers = [
  { id: 701, type: "hotspot", status: "active", created_at: monthsAgo(0, 8), expires_at: new Date(now + 10 * day).toISOString() },
  { id: 702, type: "pppoe", status: "active", created_at: monthsAgo(1, 14), expires_at: new Date(now + 40 * day).toISOString() },
  { id: 703, type: "static", status: "expired", created_at: monthsAgo(2, 17), expires_at: new Date(now - 3 * day).toISOString() },
  { id: 704, type: "hotspot", status: "active", created_at: monthsAgo(0, 20), expires_at: new Date(now + 18 * day).toISOString() },
];

const routers = [
  {
    id: 41,
    name: "North Edge",
    host: "10.8.5.2",
    status: "online",
    last_seen: new Date(now - 2 * 60_000).toISOString(),
    model: "MikroTik RB5009",
    ros_version: "7.16",
  },
  {
    id: 42,
    name: "West Relay",
    host: "10.8.5.3",
    status: "offline",
    last_seen: new Date(now - 3 * 60 * 60_000).toISOString(),
    model: "MikroTik hEX S",
    ros_version: "7.14",
  },
];

const telemetry = {
  totals: { hotspotActive: 12, pppoeActive: 8, onlineUsers: 20 },
  rows: [
    {
      portId: 61, routerId: 41, interfaceName: "ether3-North", resellerId: 91,
      hotspotActive: 12, pppoeActive: 8, onlineUsers: 20, routerAvailable: true, routerError: null,
    },
    {
      portId: 62, routerId: 42, interfaceName: "ether4-West", resellerId: null,
      hotspotActive: 0, pppoeActive: 0, onlineUsers: 0, routerAvailable: false, routerError: "Recent RouterOS heartbeat unavailable.",
    },
  ],
  filters: {
    routers: routers.map(({ id, name, status }) => ({ id, name, status })),
    ports: routers.map((router, index) => ({
      id: 61 + index, routerId: router.id, interfaceName: index === 0 ? "ether3-North" : "ether4-West",
    })),
    resellers: [{ id: 91, name: "Northside Networks" }],
  },
  fetchedAt: new Date(now).toISOString(),
};

const resellerMetrics = {
  revenue: { incomeToday: 18_450, incomeMonth: 284_300, totalRevenue: 1_208_750, totalTransactions: 436 },
  users: { total: 128, active: 113, expired: 15, hotspot: 82, pppoe: 37, static: 9 },
  analytics: {
    registeredCustomersByMonth: [
      { month: "Apr", label: "April", count: 12 },
      { month: "May", label: "May", count: 18 },
      { month: "Jun", label: "June", count: 15 },
      { month: "Jul", label: "July", count: 24 },
      { month: "Aug", label: "August", count: 29 },
      { month: "Sep", label: "September", count: 30 },
    ],
    consumptionByMonth: [
      { month: "Apr", label: "April", dataUsedMb: 1840 },
      { month: "May", label: "May", dataUsedMb: 2210 },
      { month: "Jun", label: "June", dataUsedMb: 1980 },
      { month: "Jul", label: "July", dataUsedMb: 2760 },
      { month: "Aug", label: "August", dataUsedMb: 3140 },
      { month: "Sep", label: "September", dataUsedMb: 2980 },
    ],
    topConsumers: [
      { id: 1, name: "Amina K.", type: "PPPoE", dataUsedMb: 18_600 },
      { id: 2, name: "Peter O.", type: "Hotspot", dataUsedMb: 14_250 },
      { id: 3, name: "Grace M.", type: "PPPoE", dataUsedMb: 12_980 },
      { id: 4, name: "Sam W.", type: "Hotspot", dataUsedMb: 10_400 },
      { id: 5, name: "Njeri T.", type: "Static", dataUsedMb: 8_750 },
    ],
  },
};

const resellerDashboard = {
  ok: true,
  account: { name: "Northside Networks", company_name: "Northside Networks", username: "northside" },
  ports: [
    {
      id: 61, reseller_id: 91, router_id: 41, interface_name: "ether3-North", bridge_name: "br-north",
      assigned_reseller_id: 91, vlan_tag: "240", hotspot_enabled: true, pppoe_enabled: true,
      subnet_range: "10.240.0.0/24", bandwidth_cap_mbps: 80, reseller_bandwidth_cap: 60,
      status: "active", link_status: "active", handoff_mode: "vlan_services", handoff_type: "vlan",
      handoff_interface: "sfp-sfpplus1", vlan_ingress_mode: "tagged", xpon_identifier: null,
      link_detected: true, last_link_checked_at: new Date(now - 60_000).toISOString(),
      link_detection_error: null, provisioning_error: null, link_provisioning_error: null,
      router: { id: 41, name: "North Edge", status: "online" },
    },
  ],
  gateways: [{ gateway_type: "mpesa_paybill", is_active: true }],
  sales: [
    { id: 501, reseller_port_id: 61, client_reference: "Amina K.", client_ip: "10.240.0.18", amount: 1500, gateway_type: "M-Pesa", payment_reference: "QX72P0", status: "completed", created_at: new Date(now - 18 * 60_000).toISOString() },
    { id: 502, reseller_port_id: 61, client_reference: "Peter O.", client_ip: "10.240.0.26", amount: 800, gateway_type: "M-Pesa", payment_reference: "QX72P1", status: "completed", created_at: new Date(now - 56 * 60_000).toISOString() },
  ],
  metrics: resellerMetrics,
};

const measuredAt = new Date(now - 5 * 60_000).toISOString();
const physicalSources = [
  {
    source: "supabase_postgres", status: "available", measurementKind: "Database size",
    usedBytes: 1_342_177_280, capacityBytes: null, freeBytes: null, measuredAt, error: null,
    details: { path: "database", buckets: [] },
  },
  {
    source: "supabase_storage", status: "available", measurementKind: "Stored object size",
    usedBytes: 734_003_200, capacityBytes: null, freeBytes: null, measuredAt, error: null,
    details: {
      buckets: [
        { bucket: "router-backups", status: "available", usedBytes: 512_000_000, objectCount: 48, measuredAt, error: null },
        { bucket: "branding", status: "available", usedBytes: 222_003_200, objectCount: 126, measuredAt, error: null },
      ],
    },
  },
  {
    source: "vps_filesystem", status: "partial", measurementKind: "Managed application files",
    usedBytes: 3_221_225_472, capacityBytes: 128 * 1024 ** 3, freeBytes: 82 * 1024 ** 3,
    measuredAt, error: null, details: { path: "/srv/ochola", buckets: [] },
  },
];

function physicalHistory(source: string, currentBytes: number) {
  return [7, 3, 0].map((daysAgo, index) => ({
    source,
    status: source === "vps_filesystem" && index === 1 ? "stale" : "available",
    measurementKind: "Fixture measurement",
    usedBytes: currentBytes - (2 - index) * 18_000_000,
    capacityBytes: null,
    freeBytes: null,
    measuredAt: new Date(now - daysAgo * day).toISOString(),
    error: null,
    details: { buckets: [] },
    capturedAt: new Date(now - daysAgo * day).toISOString(),
  }));
}

const storage = {
  ok: true,
  measuredAt,
  capacityBytes: 180 * 1024 ** 3,
  totalUsedBytes: 129 * 1024 ** 3,
  freeBytes: 51 * 1024 ** 3,
  usagePercent: 71.7,
  capacityWarning: {
    state: "monitoring", active: false, thresholdPercent: 80, usagePercent: 71.7,
    lastNotifiedAt: null, recoveredAt: null, notifications: [],
  },
  capacity: { bytes: 180 * 1024 ** 3, source: "Configured platform budget", measuredAt },
  freeSpace: { bytes: 51 * 1024 ** 3, source: "Configured platform budget", measuredAt },
  measurement: {
    kind: "measured_storage_and_tenant_rows",
    retentionDays: 90,
    notes: ["Physical storage is reported independently from tenant row-payload estimates.", "Fixture data is local to the visual harness."],
    tenantRowPayload: {
      source: "Supabase Postgres estimates", status: "available", usedBytes: 129 * 1024 ** 3,
      measuredAt, error: null,
    },
    freshness: { collectionIntervalMinutes: 15, staleAfterMinutes: 60, checkedAt: measuredAt },
    physicalSources,
  },
  history: {
    windowDays: 30,
    physical: [
      ...physicalHistory("supabase_postgres", 1_342_177_280),
      ...physicalHistory("supabase_storage", 734_003_200),
      ...physicalHistory("vps_filesystem", 3_221_225_472),
    ],
    tenant: [7, 3, 0].map((daysAgo, index) => ({
      status: "available",
      usedBytes: (124 + index * 2) * 1024 ** 3,
      rowCount: 245_000 + index * 3_000,
      measuredAt: new Date(now - daysAgo * day).toISOString(),
      capturedAt: new Date(now - daysAgo * day).toISOString(),
      error: null,
    })),
  },
  forecast: {
    status: "available", source: "tenant_row_estimate", validPoints: 3,
    trendBytesPerDay: 684_000_000,
    projectedFullAt: new Date(now + 75 * day).toISOString(),
    reason: "Projected from recent tenant row-estimate samples.",
  },
  usage: [
    { id: 5, name: "Northside Networks", username: "northside", email: "ops@northside.example", is_active: true, bytes: 1_250_000_000, rowCount: 18_420, breakdown: { customers: { bytes: 980_000_000, rows: 12_400 }, transactions: { bytes: 270_000_000, rows: 6_020 } } },
    { id: 6, name: "Coastlink ISP", username: "coastlink", email: "admin@coastlink.example", is_active: true, bytes: 845_000_000, rowCount: 9_810, breakdown: { customers: { bytes: 660_000_000, rows: 6_500 }, transactions: { bytes: 185_000_000, rows: 3_310 } } },
  ],
  candidates: [
    { id: 301, admin_id: 5, source_label: "Completed network migration", status: "eligible", created_at: new Date(now - 110 * day).toISOString(), completed_at: new Date(now - 105 * day).toISOString(), bytes: 84_000_000, rowCount: 240 },
    { id: 302, admin_id: 5, source_label: "Archived router import", status: "eligible", created_at: new Date(now - 130 * day).toISOString(), completed_at: new Date(now - 125 * day).toISOString(), bytes: 42_000_000, rowCount: 116 },
  ],
  requests: [
    {
      id: 901, admin_id: 5, scope: "migration_artifacts", reason: "Remove aged import artifacts after review.",
      requested_by: "Platform admin", scheduled_for: new Date(now + 4 * day).toISOString(),
      candidate_bytes: 84_000_000, candidate_rows: 240, status: "pending", completed_at: null,
      failure_details: null, created_at: new Date(now - day).toISOString(),
    },
    {
      id: 902, admin_id: 6, scope: "migration_artifacts", reason: "Old migration cleanup completed.",
      requested_by: "Platform admin", scheduled_for: new Date(now - 8 * day).toISOString(),
      candidate_bytes: 12_000_000, candidate_rows: 42, status: "completed", completed_at: measuredAt,
      failure_details: null, created_at: new Date(now - 9 * day).toISOString(),
    },
  ],
};

const adminPreferences = {
  preferences: {
    accentColor: "#2563eb",
    hideAmounts: false,
    layout: "standard",
    density: "comfortable",
    shape: "rounded",
  },
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function createVisualFixtureFetch(page: VisualPage): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
    const method = (init?.method || (typeof input === "object" && !(input instanceof URL) ? input.method : "GET")).toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return jsonResponse({ ok: false, error: "Writes are disabled in the local visual fixture." }, 405);
    }

    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.split("/").pop();
      if (table === "isp_routers") return jsonResponse(routers);
      if (table === "isp_customers") return jsonResponse(customers);
      if (table === "isp_transactions") {
        return jsonResponse([
          { id: 8801, customer_id: 701, reference: "VIS-501", amount: 1500, payment_method: "mpesa", status: "completed", created_at: new Date(now - 21 * 60_000).toISOString() },
          { id: 8802, customer_id: 702, reference: "VIS-502", amount: 800, payment_method: "mpesa", status: "completed", created_at: new Date(now - 74 * 60_000).toISOString() },
        ]);
      }
      if (table === "isp_admins") {
        return jsonResponse({
          id: 5, name: "Ochola Network", fullname: "Ochola Network", username: "ochola",
          email: "admin@ochola.example", phone: "+254700000000", area: "Kenya",
          subdomain: "ochola.example", currency: "KES",
        });
      }
      return jsonResponse([]);
    }

    if (url.pathname === "/api/admin/dashboard-preferences") return jsonResponse(adminPreferences);
    if (url.pathname === "/api/admin/page-visibility") return jsonResponse({ visibility: {} });
    if (url.pathname === "/api/public/typography") return jsonResponse({});
    if (url.pathname === "/api/billing/revenue-summary") {
      return jsonResponse({ incomeToday: 28_450, incomeMonth: 486_300, totalRevenue: 2_108_750, totalTransactions: 1_236 });
    }
    if (url.pathname === "/api/admin/dashboard/reseller-summary") {
      return jsonResponse({ activeResellers: 7, onlineResellers: 5, totalResellers: 9 });
    }
    if (url.pathname === "/api/admin/dashboard/telemetry") return jsonResponse(telemetry);
    if (url.pathname === "/api/settings/mpesa") return jsonResponse({ settings: { paymentGateway: "mpesa_paybill" } });
    if (url.pathname === "/api/router/41/live") {
      return jsonResponse({ hotspotUsers: Array.from({ length: 12 }), pppoeUsers: Array.from({ length: 8 }), onlineVlanUsers: 6 });
    }
    if (url.pathname === "/api/router/42/live") {
      return jsonResponse({ hotspotUsers: [], pppoeUsers: [], onlineVlanUsers: 0 });
    }
    if (url.pathname === "/api/reseller/me") return jsonResponse(resellerDashboard);
    if (url.pathname === "/api/reseller/payment-gateways") {
      return jsonResponse({
        ok: true,
        routes: [{ gatewayType: "mpesa_paybill", routerId: 41, portId: 61, scopeType: "port", isActive: true }],
      });
    }
    if (url.pathname === "/api/plans/admin-context") {
      return jsonResponse({ plans: [
        { id: 31, name: "Home 10 Mbps", type: "pppoe", port_id: 61, router_id: 41, price: 1500, validity: 30, validity_unit: "days" },
        { id: 32, name: "Daily Wi-Fi", type: "hotspot", port_id: 61, router_id: 41, price: 80, validity: 1, validity_unit: "days" },
      ] });
    }
    if (url.pathname === "/api/super-admin/verify") return jsonResponse({ ok: true, remainingMs: 2 * 60 * 60_000 });
    if (url.pathname === "/api/super-admin/storage") return jsonResponse(storage);
    if (url.pathname.startsWith("/api/")) return jsonResponse({ ok: true, notifications: [], unreadCount: 0, count: 0, rows: [], items: [] });

    if (page === "storage" && url.pathname === "/favicon.ico") return new Response(null, { status: 204 });
    return jsonResponse({ error: `No visual fixture registered for ${url.pathname}` }, 404);
  };
}