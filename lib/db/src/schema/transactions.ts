import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const transactionsTable = pgTable("isp_transactions", {
  id: serial("id").primaryKey().notNull(),
  customerId: integer("customer_id"),
  planId: integer("plan_id"),
  amount: integer("amount").notNull(),
  paymentMethod: text("payment_method").default("cash").notNull(),
  reference: text("reference"),
  status: text("status").default("completed").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
});

export type Transaction = typeof transactionsTable.$inferSelect;
export type InsertTransaction = typeof transactionsTable.$inferInsert;
