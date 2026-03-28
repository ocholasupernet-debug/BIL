import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ispsTable = pgTable("isp_isps", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  address: text("address"),
  plan: text("plan").notNull().default("starter"),
  status: text("status").notNull().default("active"),
  licenseExpiry: timestamp("license_expiry", { withTimezone: true }),
  maxCustomers: integer("max_customers").notNull().default(50),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertIspSchema = createInsertSchema(ispsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIsp = z.infer<typeof insertIspSchema>;
export type Isp = typeof ispsTable.$inferSelect;
