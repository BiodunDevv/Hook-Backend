import 'reflect-metadata';
import dotenv from 'dotenv';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { AdminAuditLog } from '@models/admin/admin-audit-log.model';
import { Otp } from '@models/auth/otp.model';
import { Booth } from '@models/booths/booth.model';
import { CartItem } from '@models/cart/cart-item.model';
import { Cart } from '@models/cart/cart.model';
import { Category } from '@models/categories/category.model';
import { FieldAgent } from '@models/field-agents/field-agent.model';
import { Logistics } from '@models/logistics/logistics.model';
import { Negotiation } from '@models/negotiations/negotiation.model';
import { OrderItem } from '@models/orders/order-item.model';
import { Order } from '@models/orders/order.model';
import { Payment } from '@models/payments/payment.model';
import { Product } from '@models/products/product.model';
import { Settlement } from '@models/settlements/settlement.model';
import { User } from '@models/users/user.model';
import { Vendor } from '@models/vendors/vendor.model';

dotenv.config({ quiet: true });

const isSqlite = process.env.DB_TYPE === 'sqlite';
const isDevelopment = process.env.NODE_ENV === 'development';
const shouldLogQueries = process.env.DB_LOGGING === 'true';
const sqliteDatabase = process.env.DB_DATABASE || 'data/hook_dev.sqlite';

if (isSqlite) {
  mkdirSync(dirname(sqliteDatabase), { recursive: true });
}

export const dataSourceOptions: DataSourceOptions = isSqlite
  ? {
      type: 'better-sqlite3',
      database: sqliteDatabase,
      entities: [
        AdminAuditLog,
        Otp,
        Booth,
        Cart,
        CartItem,
        Category,
        FieldAgent,
        Logistics,
        Negotiation,
        Order,
        OrderItem,
        Payment,
        Product,
        Settlement,
        User,
        Vendor,
      ],
      synchronize: true,
      logging: shouldLogQueries,
    }
  : {
      type: 'postgres',
      url: process.env.DATABASE_URL || undefined,
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'hook_user',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_DATABASE || 'hook_db',
      ssl:
        process.env.DB_SSL === 'true' || process.env.DATABASE_URL?.includes('sslmode=require')
          ? { rejectUnauthorized: false }
          : false,
      entities: [
        AdminAuditLog,
        Otp,
        Booth,
        Cart,
        CartItem,
        Category,
        FieldAgent,
        Logistics,
        Negotiation,
        Order,
        OrderItem,
        Payment,
        Product,
        Settlement,
        User,
        Vendor,
      ],
      synchronize:
        process.env.DB_SYNCHRONIZE === 'true' || process.env.NODE_ENV === 'development',
      logging: shouldLogQueries,
      extra: {
        max: 20,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
      },
    };

export const AppDataSource = new DataSource(dataSourceOptions);
export default AppDataSource;

export async function initializeDatabase() {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  return AppDataSource;
}
