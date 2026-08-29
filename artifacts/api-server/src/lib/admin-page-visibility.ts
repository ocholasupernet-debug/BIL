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

/**
 * This is the platform-wide catalog. Keep these keys stable because they are
 * persisted in Supabase and consumed by both admin-panel layouts.
 */
export const ADMIN_PAGE_VISIBILITY_CATALOG: AdminVisibilitySection[] = [
  {
    key: "overview",
    label: "Overview",
    description: "The administrator home and summary view.",
    pages: [
      { key: "overview.dashboard", label: "Dashboard", description: "ISP activity, customers, payments, and router summary." },
    ],
  },
  {
    key: "customers",
    label: "Customers",
    description: "Customer accounts, activation, vouchers, and hotspot sessions.",
    pages: [
      { key: "customers.customers", label: "Customers", description: "All customer records and customer status views." },
      { key: "customers.activation", label: "Activation", description: "Review and approve pending customer activations." },
      { key: "customers.vouchers", label: "Hotspot Vouchers", description: "Manage voucher codes and voucher batches." },
      { key: "customers.hotspot-binding", label: "Hotspot Binding", description: "Manage bindings and active hotspot sessions." },
    ],
  },
  {
    key: "billing",
    label: "Billing",
    description: "Plans, transactions, invoices, and balances.",
    pages: [
      { key: "billing.plans", label: "Packages / Plans", description: "Manage hotspot, PPPoE, static, and bandwidth plans." },
      { key: "billing.transactions", label: "Transactions", description: "Review payments, graphs, invoices, and balances." },
    ],
  },
  {
    key: "network",
    label: "Network",
    description: "Routers, connectivity, access points, and network configuration.",
    pages: [
      { key: "network.routers", label: "Routers", description: "Connected MikroTik routers and router status." },
      { key: "network.self-install", label: "Self Install", description: "Install and register a new router." },
      { key: "network.replace-router", label: "Replace Router", description: "Replace an existing router while preserving its setup." },
      { key: "network.migration", label: "Migration & Recovery", description: "Migrate and recover RouterOS configurations." },
      { key: "network.pppoe", label: "PPPoE", description: "Configure PPPoE network settings." },
      { key: "network.ppp", label: "PPP", description: "Manage PPP profiles and sessions." },
      { key: "network.wireless", label: "Wireless", description: "Manage wireless settings." },
      { key: "network.queues", label: "Queues", description: "Manage bandwidth queues." },
      { key: "network.load-balancing", label: "Load Balancing", description: "Manage multi-WAN traffic distribution and failover." },
      { key: "network.ip-pools", label: "IP Pools", description: "Manage router IP pools." },
      { key: "network.router-api-config", label: "API Config", description: "Configure router API access." },
      { key: "network.files", label: "Files", description: "Inspect and deploy router files." },
      { key: "network.bridge-ports", label: "Bridge Ports", description: "Manage bridge ports." },
      { key: "network.access-points", label: "Access Points", description: "Manage wireless access points." },
      { key: "network.pppoe-settings", label: "PPPoE Settings", description: "Manage global PPPoE settings." },
      { key: "network.hotspot-settings", label: "Hotspot Settings", description: "Manage global hotspot settings." },
    ],
  },
  {
    key: "tools",
    label: "Tools",
    description: "VPN, bulk operations, device management, and integrations.",
    pages: [
      { key: "tools.vpn", label: "VPN & Remote Access", description: "Manage VPN services, users, and remote access." },
      { key: "tools.bulk", label: "Bulk Actions", description: "Renew customers and send bulk messages." },
      { key: "tools.uisp", label: "UISP", description: "Manage UISP devices and sites." },
      { key: "tools.bonga", label: "Bonga Points", description: "Manage loyalty points and redemptions." },
      { key: "tools.webhooks", label: "Webhooks", description: "Configure payment and system webhooks." },
      { key: "tools.acs", label: "TR069 ACS", description: "Manage TR-069 device provisioning." },
      { key: "tools.page-builder", label: "Page Builder", description: "Manage custom pages." },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    description: "Support, notifications, logs, and ISP configuration.",
    pages: [
      { key: "admin.support", label: "Support Tickets", description: "Manage support tickets." },
      { key: "admin.notifications", label: "Notifications", description: "Manage notifications and expiry alerts." },
      { key: "admin.logs", label: "Logs", description: "Review authentication and system logs." },
      { key: "admin.extras", label: "Extras", description: "Manage SMS and email configuration." },
      { key: "admin.radius", label: "FreeRADIUS", description: "Manage FreeRADIUS integration." },
      { key: "admin.settings", label: "Settings", description: "Manage ISP settings and payment configuration." },
      { key: "admin.pages", label: "Static Pages", description: "Manage static content pages." },
    ],
  },
];

export const ADMIN_PAGE_VISIBILITY_KEYS = new Set(
  ADMIN_PAGE_VISIBILITY_CATALOG.flatMap(section => [section.key, ...section.pages.map(page => page.key)]),
);

export const DEFAULT_ADMIN_PAGE_VISIBILITY: Record<string, boolean> = Object.fromEntries(
  ADMIN_PAGE_VISIBILITY_CATALOG.flatMap(section => [
    [section.key, true],
    ...section.pages.map(page => [page.key, true] as const),
  ]),
);