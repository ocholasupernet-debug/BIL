import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const customersTable = pgTable("isp_customers", {
  id: serial("id").primaryKey(),
  ispId: integer("isp_id").notNull(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  planId: integer("plan_id"),
  planName: text("plan_name"),
  ipAddress: text("ip_address"),
  macAddress: text("mac_address"),
  status: text("status").notNull().default("active"),
  expiryDate: timestamp("expiry_date", { withTimezone: true }),
  amountPaid: integer("amount_paid").notNull().default(0),
  pppoeUsername: text("pppoe_username"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCustomerSchema = createInsertSchema(customersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customersTable.$inferSelect;
