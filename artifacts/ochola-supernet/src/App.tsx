import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { lazy, Suspense, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/context/ThemeContext";
import { BrandProvider } from "@/context/BrandContext";
import { TypographyProvider } from "@/context/TypographyContext";
import { AdminPageVisibilityProvider } from "@/context/AdminPageVisibilityContext";
import { DashboardPreferencesProvider } from "@/context/DashboardPreferencesContext";
import { getHostSubdomain } from "@/lib/subdomain";
import { getAdminApiToken, getAdminRole, isImpersonating } from "@/lib/supabase";

const LandingPage = lazy(() => import("./pages/LandingPage"));
const AdminLogin = lazy(() => import("./pages/admin/AdminLogin"));
const AdminDashboard = lazy(() => import("./pages/admin/Dashboard"));
const AdminCustomers = lazy(() => import("./pages/admin/Customers"));
const NetworkRouters = lazy(() => import("./pages/admin/network/Routers"));
const NetworkQueues = lazy(() => import("./pages/admin/network/Queues"));
const NetworkIPPool = lazy(() => import("./pages/admin/network/IPPool"));
const NetworkReplaceRouter = lazy(() => import("./pages/admin/network/ReplaceRouter"));
const NetworkSelfInstall = lazy(() => import("./pages/admin/network/SelfInstall"));
const NetworkFiles = lazy(() => import("./pages/admin/network/Files"));
const NetworkBridgePorts = lazy(() => import("./pages/admin/network/BridgePorts"));
const NetworkWireless = lazy(() => import("./pages/admin/network/Wireless"));
const NetworkPPP = lazy(() => import("./pages/admin/network/PPP"));
const RouterAPIConfig = lazy(() => import("./pages/admin/network/RouterAPIConfig"));
const Multiport = lazy(() => import("./pages/admin/network/Multiport"));
const NetworkMigration = lazy(() => import("./pages/admin/network/Migration"));
const Webhooks = lazy(() => import("./pages/admin/Webhooks"));
const ActivityLogs = lazy(() => import("./pages/admin/ActivityLogs"));
const AdminPlans = lazy(() => import("./pages/admin/Plans"));
const AdminHotspotRoaming = lazy(() => import("./pages/admin/HotspotRoaming"));
const LoyaltyPoints = lazy(() => import("./pages/admin/LoyaltyPoints"));
const AdminTransactions = lazy(() => import("./pages/admin/Transactions"));
const PaidHotspotRecovery = lazy(() => import("./pages/admin/PaidHotspotRecovery"));
const TransactionGraphs = lazy(() => import("./pages/admin/TransactionGraphs"));
const HotspotSettings = lazy(() => import("./pages/admin/HotspotSettings"));
const PPPoESettings = lazy(() => import("./pages/admin/PPPoESettings"));
const PPPoESetup = lazy(() => import("./pages/admin/PPPoESetup"));
const AdminVouchers = lazy(() => import("./pages/admin/Vouchers"));
const HotspotBinding = lazy(() => import("./pages/admin/HotspotBinding"));
const PrepaidUsers = lazy(() => import("./pages/admin/PrepaidUsers"));
const HotspotLogin = lazy(() => import("./pages/portal/HotspotLogin"));
const HotspotTroubleshootPage = lazy(() =>
  import("./pages/portal/HotspotLogin").then(module => ({ default: module.HotspotTroubleshootPage })),
);
const PPPoELogin = lazy(() => import("./pages/portal/PPPoELogin"));
const SuperAdminLogin = lazy(() => import("./pages/super-admin/Login"));
const SuperAdminDashboard = lazy(() => import("./pages/super-admin/Dashboard"));
const SuperAdminAdmins = lazy(() => import("./pages/super-admin/Admins"));
const SuperAdminRoles = lazy(() => import("./pages/super-admin/Roles"));
const SuperAdminSystemSettings = lazy(() => import("./pages/super-admin/SystemSettings"));
const SuperAdminPaymentGateways = lazy(() => import("./pages/super-admin/PaymentGateways"));
const SuperAdminPaymentsPackages = lazy(() => import("./pages/super-admin/PaymentsPackages"));
const SuperAdminRouters = lazy(() => import("./pages/super-admin/Routers"));
const SuperAdminBillingEngine = lazy(() => import("./pages/super-admin/BillingEngine"));
const SuperAdminReports = lazy(() => import("./pages/super-admin/Reports"));
const SuperAdminSecurityLogs = lazy(() => import("./pages/super-admin/SecurityLogs"));
const SuperAdminNotifications = lazy(() => import("./pages/super-admin/Notifications"));
const SuperAdminAutomation = lazy(() => import("./pages/super-admin/Automation"));
const SuperAdminBackups = lazy(() => import("./pages/super-admin/Backups"));
const SuperAdminApiIntegrations = lazy(() => import("./pages/super-admin/ApiIntegrations"));
const SuperAdminWhatsApp = lazy(() => import("./pages/super-admin/WhatsApp"));
const SuperAdminSMS = lazy(() => import("./pages/super-admin/SMS"));
const SuperAdminSystemLimits = lazy(() => import("./pages/super-admin/SystemLimits"));
const SuperAdminImpersonate = lazy(() => import("./pages/super-admin/Impersonate"));
const SuperAdminAuthSecurity = lazy(() => import("./pages/super-admin/AuthSecurity"));
const SuperAdminStorage = lazy(() => import("./pages/super-admin/Storage"));
const VpnDashboard = lazy(() => import("./pages/vpn/VpnDashboard"));
const VpnRemoteAccess = lazy(() => import("./pages/vpn/RemoteAccess"));
const VpnList = lazy(() => import("./pages/vpn/VpnList"));
const VpnCreate = lazy(() => import("./pages/vpn/CreateVpn"));
const VpnTutorials = lazy(() => import("./pages/vpn/VideoTutorials"));
const VpnSettings = lazy(() => import("./pages/vpn/Settings"));
const VpnManagement = lazy(() => import("./pages/vpn/VpnManagement"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings"));
const AdminInvoices = lazy(() => import("./pages/admin/Invoices"));
const AdminCustomerBalance = lazy(() => import("./pages/admin/CustomerBalance"));
const AdminMessageTemplates = lazy(() => import("./pages/admin/MessageTemplates"));
const PlatformNotifications = lazy(() => import("./pages/admin/PlatformNotifications"));
const AdminSetPassword = lazy(() => import("./pages/admin/AdminSetPassword"));
const ResellerWorkspace = lazy(() => import("./pages/admin/ResellerWorkspace"));
const CarrierControls = lazy(() => import("./pages/admin/network/CarrierControls"));
const ResellerConnector = lazy(() => import("./pages/admin/network/ResellerConnector"));
const NetworkLoadBalancing = lazy(() => import("./pages/admin/network/LoadBalancing"));
const AdminRegister = lazy(() => import("./pages/admin/AdminRegister"));
const VisualCheckHarness = lazy(() => import("./visual/VisualCheckHarness"));

function RoleAwareDashboard() {
  return getAdminRole() === "reseller" ? <ResellerWorkspace /> : <AdminDashboard />;
}

function ResellerBlockedPage() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation("/admin/dashboard"); }, [setLocation]);
  return null;
}

