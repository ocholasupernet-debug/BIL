export interface AdminVisibilityPage {
  key: string;
  label: string;
  description: string;
}

export interface AdminVisibilitySection {
  key: string;
  label: string;
  description: string;
  pages: AdminVisibilityPage[];
}

export const ADMIN_PAGE_VISIBILITY_CATALOG: AdminVisibilitySection[] = [
  {
    key: "overview",
    label: "Overview",
    description: "The administrator home and summary view.",
    pages: [{ key: "overview.dashboard", label: "Dashboard", description: "ISP activity and summary." }],
  },
  {
    key: "customers",
    label: "Customers",
    description: "Customer accounts, activation, vouchers, and hotspot sessions.",
    pages: [
      { key: "customers.customers", label: "Customers", description: "Customer records and status views." },
      { key: "customers.activation", label: "Activation", description: "Pending customer activations." },
      { key: "customers.vouchers", label: "Hotspot Vouchers", description: "Voucher codes and batches." },
      { key: "customers.hotspot-binding", label: "Hotspot Binding", description: "Bindings and active sessions." },
    ],
  },
  {
    key: "billing",
    label: "Billing",
    description: "Plans, transactions, invoices, and balances.",
    pages: [
      { key: "billing.plans", label: "Packages / Plans", description: "Service plans and packages." },
      { key: "billing.transactions", label: "Transactions", description: "Payments, graphs, invoices, and balances." },
    ],
  },
  {
    key: "network",
    label: "Network",
    description: "Routers, connectivity, access points, and network configuration.",
    pages: [
      { key: "network.routers", label: "Routers", description: "Connected MikroTik routers and status." },
      { key: "network.self-install", label: "Self Install", description: "Install and register a router." },
      { key: "network.self-provision", label: "Self Provision", description: "Apply service configuration to an installed router." },
      { key: "network.replace-router", label: "Replace Router", description: "Replace an existing router." },
      { key: "network.migration", label: "Migration & Recovery", description: "Migrate and recover RouterOS configurations." },
      { key: "network.pppoe", label: "PPPoE", description: "PPPoE network settings." },
      { key: "network.ppp", label: "PPP", description: "PPP profiles and sessions." },
      { key: "network.wireless", label: "Wireless", description: "Wireless settings." },
      { key: "network.queues", label: "Queues", description: "Bandwidth queues." },
      { key: "network.load-balancing", label: "Load Balancing", description: "Multi-WAN traffic distribution and failover." },
      { key: "network.ip-pools", label: "IP Pools", description: "Router IP pools." },
      { key: "network.router-api-config", label: "API Config", description: "Router API access." },
      { key: "network.files", label: "Files", description: "Router files." },
      { key: "network.bridge-ports", label: "Bridge Ports", description: "Bridge port management." },
      { key: "network.access-points", label: "Access Points", description: "Wireless access points." },
      { key: "network.pppoe-settings", label: "PPPoE Settings", description: "Global PPPoE settings." },
      { key: "network.hotspot-settings", label: "Hotspot Settings", description: "Global hotspot settings." },
    ],
  },
  {
    key: "tools",
    label: "Tools",
    description: "VPN, bulk operations, device management, and integrations.",
    pages: [
      { key: "tools.vpn", label: "VPN & Remote Access", description: "VPN services and remote access." },
      { key: "tools.bulk", label: "Bulk Actions", description: "Bulk renewals and messages." },
      { key: "tools.uisp", label: "UISP", description: "UISP devices and sites." },
      { key: "tools.bonga", label: "Bonga Points", description: "Loyalty points and redemptions." },
      { key: "tools.webhooks", label: "Webhooks", description: "Payment and system webhooks." },
      { key: "tools.acs", label: "TR069 ACS", description: "TR-069 device provisioning." },
      { key: "tools.page-builder", label: "Page Builder", description: "Custom pages." },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    description: "Support, notifications, logs, and ISP configuration.",
    pages: [
      { key: "admin.support", label: "Support Tickets", description: "Support tickets." },
      { key: "admin.notifications", label: "Notifications", description: "Notifications and expiry alerts." },
      { key: "admin.logs", label: "Logs", description: "Authentication and system logs." },
      { key: "admin.extras", label: "Extras", description: "SMS and email configuration." },
      { key: "admin.radius", label: "FreeRADIUS", description: "FreeRADIUS integration." },
      { key: "admin.settings", label: "Settings", description: "ISP settings and payments." },
      { key: "admin.pages", label: "Static Pages", description: "Static content pages." },
    ],
  },
];

export const DEFAULT_ADMIN_PAGE_VISIBILITY: Record<string, boolean> = Object.fromEntries(
  ADMIN_PAGE_VISIBILITY_CATALOG.flatMap(section => [
    [section.key, true],
    ...section.pages.map(page => [page.key, true] as const),
  ]),
);

export function isAdminFeatureVisible(
  visibility: Record<string, boolean>,
  featureKey: string,
): boolean {
  if (featureKey === "overview.dashboard") return true;
  const sectionKey = featureKey.split(".")[0];
  return visibility[sectionKey] !== false && visibility[featureKey] !== false;
}

const ROUTE_FEATURES: Array<{ prefix: string; featureKey: string }> = [
  { prefix: "/admin/network/migration", featureKey: "network.migration" },
  { prefix: "/admin/network/replace-router", featureKey: "network.replace-router" },
  { prefix: "/admin/network/add-router", featureKey: "network.self-install" },
  { prefix: "/admin/network/self-install", featureKey: "network.self-install" },
  { prefix: "/admin/network/self-provision", featureKey: "network.self-provision" },
  { prefix: "/admin/network/router-api-config", featureKey: "network.router-api-config" },
  { prefix: "/admin/network/ip-pools", featureKey: "network.ip-pools" },
  { prefix: "/admin/network/ippool", featureKey: "network.ip-pools" },
  { prefix: "/admin/network/bridge-ports", featureKey: "network.bridge-ports" },
  { prefix: "/admin/network/routers", featureKey: "network.routers" },
  { prefix: "/admin/network/pppoe", featureKey: "network.pppoe" },
  { prefix: "/admin/network/queues", featureKey: "network.queues" },
  { prefix: "/admin/network/load-balancing", featureKey: "network.load-balancing" },
  { prefix: "/admin/network/wireless", featureKey: "network.wireless" },
  { prefix: "/admin/network/ppp", featureKey: "network.ppp" },
  { prefix: "/admin/network/files", featureKey: "network.files" },
  { prefix: "/admin/network", featureKey: "network.routers" },
  { prefix: "/admin/access-points", featureKey: "network.access-points" },
  { prefix: "/admin/pppoe-settings", featureKey: "network.pppoe-settings" },
  { prefix: "/admin/hotspot-settings", featureKey: "network.hotspot-settings" },
  { prefix: "/admin/vpn", featureKey: "tools.vpn" },
  { prefix: "/admin/bulk", featureKey: "tools.bulk" },
  { prefix: "/admin/uisp", featureKey: "tools.uisp" },
  { prefix: "/admin/bonga", featureKey: "tools.bonga" },
  { prefix: "/admin/webhooks", featureKey: "tools.webhooks" },
  { prefix: "/admin/acs", featureKey: "tools.acs" },
  { prefix: "/admin/page-builder", featureKey: "tools.page-builder" },
  { prefix: "/admin/plans", featureKey: "billing.plans" },
  { prefix: "/admin/transactions", featureKey: "billing.transactions" },
  { prefix: "/admin/invoices", featureKey: "billing.transactions" },
  { prefix: "/admin/balance", featureKey: "billing.transactions" },
  { prefix: "/admin/vouchers", featureKey: "customers.vouchers" },
  { prefix: "/admin/hotspot-binding", featureKey: "customers.hotspot-binding" },
  { prefix: "/admin/activation", featureKey: "customers.activation" },
  { prefix: "/admin/customers", featureKey: "customers.customers" },
  { prefix: "/admin/support", featureKey: "admin.support" },
  { prefix: "/admin/notifications", featureKey: "admin.notifications" },
  { prefix: "/admin/message-templates", featureKey: "admin.notifications" },
  { prefix: "/admin/logs", featureKey: "admin.logs" },
  { prefix: "/admin/extras", featureKey: "admin.extras" },
  { prefix: "/admin/radius", featureKey: "admin.radius" },
  { prefix: "/admin/settings", featureKey: "admin.settings" },
  { prefix: "/admin/pages", featureKey: "admin.pages" },
  { prefix: "/admin/dashboard", featureKey: "overview.dashboard" },
];

export function getAdminFeatureKeyForPath(pathname: string): string | null {
  return ROUTE_FEATURES.find(route => pathname === route.prefix || pathname.startsWith(`${route.prefix}/`) || pathname.startsWith(`${route.prefix}?`))?.featureKey ?? null;
}