import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const transactionsTable = pgTable("isp_transactions", {
  id: serial("id").primaryKey(),
  ispId: integer("isp_id").notNull(),
  customerId: integer("customer_id"),
  customerName: text("customer_name"),
  phone: text("phone"),
  amount: integer("amount").notNull(),
  method: text("method").notNull().default("mpesa"),
  planName: text("plan_name"),
  mpesaRef: text("mpesa_ref"),
  status: text("status").notNull().default("completed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;
