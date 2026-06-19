import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '@modules/users/entities/user.entity';
import { Order } from '@modules/orders/entities/order.entity';
import { OrderItem } from '@modules/orders/entities/order-item.entity';
import { Product } from '@modules/products/entities/product.entity';
import { Vendor } from '@modules/vendors/entities/vendor.entity';
import { Payment } from '@modules/payments/entities/payment.entity';
import { Settlement } from '@modules/settlements/entities/settlement.entity';
import { Logistics } from '@modules/logistics/entities/logistics.entity';
import { Negotiation } from '@modules/negotiation/entities/negotiation.entity';
import { FieldAgent } from '@modules/field-agent/entities/field-agent.entity';
import { Booth } from '@modules/booths/entities/booth.entity';
import { AdminAuditLog } from './entities/admin-audit-log.entity';

// Controllers
import { DashboardController } from './controllers/dashboard.controller';
import { CustomersController } from './controllers/customers.controller';
import { VendorsController } from './controllers/vendors.controller';
import { OrdersController } from './controllers/orders.controller';
import { ProductsController } from './controllers/products.controller';
import { DriversController } from './controllers/drivers.controller';
import { FieldAgentsController } from './controllers/field-agents.controller';
import { BoothsController } from './controllers/booths.controller';
import { FinancialsController } from './controllers/financials.controller';
import { AINegotiationController } from './controllers/ai-negotiation.controller';
import { ReportsController } from './controllers/reports.controller';
import { SettingsController } from './controllers/settings.controller';

// Services
import { DashboardService } from './services/dashboard.service';
import { CustomersService } from './services/customers.service';
import { VendorsService } from './services/vendors.service';
import { OrdersService } from './services/orders.service';
import { ProductsService } from './services/products.service';
import { DriversService } from './services/drivers.service';
import { FieldAgentsService } from './services/field-agents.service';
import { BoothsAdminService } from './services/booths.service';
import { FinancialsService } from './services/financials.service';
import { AINegotiationService } from './services/ai-negotiation.service';
import { ReportsService } from './services/reports.service';
import { SettingsService } from './services/settings.service';
import { AuditLogService } from './services/audit-log.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User, Order, OrderItem, Product, Vendor,
      Payment, Settlement, Logistics, Negotiation,
      FieldAgent, Booth, AdminAuditLog,
    ]),
  ],
  controllers: [
    DashboardController,
    CustomersController,
    VendorsController,
    OrdersController,
    ProductsController,
    DriversController,
    FieldAgentsController,
    BoothsController,
    FinancialsController,
    AINegotiationController,
    ReportsController,
    SettingsController,
  ],
  providers: [
    DashboardService,
    CustomersService,
    VendorsService,
    OrdersService,
    ProductsService,
    DriversService,
    FieldAgentsService,
    BoothsAdminService,
    FinancialsService,
    AINegotiationService,
    ReportsService,
    SettingsService,
    AuditLogService,
  ],
  exports: [AuditLogService],
})
export class AdminModule {}
