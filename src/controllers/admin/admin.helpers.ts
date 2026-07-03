import { Request } from 'express';
import { AppDataSource } from '@config/data-source';
import { getPagination, paginated, routeParam } from '@lib/api-utils';
import { AdminAuditLog } from '@models/admin/admin-audit-log.model';
import { Booth } from '@models/booths/booth.model';
import { FieldAgent } from '@models/field-agents/field-agent.model';
import { Logistics } from '@models/logistics/logistics.model';
import { Negotiation } from '@models/negotiations/negotiation.model';
import { Order } from '@models/orders/order.model';
import { Payment } from '@models/payments/payment.model';
import { Product } from '@models/products/product.model';
import { Settlement } from '@models/settlements/settlement.model';
import { User } from '@models/users/user.model';
import { Vendor } from '@models/vendors/vendor.model';

export const adminRepos = {
  users: () => AppDataSource.getRepository(User),
  vendors: () => AppDataSource.getRepository(Vendor),
  products: () => AppDataSource.getRepository(Product),
  orders: () => AppDataSource.getRepository(Order),
  payments: () => AppDataSource.getRepository(Payment),
  logistics: () => AppDataSource.getRepository(Logistics),
  negotiations: () => AppDataSource.getRepository(Negotiation),
  settlements: () => AppDataSource.getRepository(Settlement),
  booths: () => AppDataSource.getRepository(Booth),
  fieldAgents: () => AppDataSource.getRepository(FieldAgent),
  auditLogs: () => AppDataSource.getRepository(AdminAuditLog),
};

export { getPagination, paginated, routeParam };

export function actor(req: Request) {
  return {
    performedBy: req.user!.sub,
    performedByEmail: req.user!.email,
    ipAddress: req.ip,
  };
}
