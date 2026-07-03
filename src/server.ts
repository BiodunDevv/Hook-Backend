import dotenv from 'dotenv';
import 'reflect-metadata';
import { createApp } from './app';
import { initializeDatabase } from './config/data-source';

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
  const dbLabel = process.env.DB_TYPE === 'sqlite'
    ? `SQLite · ${process.env.DB_DATABASE || 'data/hook_dev.sqlite'}`
    : `Postgres · ${process.env.DB_HOST || 'DATABASE_URL'}`;

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
  await initializeDatabase();

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
  if (process.env.DB_TYPE !== 'sqlite') {
    console.error('');
    console.error('Database tip: npm run dev uses local SQLite by default. If you intentionally want the .env database, run HOOK_USE_ENV_DB=true npm run dev.');
  }
  process.exit(1);
});
