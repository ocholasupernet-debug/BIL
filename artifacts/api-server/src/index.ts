import app from "./app";
import { logger } from "./lib/logger";
import { sweepAllRouters } from "./routes/routers-route";
import {
  enqueueWhatsAppExpiryNotifications,
  processWhatsAppOutboxBatch,
} from "./services/whatsapp/whatsapp-service.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  if (process.env.NODE_ENV === "production" && process.env.WHATSAPP_WORKER_ENABLED !== "false") {
    let whatsappWorkerBusy = false;
    let lastExpirySweep = 0;
    const runWhatsAppWorker = async () => {
      if (whatsappWorkerBusy) return;
      whatsappWorkerBusy = true;
      try {
        await processWhatsAppOutboxBatch(10);
        if (Date.now() - lastExpirySweep >= 60 * 60 * 1000) {
          await enqueueWhatsAppExpiryNotifications();
          lastExpirySweep = Date.now();
        }
      } catch (error) {
        logger.warn({ err: error }, "[whatsapp] background delivery sweep failed");
      } finally {
        whatsappWorkerBusy = false;
      }
    };
    setTimeout(() => {
      void runWhatsAppWorker();
      setInterval(() => void runWhatsAppWorker(), 30_000);
    }, 15_000);
    logger.info({ intervalSeconds: 30 }, "[whatsapp] outbox worker started");
  }

  /* ── Background router health monitor ─────────────────────────────────────
   * Pings all routers every 5 minutes and updates their status in Supabase.
   * First sweep runs 30 seconds after startup to let the server settle.
   * ─────────────────────────────────────────────────────────────────────── */
  const SWEEP_INTERVAL_MS = 5 * 60 * 1000; /* 5 minutes */
  if (process.env.NODE_ENV === "production") {
    setTimeout(() => {
      sweepAllRouters().catch(e => logger.error({ err: e }, "[monitor] initial sweep failed"));
      setInterval(() => {
        sweepAllRouters().catch(e => logger.error({ err: e }, "[monitor] sweep failed"));
      }, SWEEP_INTERVAL_MS);
      logger.info({ intervalMin: 5 }, "[monitor] Router health monitor started");
    }, 30_000);
  }
});
