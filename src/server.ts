import dotenv from 'dotenv';
import { createApp } from './app';
import { assertSafeEnvironment } from './config/env';
import { initializeDatabase } from './config/data-source';
import { ensurePlatformAccessCatalog } from './services/platform-bootstrap.service';

dotenv.config({ quiet: true });

function pad(value: string, width = 39) {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width);
}

function printReady(port: number, apiPrefix: string) {
  const base = `http://localhost:${port}/${apiPrefix}`;
  const env = process.env.NODE_ENV || 'development';
  const serverUrl = env === 'production' && process.env.APP_URL?.startsWith('http')
    ? process.env.APP_URL
    : `http://localhost:${port}`;
  const docsUrl = `http://localhost:${port}/docs`;
  const dbLabel = `MongoDB · ${process.env.MONGODB_URI ? 'MONGODB_URI' : 'not configured'}`;

  console.log(`
  ╔═══════════════════════════════════════════════╗
  ║              HOOK API  ·  v1.0.0             ║
  ╠═══════════════════════════════════════════════╣
  ║  Server   ${pad(serverUrl)}║
  ║  API      ${pad(base)}║
  ║  Docs     ${pad(docsUrl)}║
  ║  Env      ${pad(env)}║
  ║  DB       ${pad(dbLabel)}║
  ╚═══════════════════════════════════════════════╝

  Routes
    GET   /health
    POST  /${apiPrefix}/auth/login
    POST  /${apiPrefix}/admin/auth/login
    GET   /${apiPrefix}/products
    GET   /${apiPrefix}/cart
    GET   /${apiPrefix}/orders
    GET   /${apiPrefix}/admin/dashboard
  `);
}

async function bootstrap() {
  assertSafeEnvironment();
  await initializeDatabase();
  await ensurePlatformAccessCatalog();

  const app = createApp();
  const port = Number(process.env.PORT || 4000);
  const apiPrefix = process.env.API_PREFIX || 'api/v1';

  app.listen(port, () => {
    printReady(port, apiPrefix);
  });
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  console.error('Failed to start Hook API');
  console.error(`Reason: ${message}`);
  console.error('');
  console.error('Database tip: npm run dev now uses MongoDB from .env. Check MONGODB_URI and MONGODB_DB_NAME.');
  process.exit(1);
});
