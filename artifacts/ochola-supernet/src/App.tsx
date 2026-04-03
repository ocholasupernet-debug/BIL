import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/context/ThemeContext";
import { BrandProvider } from "@/context/BrandContext";
import { getHostSubdomain } from "@/lib/subdomain";

import LandingPage from "./pages/LandingPage";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminDashboard from "./pages/admin/Dashboard";
import AdminCustomers from "./pages/admin/Customers";
import AdminNetwork from "./pages/admin/Network";
import NetworkRouters from "./pages/admin/network/Routers";
import NetworkPPPoE from "./pages/admin/network/PPPoE";
import NetworkQueues from "./pages/admin/network/Queues";
import NetworkIPPool from "./pages/admin/network/IPPool";
import NetworkSelfInstall from "./pages/admin/network/SelfInstall";
import NetworkReplaceRouter from "./pages/admin/network/ReplaceRouter";
import NetworkBridgePorts from "./pages/admin/network/BridgePorts";
import NetworkWireless from "./pages/admin/network/Wireless";
import NetworkPPP from "./pages/admin/network/PPP";
import RouterAPIConfig from "./pages/admin/network/RouterAPIConfig";
import Webhooks from "./pages/admin/Webhooks";
import ActivityLogs from "./pages/admin/ActivityLogs";
import AdminPlans from "./pages/admin/Plans";
import AdminTransactions from "./pages/admin/Transactions";
import TransactionGraphs from "./pages/admin/TransactionGraphs";
import HotspotSettings from "./pages/admin/HotspotSettings";
import PPPoESettings from "./pages/admin/PPPoESettings";
import AdminVouchers from "./pages/admin/Vouchers";
import HotspotBinding from "./pages/admin/HotspotBinding";
import PrepaidUsers from "./pages/admin/PrepaidUsers";

import HotspotLogin from "./pages/portal/HotspotLogin";
import PPPoELogin  from "./pages/portal/PPPoELogin";
import SuperAdminLogin from "./pages/super-admin/Login";
import SuperAdminDashboard from "./pages/super-admin/Dashboard";
import SuperAdminAdmins from "./pages/super-admin/Admins";
import SuperAdminRoles from "./pages/super-admin/Roles";
import SuperAdminSystemSettings from "./pages/super-admin/SystemSettings";
import SuperAdminPaymentGateways from "./pages/super-admin/PaymentGateways";
import SuperAdminRouters from "./pages/super-admin/Routers";
import SuperAdminBillingEngine from "./pages/super-admin/BillingEngine";
import SuperAdminReports from "./pages/super-admin/Reports";
import SuperAdminSecurityLogs from "./pages/super-admin/SecurityLogs";
import SuperAdminNotifications from "./pages/super-admin/Notifications";
import SuperAdminAutomation from "./pages/super-admin/Automation";
import SuperAdminBackups from "./pages/super-admin/Backups";
import SuperAdminApiIntegrations from "./pages/super-admin/ApiIntegrations";
import SuperAdminSystemLimits from "./pages/super-admin/SystemLimits";
import SuperAdminImpersonate from "./pages/super-admin/Impersonate";
import VpnDashboard from "./pages/vpn/VpnDashboard";
import VpnRemoteAccess from "./pages/vpn/RemoteAccess";
import VpnList from "./pages/vpn/VpnList";
import VpnCreate from "./pages/vpn/CreateVpn";
import VpnTutorials from "./pages/vpn/VideoTutorials";
import VpnSettings from "./pages/vpn/Settings";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminRegister from "./pages/admin/AdminRegister";
import AdminSetPassword from "./pages/admin/AdminSetPassword";