/* ── SubdomainGuard ──────────────────────────────────────────────
   When the visitor arrives at a company subdomain (e.g. fastnet.isplatty.org),
   the root "/" path redirects straight to that company's login page.
   The reserved registration host has its own public entry point.
   On the bare domain (isplatty.org) the normal landing page is shown.
──────────────────────────────────────────────────────────────── */
function SubdomainGuard() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    const sub = getHostSubdomain();
    if (sub && sub !== "register" && sub !== "latex") {
      setLocation("/admin/login");
    }
  }, [setLocation]);

  /* Render platform entry points directly so they never flash blank. */
  const sub = getHostSubdomain();
   if (sub === "register") return <AdminRegister />;
  if (sub === "latex") return <SuperAdminLogin />;
  if (sub) return null;

  return <LandingPage />;
}

// Minimal stub for non-critical pages requested to save space
function StubPage({ title }: { title: string }) {
  return <div className="p-8 text-white"><h1 className="text-2xl font-bold">{title}</h1><p>Module wired and loading...</p></div>;
}

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#080c10]">
      <div className="text-center space-y-4">
        <h1 className="text-6xl font-black text-blue-500">404</h1>
        <p className="text-xl text-slate-300">Page not found</p>
        <button onClick={() => window.history.back()} className="px-6 py-2 bg-white/10 rounded-lg text-white font-semibold">Go Back</button>
      </div>
    </div>
  );
}

const queryClient = new QueryClient();

