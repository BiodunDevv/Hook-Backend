import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { readFileSync } from 'fs';
import { join } from 'path';
import swaggerUi from 'swagger-ui-express';
import { createAdminRouter } from './routes/admin';
import { createAuthRouter } from './routes/auth';
import { createCustomerRouter } from './routes/customer';
import { createLogisticsRouter } from './routes/logistics';
import { createPublicRouter } from './routes/public';
import { createUploadRouter } from './routes/upload';
import { createVendorRouter } from './routes/vendor';
import { createWebhookRouter } from './routes/webhooks';
import { errorHandler, sendSuccess } from './utils/http';

export function createApp() {
  const app = express();
  const apiPrefix = `/${process.env.API_PREFIX || 'api/v1'}`;
  const swaggerSpecPath = join(process.cwd(), 'swagger-spec.json');
  const swaggerSpec = JSON.parse(readFileSync(swaggerSpecPath, 'utf8'));

  app.use(helmet());
  app.use(cors({
    origin: process.env.CORS_ORIGINS === '*' || !process.env.CORS_ORIGINS
      ? true
      : process.env.CORS_ORIGINS.split(','),
    credentials: true,
  }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

  app.get('/health', (_req, res) => {
    sendSuccess(res, { status: 'ok', uptime: process.uptime() });
  });

  app.get('/docs-json', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.json(swaggerSpec);
  });

  app.get(['/swagger-spec.json', '/docs/swagger-spec.json'], (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.json(swaggerSpec);
  });

  app.use('/docs', (_req: Request, res: Response, next: NextFunction) => {
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

  app.use(`${apiPrefix}/auth`, createAuthRouter());
  app.use(`${apiPrefix}/admin`, createAdminRouter());
  app.use(`${apiPrefix}/vendors/me`, createVendorRouter());
  app.use(`${apiPrefix}/logistics`, createLogisticsRouter());
  app.use(`${apiPrefix}/upload`, createUploadRouter());
  app.use(`${apiPrefix}/webhooks`, createWebhookRouter());
  app.use(apiPrefix, createPublicRouter());
  app.use(apiPrefix, createCustomerRouter());

  app.use('/admin', (_req, res) => {
    res.redirect('http://localhost:3001/dashboard');
  });

  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      message: 'Route not found',
      timestamp: new Date().toISOString(),
    });
  });

  app.use(errorHandler);

  return app;
}
