import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

export const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL })
  : null;

export const db = pool
  ? drizzle(pool, { schema })
  : null;

export * from "./schema";