function TenantRenewalRouteGate({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const role = getAdminRole();
  const token = getAdminApiToken();
  const [billingState, setBillingState] = useState<{ token: string; checked: boolean; restricted: boolean }>({
    token: "",
    checked: false,
    restricted: false,
  });
  const route = location.split("?")[0];
  const isAdminRoute = route.startsWith("/admin/")
    && !["/admin/login", "/admin/register", "/admin/set-password"].includes(route);
  const isDashboard = route === "/admin/dashboard";
  const isExempt = role === "superadmin" || isImpersonating() || !token;

  useEffect(() => {
    if (!isAdminRoute || isExempt) {
      setBillingState({ token, checked: true, restricted: false });
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/billing/current", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = response.ok
          ? await response.json() as { accessRestricted?: boolean }
          : { accessRestricted: false };
        if (!cancelled) setBillingState({ token, checked: true, restricted: data.accessRestricted === true });
      } catch {
        if (!cancelled) setBillingState({ token, checked: true, restricted: false });
      }
    };
    void load();
    const refresh = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(refresh);
    };
  }, [isAdminRoute, isExempt, location, role, token]);

  const currentState = billingState.token === token ? billingState : null;
  const routeRestricted = isAdminRoute && !isDashboard && !isExempt && currentState?.restricted === true;

  useEffect(() => {
    if (routeRestricted) setLocation("/admin/dashboard");
  }, [routeRestricted, setLocation]);

  if (isAdminRoute && !isDashboard && !isExempt && !currentState?.checked) {
    return <div role="status" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>Checking account renewal…</div>;
  }
  if (routeRestricted) return null;
  return <>{children}</>;
}

