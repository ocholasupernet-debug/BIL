import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const plansTable = pgTable("isp_plans", {
  id: serial("id").primaryKey(),
  ispId: integer("isp_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("hotspot"),
  speed: text("speed").notNull(),
  price: integer("price").notNull(),
  durationDays: integer("duration_days").notNull().default(30),
  description: text("description"),
  isActive: text("is_active").notNull().default("true"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPlanSchema = createInsertSchema(plansTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type Plan = typeof plansTable.$inferSelect;
