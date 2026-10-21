import { sbRpc } from "../lib/supabase-client.js";
import { logger } from "../lib/logger.js";

const RETENTION_GRACE_DAYS = 180;
const RETENTION_BATCH_SIZE = 500;

export async function purgeExpiredPrepaidCustomers(): Promise<number> {
  const rows = await sbRpc<number | string>("purge_expired_prepaid_customers", {
    p_grace_days: RETENTION_GRACE_DAYS,
    p_batch_size: RETENTION_BATCH_SIZE,
  });
  const deleted = Math.max(0, Math.floor(Number(rows[0] ?? 0)));
  if (deleted > 0) {
    logger.info({ deleted, retentionGraceDays: RETENTION_GRACE_DAYS }, "[expired-customer-retention] purged old expired accounts");
  }
  return deleted;
}
