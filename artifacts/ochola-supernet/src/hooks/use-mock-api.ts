import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Mock Data
export const MOCK_CUSTOMERS = [
  { id: 1, name: "John Kamau", phone: "0712345678", plan: "Hotspot 10Mbps", ip: "192.168.1.101", expiry: "2026-03-27", paid: 500, status: "Active", initials: "JK", color: "#2563EB" },
  { id: 2, name: "Mary Wanjiku", phone: "0723456789", plan: "PPPoE 20Mbps", ip: "pppoe-mwanjiku", expiry: "2026-04-01", paid: 1200, status: "Active", initials: "MW", color: "#8b5cf6" },
  { id: 3, name: "Peter Otieno", phone: "0734567890", plan: "Hotspot 5Mbps", ip: "192.168.1.102", expiry: "2026-03-24", paid: 300, status: "Expired", initials: "PO", color: "#f59e0b" },
  { id: 4, name: "Grace Muthoni", phone: "0745678901", plan: "PPPoE 10Mbps", ip: "pppoe-gmuthoni", expiry: "2026-04-05", paid: 800, status: "Active", initials: "GM", color: "#10b981" },
  { id: 5, name: "David Njoroge", phone: "0756789012", plan: "Hotspot 10Mbps", ip: "192.168.1.103", expiry: "2026-03-27", paid: 500, status: "Active", initials: "DN", color: "#ec4899" },
];

export const MOCK_TRANSACTIONS = [
  { id: 1, customer: "John Kamau", plan: "Hotspot 10Mbps", amount: 500, method: "mpesa", ref: "QGH12345AB", status: "completed", date: "24/3/26 10:23" },
  { id: 2, customer: "Mary Wanjiku", plan: "PPPoE 20Mbps", amount: 1200, method: "mpesa", ref: "RKL98765CD", status: "completed", date: "24/3/26 09:15" },
  { id: 3, customer: "Peter Otieno", plan: "Hotspot 5Mbps", amount: 300, method: "mpesa", ref: "STM11223EF", status: "pending", date: "24/3/26 08:40" },
  { id: 4, customer: "Grace Muthoni", plan: "PPPoE 10Mbps", amount: 800, method: "cash", ref: "—", status: "completed", date: "23/3/26 16:55" },
];

export const MOCK_PLANS = [
  { id: 1, name: "Basic Hotspot", speed: "5Mbps / 5Mbps", price: 300, validity: "1 Day", users: 14, active: true, burst: false, data: "Unlimited", type: "hotspot" },
  { id: 2, name: "Standard Hotspot", speed: "10Mbps / 10Mbps", price: 500, validity: "3 Days", users: 21, active: true, burst: false, data: "Unlimited", type: "hotspot" },
  { id: 3, name: "PPPoE Basic", speed: "10Mbps / 5Mbps", price: 1000, validity: "30 Days", users: 8, active: true, burst: false, data: "Unlimited", type: "pppoe" },
  { id: 4, name: "PPPoE Premium", speed: "50Mbps / 20Mbps", price: 3500, validity: "30 Days", users: 3, active: true, burst: true, data: "Unlimited", type: "pppoe" },
];

export const MOCK_BANDWIDTH_PLANS = [
  { id: 1, name: "5Mbps Standard", download: 5, upload: 5, unit: "Mbps", burst: false, usedBy: 12 },
  { id: 2, name: "10Mbps Standard", download: 10, upload: 10, unit: "Mbps", burst: false, usedBy: 28 },
  { id: 3, name: "20Mbps Premium", download: 20, upload: 10, unit: "Mbps", burst: false, usedBy: 9 },
  { id: 4, name: "50Mbps Business", download: 50, upload: 20, unit: "Mbps", burst: true, usedBy: 4 },
];

const MOCK_ISPS = [
  { id: 1, name: "Ochola ISP", slug: "ochola", customers: 124, revenue: 145000, license: "OCH-PRO-2026-DEMO-0001", status: "active" },
  { id: 2, name: "FastNet Kenya", slug: "fastnet", customers: 87, revenue: 98000, license: "OCH-PRO-2026-FNKE-0012", status: "active" },
  { id: 3, name: "TelcoHub Ltd", slug: "telcohub", customers: 0, revenue: 0, license: "—", status: "pending" },
];

// Hooks
export function useCustomers() {
  return useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      await new Promise(resolve => setTimeout(resolve, 600));
      return MOCK_CUSTOMERS;
    }
  });
}

export function useTransactions() {
  return useQuery({
    queryKey: ["transactions"],
    queryFn: async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      return MOCK_TRANSACTIONS;
    }
  });
}

export function usePlans(type?: string) {
  return useQuery({
    queryKey: ["plans", type],
    queryFn: async () => {
      await new Promise(resolve => setTimeout(resolve, 400));
      return type ? MOCK_PLANS.filter(p => p.type === type) : MOCK_PLANS;
    }
  });
}

export function useIsps() {
  return useQuery({
    queryKey: ["isps"],
    queryFn: async () => {
      await new Promise(resolve => setTimeout(resolve, 600));
      return MOCK_ISPS;
    }
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      await new Promise(resolve => setTimeout(resolve, 800));
      return { id: Math.random(), ...data };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] })
  });
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      await new Promise(resolve => setTimeout(resolve, 800));
      return { id: Math.random(), ...data };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plans"] })
  });
}