/* ── SubdomainGuard ──────────────────────────────────────────────
   When the visitor arrives at a company subdomain (e.g. fastnet.isplatty.org),
   the root "/" path redirects straight to that company's login page.
   On the bare domain (isplatty.org) the normal landing page is shown.
──────────────────────────────────────────────────────────────── */
function SubdomainGuard() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    const sub = getHostSubdomain();
    if (sub) {
      setLocation("/admin/login");
    }
  }, [setLocation]);

  /* While redirect fires, show nothing (or show LandingPage as fallback) */
  const sub = getHostSubdomain();
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
        <h1 className="text-6xl font-black text-cyan-500">404</h1>
        <p className="text-xl text-slate-300">Page not found</p>
        <button onClick={() => window.history.back()} className="px-6 py-2 bg-white/10 rounded-lg text-white font-semibold">Go Back</button>
      </div>
    </div>
  );
}

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={SubdomainGuard} />
      <Route path="/admin/login" component={AdminLogin} />
      <Route path="/admin/dashboard" component={AdminDashboard} />
      <Route path="/admin/customers" component={AdminCustomers} />
      <Route path="/admin/network" component={NetworkRouters} />
      <Route path="/admin/network/routers"        component={NetworkRouters}       />
      <Route path="/admin/network/pppoe"          component={NetworkPPPoE}         />
      <Route path="/admin/network/queues"         component={NetworkQueues}        />
      <Route path="/admin/network/ip-pools"       component={NetworkIPPool}        />
      <Route path="/admin/network/add-router"     component={NetworkSelfInstall}   />
      <Route path="/admin/network/bridge-ports"   component={NetworkBridgePorts}   />
      <Route path="/admin/network/wireless"       component={NetworkWireless}      />
      <Route path="/admin/network/ppp"            component={NetworkPPP}           />
      <Route path="/admin/network/router-api-config" component={RouterAPIConfig}  />
      {/* Legacy redirects — keep old paths working */}
      <Route path="/admin/network/ippool"         component={NetworkIPPool}        />
      <Route path="/admin/network/self-install"   component={NetworkSelfInstall}   />
      <Route path="/admin/network/replace-router" component={NetworkReplaceRouter} />
      <Route path="/admin/plans" component={AdminPlans} />
      <Route path="/admin/transactions/graphs" component={TransactionGraphs} />
      <Route path="/admin/transactions" component={AdminTransactions} />
      <Route path="/admin/vouchers"         component={AdminVouchers}    />
      <Route path="/admin/hotspot-binding"  component={HotspotBinding}   />
      <Route path="/admin/activation/prepaid-users" component={PrepaidUsers} />
      <Route path="/admin/hotspot-settings" component={HotspotSettings} />
      <Route path="/admin/pppoe-settings"   component={PPPoESettings}   />
      <Route path="/admin/webhooks"          component={Webhooks}         />
      <Route path="/admin/logs"             component={ActivityLogs}     />
      <Route path="/admin/settings" component={AdminSettings} />
      
      {/* VPN — inside admin panel */}
      <Route path="/admin/vpn" component={VpnDashboard} />
      <Route path="/admin/vpn/remote-access" component={VpnRemoteAccess} />
      <Route path="/admin/vpn/list" component={VpnList} />
      <Route path="/admin/vpn/create" component={VpnCreate} />
      <Route path="/admin/vpn/tutorials" component={VpnTutorials} />
      <Route path="/admin/vpn/settings" component={VpnSettings} />

      {/* Portals — multiple aliases so MikroTik redirect URLs all work */}
      <Route path="/hotspot-login" component={HotspotLogin} />
      <Route path="/portal/hotspot" component={HotspotLogin} />
      <Route path="/portal" component={HotspotLogin} />
      <Route path="/hotspot" component={HotspotLogin} />
      <Route path="/admin/register" component={AdminRegister} />
      <Route path="/admin/set-password" component={AdminSetPassword} />
      <Route path="/isp-register"    component={AdminRegister} />
      <Route path="/pppoe-login" component={PPPoELogin} />
      
      {/* Super Admin */}
      <Route path="/super-admin" component={SuperAdminDashboard} />
      <Route path="/super-admin/dashboard"      component={SuperAdminDashboard}        />
      <Route path="/super-admin/admins"         component={SuperAdminAdmins}           />
      <Route path="/super-admin/roles"          component={SuperAdminRoles}            />
      <Route path="/super-admin/settings"       component={SuperAdminSystemSettings}   />
      <Route path="/super-admin/payments"       component={SuperAdminPaymentGateways}  />
      <Route path="/super-admin/routers"        component={SuperAdminRouters}          />
      <Route path="/super-admin/billing"        component={SuperAdminBillingEngine}    />
      <Route path="/super-admin/reports"        component={SuperAdminReports}          />
      <Route path="/super-admin/security-logs"  component={SuperAdminSecurityLogs}     />
      <Route path="/super-admin/notifications"  component={SuperAdminNotifications}    />
      <Route path="/super-admin/automation"     component={SuperAdminAutomation}       />
      <Route path="/super-admin/backups"        component={SuperAdminBackups}          />
      <Route path="/super-admin/api"            component={SuperAdminApiIntegrations}  />
      <Route path="/super-admin/limits"         component={SuperAdminSystemLimits}     />
      <Route path="/super-admin/impersonate"    component={SuperAdminImpersonate}      />
      <Route path="/super-admin/login" component={SuperAdminLogin} />
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrandProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </BrandProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
