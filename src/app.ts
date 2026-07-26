import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { readFileSync } from 'fs';
import { join } from 'path';
import swaggerUi from 'swagger-ui-express';
import { apiDocsEnabled, parseOrigins } from '@config/env';
import { authLimiter, generalLimiter, sanitizeRequest, uploadLimiter } from '@middleware/security';
import { createAdminRouter } from './routes/admin';
import { createAuthRouter } from './routes/auth';
import { createCustomerRouter } from './routes/customer';
import { createDeviceRouter } from './routes/devices';
import { createPublicRouter } from './routes/public';
import { createUploadRouter } from './routes/upload';
import { createWebhookRouter } from './routes/webhooks';
import { createGuestSessionRouter } from './routes/guest-sessions';
import { createPartnerRouter, createRunnerRouter } from './routes/platform-self';
import { createPublicGeographyRouter } from './routes/public-geography';
import { createCatalogMediaRouter } from './routes/catalog-media';
import { errorHandler, requestContext, sendError, sendSuccess } from './utils/http';

export function createApp() {
  const app = express();
  const apiPrefix = `/${process.env.API_PREFIX || 'api/v1'}`;
  const swaggerSpecPath = join(process.cwd(), 'swagger-spec.json');
  const swaggerSpec = JSON.parse(readFileSync(swaggerSpecPath, 'utf8'));
  const docsEnabled = apiDocsEnabled();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestContext);
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use(cors({
    origin: (origin, callback) => {
      const allowed = parseOrigins();
      if (!origin && process.env.NODE_ENV !== 'production') return callback(null, true);
      if (origin && (allowed.includes('*') || allowed.includes(origin))) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  }));
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: process.env.FORM_BODY_LIMIT || '1mb' }));
  app.use(sanitizeRequest);
  app.use(generalLimiter);
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

  app.get('/health', (_req, res) => {
    sendSuccess(res, { status: 'ok', uptime: process.uptime() });
  });

  app.get('/docs-json', (_req, res) => {
    if (!docsEnabled) {
      sendError(res, 404, 'NOT_FOUND', 'Route not found');
      return;
    }
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.json(swaggerSpec);
  });

  app.get(['/swagger-spec.json', '/docs/swagger-spec.json'], (_req, res) => {
    if (!docsEnabled) {
      sendError(res, 404, 'NOT_FOUND', 'Route not found');
      return;
    }
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.json(swaggerSpec);
  });

  app.use('/docs', (_req: Request, res: Response, next: NextFunction) => {
    if (!docsEnabled) {
      sendError(res, 404, 'NOT_FOUND', 'Route not found');
      return;
    }
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
      ].join('; '),
    );
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    next();
  }, swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'Hook API Documentation',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      defaultModelsExpandDepth: 1,
      defaultModelExpandDepth: 2,
      displayRequestDuration: true,
      filter: true,
    },
  }));

  app.use(`${apiPrefix}/auth`, authLimiter, createAuthRouter());
  app.use(`${apiPrefix}/guest-sessions`, authLimiter, createGuestSessionRouter());
  app.use(`${apiPrefix}/devices`, createDeviceRouter());
  app.use(`${apiPrefix}/admin`, createAdminRouter());
  app.use(`${apiPrefix}/runner`, createRunnerRouter());
  app.use(`${apiPrefix}/partner`, createPartnerRouter());
  app.use(`${apiPrefix}/catalog/media`, uploadLimiter, createCatalogMediaRouter());
  app.use(`${apiPrefix}/public`, createPublicGeographyRouter());
  app.use(`${apiPrefix}/upload`, uploadLimiter, createUploadRouter());
  app.use(`${apiPrefix}/webhooks`, createWebhookRouter());
  app.use(apiPrefix, createPublicRouter());
  app.use(apiPrefix, createCustomerRouter());

  app.use('/admin', (_req, res) => {
    res.redirect('http://localhost:3001/dashboard');
  });

  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found' },
      meta: { requestId: _req.requestId, timestamp: new Date().toISOString() },
    });
  });

  app.use(errorHandler);

  return app;
}