function Router() {
  return (
    <TenantRenewalRouteGate>
    <Suspense fallback={<div role="status" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>Loading page…</div>}>
    <Switch>
      {import.meta.env.DEV && <Route path="/__visual/:page" component={VisualCheckHarness} />}
      <Route path="/" component={SubdomainGuard} />
      <Route path="/admin/login" component={AdminLogin} />
      <Route path="/admin/dashboard" component={RoleAwareDashboard} />
      <Route path="/admin/reseller" component={ResellerWorkspace} />
      <Route path="/admin/resellers" component={ResellerWorkspace} />
      <Route path="/admin/network/resellers" component={ResellerWorkspace} />
      <Route path="/admin/reseller/connector" component={ResellerConnector} />
      <Route path="/admin/network/carrier-controls" component={CarrierControls} />
      <Route path="/admin/carrier-controls" component={CarrierControls} />
       <Route path="/admin/network/load-balancing" component={getAdminRole() === "reseller" ? ResellerBlockedPage : NetworkLoadBalancing} />
      <Route path="/admin/customers" component={AdminCustomers} />
      <Route path="/admin/network" component={NetworkRouters} />
      <Route path="/admin/network/routers"        component={NetworkRouters}       />
      <Route path="/admin/network/queues"         component={NetworkQueues}        />
      <Route path="/admin/network/ip-pools"       component={NetworkIPPool}        />
      <Route path="/admin/network/bridge-ports"   component={NetworkBridgePorts}   />
      <Route path="/admin/network/wireless"       component={NetworkWireless}      />
      <Route path="/admin/network/ppp"            component={NetworkPPP}           />
      <Route path="/admin/network/router-api-config" component={RouterAPIConfig}  />
      <Route path="/admin/network/api-config"      component={RouterAPIConfig}  />
      <Route path="/admin/network/multiport"       component={Multiport}        />
      <Route path="/admin/multiport"               component={Multiport}        />
      <Route path="/admin/network/migration"      component={NetworkMigration}  />
      {/* Legacy redirects — keep old paths working */}
      <Route path="/admin/network/ippool"         component={NetworkIPPool}        />
      <Route path="/admin/network/replace-router" component={NetworkReplaceRouter} />
       <Route path="/admin/network/self-install" component={getAdminRole() === "reseller" ? ResellerBlockedPage : NetworkSelfInstall} />
      <Route path="/admin/network/files" component={NetworkFiles} />
      <Route path="/admin/plans" component={AdminPlans} />
      <Route path="/admin/plans/roaming" component={AdminHotspotRoaming} />
      <Route path="/admin/plans/loyalty" component={LoyaltyPoints} />
      <Route path="/admin/transactions/graphs" component={TransactionGraphs} />
      <Route path="/admin/transactions/hotspot-recovery" component={PaidHotspotRecovery} />
      <Route path="/admin/transactions" component={AdminTransactions} />
      <Route path="/admin/vouchers"         component={AdminVouchers}    />
      <Route path="/admin/hotspot-binding"  component={HotspotBinding}   />
      <Route path="/admin/activation/prepaid-users" component={PrepaidUsers} />
      <Route path="/admin/hotspot-settings" component={HotspotSettings} />
      <Route path="/admin/pppoe-settings"   component={PPPoESettings}   />
      <Route path="/admin/pppoe-settings/setup" component={PPPoESetup} />
      <Route path="/admin/webhooks"          component={Webhooks}         />
      <Route path="/admin/logs"             component={ActivityLogs}     />
      <Route path="/admin/invoices" component={AdminInvoices} />
      <Route path="/admin/balance" component={AdminCustomerBalance} />
      <Route path="/admin/message-templates" component={AdminMessageTemplates} />
      <Route path="/admin/notifications" component={PlatformNotifications} />
      <Route path="/admin/settings" component={AdminSettings} />
      
      {/* VPN — inside admin panel */}
      <Route path="/admin/vpn" component={VpnManagement} />
      <Route path="/admin/vpn/overview" component={VpnDashboard} />
      <Route path="/admin/vpn/remote-access" component={VpnRemoteAccess} />
      <Route path="/admin/vpn/list" component={VpnList} />
      <Route path="/admin/vpn/create" component={VpnCreate} />
      <Route path="/admin/vpn/tutorials" component={VpnTutorials} />
      <Route path="/admin/vpn/settings" component={VpnSettings} />

      {/* Portals — multiple aliases so MikroTik redirect URLs all work */}
      <Route path="/portal/troubleshoot" component={HotspotTroubleshootPage} />
      <Route path="/hotspot-login" component={HotspotLogin} />
      <Route path="/portal/hotspot" component={HotspotLogin} />
      <Route path="/portal" component={HotspotLogin} />
      <Route path="/hotspot" component={HotspotLogin} />
      <Route path="/admin/register" component={AdminRegister} />
      <Route path="/register" component={AdminRegister} />
      <Route path="/auth/register" component={AdminRegister} />
      <Route path="/admin/set-password" component={AdminSetPassword} />
      <Route path="/isp-register"    component={AdminRegister} />
      <Route path="/pppoe-login" component={PPPoELogin} />
      
      {/* Super Admin */}
      <Route path="/super-admin" component={SuperAdminDashboard} />
      <Route path="/super-admin/dashboard"      component={SuperAdminDashboard}        />
      <Route path="/super-admin/admins"         component={SuperAdminAdmins}           />
      <Route path="/super-admin/roles"          component={SuperAdminRoles}            />
      <Route path="/super-admin/auth-security"  component={SuperAdminAuthSecurity}     />
      <Route path="/super-admin/settings"       component={SuperAdminSystemSettings}   />
      <Route path="/super-admin/payments"       component={SuperAdminPaymentGateways}  />
      <Route path="/super-admin/payment-packages" component={SuperAdminPaymentsPackages} />
      <Route path="/super-admin/routers"        component={SuperAdminRouters}          />
      <Route path="/super-admin/billing"        component={SuperAdminBillingEngine}    />
      <Route path="/super-admin/reports"        component={SuperAdminReports}          />
      <Route path="/super-admin/security-logs"  component={SuperAdminSecurityLogs}     />
      <Route path="/super-admin/notifications"  component={SuperAdminNotifications}    />
      <Route path="/super-admin/whatsapp"       component={SuperAdminWhatsApp}         />
      <Route path="/super-admin/sms"            component={SuperAdminSMS}              />
      <Route path="/super-admin/automation"     component={SuperAdminAutomation}       />
      <Route path="/super-admin/backups"        component={SuperAdminBackups}          />
      <Route path="/super-admin/api"            component={SuperAdminApiIntegrations}  />
      <Route path="/super-admin/limits"         component={SuperAdminSystemLimits}     />
      <Route path="/super-admin/impersonate"    component={SuperAdminImpersonate}      />
      <Route path="/super-admin/storage"         component={SuperAdminStorage}          />
      <Route path="/super-admin/login" component={SuperAdminLogin} />
      
      <Route component={NotFound} />
    </Switch>
    </Suspense>
    </TenantRenewalRouteGate>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrandProvider>
          <TypographyProvider>
            <AdminPageVisibilityProvider>
              <DashboardPreferencesProvider>
                <TooltipProvider>
                  <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                    <Router />
                  </WouterRouter>
                  <Toaster />
                </TooltipProvider>
              </DashboardPreferencesProvider>
            </AdminPageVisibilityProvider>
          </TypographyProvider>
        </BrandProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
