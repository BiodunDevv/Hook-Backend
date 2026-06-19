import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

// Modules
import { AuthModule } from '@modules/auth/auth.module';
import { ProductsModule } from '@modules/products/products.module';
import { CategoriesModule } from '@modules/categories/categories.module';
import { CartModule } from '@modules/cart/cart.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { PaymentsModule } from '@modules/payments/payments.module';
import { NegotiationModule } from '@modules/negotiation/negotiation.module';
import { LogisticsModule } from '@modules/logistics/logistics.module';
import { VendorsModule } from '@modules/vendors/vendors.module';
import { FieldAgentModule } from '@modules/field-agent/field-agent.module';
import { BoothsModule } from '@modules/booths/booths.module';
import { SettlementsModule } from '@modules/settlements/settlements.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { AdminModule } from '@modules/admin/admin.module';
import { UploadModule } from '@modules/upload/upload.module';
import { SearchModule } from '@modules/search/search.module';

// Integrations
import { PaystackModule } from '@integrations/paystack/paystack.module';
import { NombaModule } from '@integrations/nomba/nomba.module';
import { TermiiModule } from '@integrations/termii/termii.module';
import { SendGridModule } from '@integrations/sendgrid/sendgrid.module';
import { GoogleMapsModule } from '@integrations/google-maps/google-maps.module';

// Common
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { User } from '@modules/users/entities/user.entity';

@Module({
  imports: [
    // ==========================================
    // Global Config
    // ==========================================
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // ==========================================
    // Database
    // ==========================================
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isDev = config.get('NODE_ENV') === 'development';
        const dbType = config.get('DB_TYPE', 'postgres');

        // SQLite for local dev
        if (dbType === 'sqlite') {
          return {
            type: 'better-sqlite3',
            database: config.get('DB_DATABASE', 'data/hook_dev.sqlite'),
            autoLoadEntities: true,
            synchronize: true,
          };
        }

        // PostgreSQL for production (Neon)
        return {
          type: 'postgres',
          host: config.get('DB_HOST', 'localhost'),
          port: config.get<number>('DB_PORT', 5432),
          username: config.get('DB_USERNAME', 'hook_user'),
          password: config.get('DB_PASSWORD', ''),
          database: config.get('DB_DATABASE', 'hook_db'),
          ssl: config.get('DB_SSL') === 'true'
            ? { rejectUnauthorized: false }
            : false,
          autoLoadEntities: true,
          synchronize: isDev || config.get('DB_SYNCHRONIZE') === 'true',
          logging: isDev,
          extra: {
            max: 20,
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 30000,
          },
        };
      },
    }),

    // ==========================================
    // Scheduling (cron jobs)
    // ==========================================
    ScheduleModule.forRoot(),

    // ==========================================
    // Rate Limiting
    // ==========================================
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),

    // ==========================================
    // Feature Modules
    // ==========================================
    AuthModule,
    ProductsModule,
    CategoriesModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
    NegotiationModule,
    LogisticsModule,
    VendorsModule,
    FieldAgentModule,
    BoothsModule,
    SettlementsModule,
    NotificationsModule,
    AdminModule,
    UploadModule,
    SearchModule,

    // Integrations
    PaystackModule,
    NombaModule,
    TermiiModule,
    SendGridModule,
    GoogleMapsModule,
  ],

  providers: [
    // ==========================================
    // Global Guards
    // ==========================================
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
