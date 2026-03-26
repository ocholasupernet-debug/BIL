import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/context/ThemeContext";

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
import AdminPlans from "./pages/admin/Plans";
import AdminTransactions from "./pages/admin/Transactions";

import HotspotLogin from "./pages/portal/HotspotLogin";
import SuperAdminDashboard from "./pages/super-admin/Dashboard";
import VpnDashboard from "./pages/vpn/VpnDashboard";
import VpnRemoteAccess from "./pages/vpn/RemoteAccess";
import VpnList from "./pages/vpn/VpnList";
import VpnCreate from "./pages/vpn/CreateVpn";
import VpnTutorials from "./pages/vpn/VideoTutorials";

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
      <Route path="/" component={LandingPage} />
      <Route path="/admin/login" component={AdminLogin} />
      <Route path="/admin/dashboard" component={AdminDashboard} />
      <Route path="/admin/customers" component={AdminCustomers} />
      <Route path="/admin/network" component={NetworkRouters} />
      <Route path="/admin/network/routers"      component={NetworkRouters}     />
      <Route path="/admin/network/pppoe"        component={NetworkPPPoE}       />
      <Route path="/admin/network/queues"       component={NetworkQueues}      />
      <Route path="/admin/network/ippool"       component={NetworkIPPool}      />
      <Route path="/admin/network/self-install" component={NetworkSelfInstall} />
      <Route path="/admin/plans" component={AdminPlans} />
      <Route path="/admin/transactions" component={AdminTransactions} />
      
      {/* VPN Portal — vpn.isplatty.org */}
      <Route path="/vpn" component={VpnDashboard} />
      <Route path="/vpn/remote-access" component={VpnRemoteAccess} />
      <Route path="/vpn/list" component={VpnList} />
      <Route path="/vpn/create" component={VpnCreate} />
      <Route path="/vpn/tutorials" component={VpnTutorials} />

      {/* Portals */}
      <Route path="/hotspot-login" component={HotspotLogin} />
      <Route path="/isp-register" component={() => <StubPage title="ISP Registration Portal" />} />
      <Route path="/pppoe-login" component={() => <StubPage title="PPPoE Client Portal" />} />
      
      {/* Super Admin */}
      <Route path="/super-admin/dashboard" component={SuperAdminDashboard} />
      <Route path="/super-admin/login" component={() => <StubPage title="Super Admin Login" />} />
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
