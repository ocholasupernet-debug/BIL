import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const plansTable = pgTable("isp_plans", {
  id: serial("id").primaryKey().notNull(),
  adminId: integer("admin_id"),
  name: text("name").notNull(),
  type: text("type").notNull(),
  bandwidthId: integer("bandwidth_id"),
  speedDown: integer("speed_down").notNull(),
  speedUp: integer("speed_up").notNull(),
  price: integer("price").notNull(),
  planType: text("plan_type").default("unlimited").notNull(),
  validity: integer("validity").default(30).notNull(),
  validityUnit: text("validity_unit").default("days").notNull(),
  validityDays: integer("validity_days").default(30).notNull(),
  dataLimitMb: integer("data_limit_mb"),
  burstLimit: text("burst_limit"),
  sharedUsers: integer("shared_users").default(1),
  clientCanPurchase: boolean("client_can_purchase").default(true).notNull(),
  routerId: integer("router_id"),
  activeIpPool: text("active_ip_pool"),
  expiredIpPool: text("expired_ip_pool"),
  staticIpRange: text("static_ip_range"),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
});

export type Plan = typeof plansTable.$inferSelect;
export type InsertPlan = typeof plansTable.$inferInsert;
