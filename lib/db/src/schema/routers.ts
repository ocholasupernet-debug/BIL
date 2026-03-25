import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const routersTable = pgTable("routers", {
  id: serial("id").primaryKey(),
  ispId: integer("isp_id").notNull(),
  name: text("name").notNull(),
  ipAddress: text("ip_address").notNull(),
  model: text("model"),
  rosVersion: text("ros_version"),
  apiPort: integer("api_port").notNull().default(8728),
  apiUsername: text("api_username"),
  apiPassword: text("api_password"),
  status: text("status").notNull().default("online"),
  lastSeen: timestamp("last_seen", { withTimezone: true }),
  uptime: text("uptime"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRouterSchema = createInsertSchema(routersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRouter = z.infer<typeof insertRouterSchema>;
export type Router_ = typeof routersTable.$inferSelect;
