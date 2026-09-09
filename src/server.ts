import dotenv from 'dotenv';
import cron, { type ScheduledTask } from 'node-cron';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { createApp } from './app';
import { assertSafeEnvironment } from './config/env';
import { disconnectDatabase, initializeDatabase } from './config/data-source';
import { ensurePlatformAccessCatalog } from './services/platform-bootstrap.service';
import { expireNegotiationsAndQuotes } from './services/negotiation.service';
import { startFulfilmentWorker, stopFulfilmentWorker } from './services/fulfilment-worker.service';
import { realtime } from './services/realtime.service';
import { escalateOverdueAvailabilityChecks } from './services/catalog-availability.service';
import { sendDailyAvailabilityDigests } from './services/availability-digest.service';

dotenv.config({ quiet: true });

function printRuntimeServices() {
  const brevoReady = Boolean(
    process.env.BREVO_API_KEY &&
    !process.env.BREVO_API_KEY.includes('placeholder') &&
    process.env.BREVO_FROM_EMAIL,
  );

  console.log(brevoReady
    ? '📧 Brevo Email Service initialized'
    : '📧 Email Service initialized (console fallback)');
}

function printReady(port: number, apiPrefix: string) {
  const env = process.env.NODE_ENV || 'development';
  const serverUrl = env === 'production' && process.env.APP_URL?.startsWith('http')
    ? process.env.APP_URL
    : `http://localhost:${port}`;
  const apiUrl = `${serverUrl}/${apiPrefix}`;
  const docsUrl = `http://localhost:${port}/docs`;
  const rows = [
    ['Server', serverUrl],
    ['API', apiUrl],
    ['Docs', docsUrl],
    ['Env', env],
    ['DB', `MongoDB · ${mongoose.connection.name}`],
  ] as const;
  const width = Math.max(46, ...rows.map(([label, value]) => label.length + value.length + 5));
  const line = (value: string) => `║  ${value.padEnd(width - 4)}║`;

  console.log(`
  ╔${'═'.repeat(width - 2)}╗
  ║${'HOOK API  ·  v1.0.0'.padStart(Math.floor((width - 2 + 19) / 2)).padEnd(width - 2)}║
  ╠${'═'.repeat(width - 2)}╣
${rows.map(([label, value]) => line(`${label.padEnd(8)}${value}`)).join('\n')}
  ╚${'═'.repeat(width - 2)}╝

  Routes
    GET   /health
    POST  /${apiPrefix}/auth/login
    GET   /${apiPrefix}/products
    GET   /${apiPrefix}/cart
    GET   /${apiPrefix}/orders
    GET   /${apiPrefix}/admin/dashboard
  `);
}

let server: Server | undefined;
let expiryTimer: NodeJS.Timeout | undefined;
let availabilityDigestTask: ScheduledTask | undefined;
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n🛑 ${signal} received. Shutting down Hook API...`);
  if (expiryTimer) clearInterval(expiryTimer);
  availabilityDigestTask?.stop();
  stopFulfilmentWorker();
  realtime.close();

  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
  await disconnectDatabase();
  console.log('✅ Hook API stopped cleanly');
  process.exit(0);
}

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

async function bootstrap() {
  assertSafeEnvironment();
  printRuntimeServices();
  await initializeDatabase();
  await ensurePlatformAccessCatalog();
  expiryTimer = setInterval(() => {
    void Promise.all([expireNegotiationsAndQuotes(), escalateOverdueAvailabilityChecks()]).catch((error) => {
      console.error('[catalog-expiry] Failed to process catalog deadlines', error);
    });
  }, 60_000);
  expiryTimer.unref();
  availabilityDigestTask = cron.schedule('0 7 * * *', () => {
    void sendDailyAvailabilityDigests().catch((error) => {
      console.error('[availability-digest] Failed to send daily digest emails', error);
    });
  });
  startFulfilmentWorker();
  console.log('🕒 Catalog expiry scheduler started');
  console.log('   Checking negotiation, quote, and availability deadlines every 60 seconds');
  console.log('📬 Availability digest scheduler started');
  console.log('   Sending daily Market Associate availability-check emails at 07:00');
  console.log('⚙️ Fulfilment worker started');
  console.log('   Polling the durable outbox every 5 seconds');

  const app = createApp();
  const port = Number(process.env.PORT || 4000);
  const apiPrefix = process.env.API_PREFIX || 'api/v1';

  server = app.listen(port, () => {
    printReady(port, apiPrefix);
  });
  realtime.attach(server);
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  console.error('Failed to start Hook API');
  console.error(`Reason: ${message}`);
  console.error('');
  console.error('Database tip: npm run dev uses the complete MONGODB_URI from .env.');
  process.exit(1);
});
