import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const customersTable = pgTable("isp_customers", {
  id: serial("id").primaryKey().notNull(),
  name: text("name").notNull(),
  username: text("username").notNull(),
  password: text("password").notNull(),
  email: text("email"),
  phone: text("phone"),
  type: text("type").notNull(),
  planId: integer("plan_id"),
  adminId: integer("admin_id"),
  status: text("status").default("active").notNull(),
  ipAddress: text("ip_address"),
  macAddress: text("mac_address"),
  pppoeUsername: text("pppoe_username"),
  dataUsedMb: integer("data_used_mb").default(0).notNull(),
  expiresAt: timestamp("expires_at", { mode: "string" }),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
});

export type Customer = typeof customersTable.$inferSelect;
export type InsertCustomer = typeof customersTable.$inferInsert;
