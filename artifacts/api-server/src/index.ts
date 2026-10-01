import app from "./app";
import { logger } from "./lib/logger";
import { sweepAllRouters } from "./routes/routers-route";
import { getRouterCreds } from "./routes/mikrotik-route.js";
import { processDueRouterUserSnapshots } from "./services/router-user-snapshot-service.js";
import {
  enqueueWhatsAppExpiryNotifications,
  processWhatsAppOutboxBatch,
} from "./services/whatsapp/whatsapp-service.js";
import {
  enqueueSmsExpiryNotifications,
  processSmsOutboxBatch,
} from "./services/sms/sms-service.js";

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

const server = app.listen(port, (err) => {
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
  if (process.env.NODE_ENV === "production" && process.env.SMS_WORKER_ENABLED !== "false") {
    let smsWorkerBusy = false;
    let lastSmsExpirySweep = 0;
    const runSmsWorker = async () => {
      if (smsWorkerBusy) return;
      smsWorkerBusy = true;
      try {
        await processSmsOutboxBatch(10);
        if (Date.now() - lastSmsExpirySweep >= 60 * 60 * 1000) {
          await enqueueSmsExpiryNotifications();
          lastSmsExpirySweep = Date.now();
        }
      } catch (error) {
        logger.warn({ err: error }, "[sms] background delivery sweep failed");
      } finally {
        smsWorkerBusy = false;
      }
    };
    setTimeout(() => {
      void runSmsWorker();
      setInterval(() => void runSmsWorker(), 30_000);
    }, 15_000);
    logger.info({ intervalSeconds: 30 }, "[sms] outbox worker started");
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
  if (process.env.NODE_ENV === "production" && process.env.ROUTER_USER_SNAPSHOT_WORKER_ENABLED !== "false") {
    let snapshotWorkerBusy = false;
    const runRouterUserSnapshotWorker = async () => {
      if (snapshotWorkerBusy) return;
      snapshotWorkerBusy = true;
      try {
        const result = await processDueRouterUserSnapshots(async (adminId, routerId) => {
          const found = await getRouterCreds(routerId, adminId);
          return found ? { name: found.row.name ?? `Router ${routerId}`, creds: found.creds } : null;
        });
        if (result.claimed > 0) {
          logger.info(result, "[user-snapshots] scheduled refresh batch finished");
        }
      } catch {
        logger.warn("[user-snapshots] scheduled refresh worker failed");
      } finally {
        snapshotWorkerBusy = false;
      }
    };
    setTimeout(() => {
      void runRouterUserSnapshotWorker();
      setInterval(() => void runRouterUserSnapshotWorker(), 60_000);
    }, 20_000);
    logger.info({ intervalSeconds: 60 }, "[user-snapshots] scheduled refresh worker started");
  }
});

const SHUTDOWN_DRAIN_TIMEOUT_MS = 320_000;
let shutdownStarted = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shutdownStarted) return;
  shutdownStarted = true;
  logger.info(
    { signal, timeoutMs: SHUTDOWN_DRAIN_TIMEOUT_MS },
    "API shutdown started; waiting for in-flight requests to finish",
  );

  const forceExitTimer = setTimeout(() => {
    logger.error(
      { signal, timeoutMs: SHUTDOWN_DRAIN_TIMEOUT_MS },
      "API shutdown drain timed out; forcing exit",
    );
    process.exit(1);
  }, SHUTDOWN_DRAIN_TIMEOUT_MS);
  forceExitTimer.unref();

  server.close((error) => {
    clearTimeout(forceExitTimer);
    if (error) {
      logger.error({ err: error, signal }, "API shutdown failed while closing the HTTP server");
      process.exit(1);
      return;
    }
    logger.info({ signal }, "API shutdown completed after in-flight requests drained");
    process.exit(0);
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
