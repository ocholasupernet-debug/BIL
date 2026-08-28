import { db, ispsTable, customersTable, plansTable, vouchersTable, transactionsTable, routersTable } from "@workspace/db";
import { logger } from "./lib/logger";

async function seed() {
  logger.info("Seeding demo data...");

  const [isp] = await db.insert(ispsTable).values({
    name: "OcholaNet ISP",
    slug: "ocholanet",
    email: "admin@ocholanet.co.ke",
    phone: "0712345678",
    address: "Nairobi, Kenya",
    plan: "pro",
    status: "active",
    maxCustomers: 200,
  }).onConflictDoNothing().returning();

  const ispId = isp?.id ?? 1;

  await db.insert(plansTable).values([
    { ispId, name: "Hotspot 5Mbps", type: "hotspot", speed: "5Mbps", price: 300, durationDays: 30, description: "5Mbps hotspot plan" },
    { ispId, name: "Hotspot 10Mbps", type: "hotspot", speed: "10Mbps", price: 500, durationDays: 30, description: "10Mbps hotspot plan" },
    { ispId, name: "Hotspot 20Mbps", type: "hotspot", speed: "20Mbps", price: 800, durationDays: 30, description: "20Mbps hotspot plan" },
    { ispId, name: "PPPoE 10Mbps", type: "pppoe", speed: "10Mbps", price: 800, durationDays: 30, description: "10Mbps PPPoE plan" },
    { ispId, name: "PPPoE 20Mbps", type: "pppoe", speed: "20Mbps", price: 1200, durationDays: 30, description: "20Mbps PPPoE plan" },
    { ispId, name: "PPPoE 50Mbps", type: "pppoe", speed: "50Mbps", price: 3500, durationDays: 30, description: "50Mbps PPPoE plan" },
  ]).onConflictDoNothing();

  await db.insert(customersTable).values([
    { ispId, name: "John Kamau", phone: "0712345678", planName: "Hotspot 10Mbps", ipAddress: "192.168.1.101", status: "active", expiryDate: new Date("2026-03-27"), amountPaid: 500 },
    { ispId, name: "Mary Wanjiku", phone: "0723456789", planName: "PPPoE 20Mbps", pppoeUsername: "pppoe-mwanjiku", status: "active", expiryDate: new Date("2026-04-01"), amountPaid: 1200 },
    { ispId, name: "Peter Otieno", phone: "0734567890", planName: "Hotspot 5Mbps", ipAddress: "192.168.1.102", status: "expired", expiryDate: new Date("2026-03-24"), amountPaid: 300 },
    { ispId, name: "Grace Muthoni", phone: "0745678901", planName: "PPPoE 10Mbps", pppoeUsername: "pppoe-gmuthoni", status: "active", expiryDate: new Date("2026-04-05"), amountPaid: 800 },
    { ispId, name: "David Njoroge", phone: "0756789012", planName: "Hotspot 10Mbps", ipAddress: "192.168.1.103", status: "active", expiryDate: new Date("2026-03-27"), amountPaid: 500 },
    { ispId, name: "Alice Wairimu", phone: "0767890123", planName: "PPPoE 50Mbps", pppoeUsername: "pppoe-awairimu", status: "expired", expiryDate: new Date("2026-03-22"), amountPaid: 3500 },
    { ispId, name: "Samuel Kipchoge", phone: "0778901234", planName: "Hotspot 20Mbps", ipAddress: "192.168.1.104", status: "active", expiryDate: new Date("2026-03-30"), amountPaid: 800 },
    { ispId, name: "Fatuma Hassan", phone: "0789012345", planName: "PPPoE 20Mbps", pppoeUsername: "pppoe-fhassan", status: "active", expiryDate: new Date("2026-04-02"), amountPaid: 1200 },
    { ispId, name: "Joseph Mutua", phone: "0790123456", planName: "Hotspot 5Mbps", ipAddress: "192.168.1.105", status: "active", expiryDate: new Date("2026-03-25"), amountPaid: 300 },
    { ispId, name: "Ruth Achieng", phone: "0701234567", planName: "PPPoE 10Mbps", pppoeUsername: "pppoe-rachieng", status: "suspended", expiryDate: new Date("2026-04-08"), amountPaid: 800 },
  ]).onConflictDoNothing();

  await db.insert(routersTable).values([
    { ispId, name: "Router 01 — Nairobi HQ", ipAddress: "192.168.1.1", model: "RB4011iGS+5HacQ2HnD", rosVersion: "7.14.2", status: "online", uptime: "14d 3h 22m" },
    { ispId, name: "Router 02 — Karen Branch", ipAddress: "192.168.2.1", model: "RB2011UiAS-2HnD", rosVersion: "7.13.5", status: "online", uptime: "7d 12h 05m" },
    { ispId, name: "Router 03 — Westlands", ipAddress: "10.0.3.1", model: "hEX S", rosVersion: "7.12.1", status: "offline" },
  ]).onConflictDoNothing();

  await db.insert(transactionsTable).values([
    { ispId, customerName: "John Kamau", phone: "0712345678", amount: 500, method: "mpesa", planName: "Hotspot 10Mbps", mpesaRef: "NLJ8K2X3", status: "completed" },
    { ispId, customerName: "Mary Wanjiku", phone: "0723456789", amount: 1200, method: "mpesa", planName: "PPPoE 20Mbps", mpesaRef: "PLK7M1Y2", status: "completed" },
    { ispId, customerName: "Grace Muthoni", phone: "0745678901", amount: 800, method: "mpesa", planName: "PPPoE 10Mbps", mpesaRef: "QRP3N8Z4", status: "completed" },
    { ispId, customerName: "David Njoroge", phone: "0756789012", amount: 500, method: "cash", planName: "Hotspot 10Mbps", status: "completed" },
    { ispId, customerName: "Samuel Kipchoge", phone: "0778901234", amount: 800, method: "mpesa", planName: "Hotspot 20Mbps", mpesaRef: "WXT5B6C7", status: "completed" },
  ]).onConflictDoNothing();

  await db.insert(vouchersTable).values([
    { ispId, code: "ABC1", batchName: "Batch-001", planName: "Hotspot 1hr", duration: "1 Hour", price: 50, status: "unused" },
    { ispId, code: "DEF2", batchName: "Batch-001", planName: "Hotspot 1hr", duration: "1 Hour", price: 50, status: "used", usedBy: "0712000001" },
    { ispId, code: "GHI3", batchName: "Batch-001", planName: "Hotspot 3hr", duration: "3 Hours", price: 100, status: "unused" },
    { ispId, code: "JKL4", batchName: "Batch-002", planName: "Hotspot Daily", duration: "24 Hours", price: 200, status: "unused" },
    { ispId, code: "MNO5", batchName: "Batch-002", planName: "Hotspot Daily", duration: "24 Hours", price: 200, status: "expired" },
  ]).onConflictDoNothing();

  logger.info("Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  logger.error(err, "Seed failed");
  process.exit(1);
});
