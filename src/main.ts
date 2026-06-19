import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as express from 'express';
import { join } from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from '@common/filters/http-exception.filter';
import { TransformInterceptor } from '@common/interceptors/transform.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT || 3000;
  const apiPrefix = process.env.API_PREFIX || 'api/v1';

  // ==========================================
  // Global configuration
  // ==========================================

  // CORS
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // API Versioning
  app.setGlobalPrefix(apiPrefix);

  // Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global filters & interceptors
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  // Serve uploaded files
  app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

  // Redirect old /admin to the React dashboard on port 3001
  app.use('/admin', (_req: any, res: any) => {
    res.redirect('http://localhost:3001/dashboard');
  });

  // ==========================================
  // Swagger / OpenAPI documentation
  // ==========================================
  const config = new DocumentBuilder()
    .setTitle('Hook API')
    .setDescription('Hook — q-commerce fashion marketplace backend API')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Authentication', 'Register, login, OTP, password management')
    .addTag('Products', 'Product listings, search, filtering')
    .addTag('Cart', 'Shopping cart management')
    .addTag('Orders', 'Order creation, tracking, history')
    .addTag('Payments', 'Payment initialization, verification, webhooks')
    .addTag('Negotiation', 'AI-powered price negotiation ("Last Price")')
    .addTag('Vendors', 'Vendor registration, management, tiers')
    .addTag('Logistics', 'EV driver assignment, tracking, delivery')
    .addTag('Categories', 'Product categories')
    .addTag('Field Agent', 'Field agent operations')
    .addTag('Booths', 'Phygital booth management')
    .addTag('Settlements', 'Vendor payouts, escrow, commissions')
    .addTag('Notifications', 'Email, SMS, push notifications')
    .addTag('Admin', 'Admin dashboard, user management, oversight')
    .addTag('Uploads', 'File uploads (images)')
    .addTag('Search', 'Search products & vendors')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  // ==========================================
  // Start server
  // ==========================================
  await app.listen(port);
  logger.log(`🚀 Hook API running on http://localhost:${port}/${apiPrefix}`);
  logger.log(`📚 Swagger docs on http://localhost:${port}/docs`);
}

bootstrap();
