import { Router } from 'express';
import { z } from 'zod';
import { AdminBoothsController } from '@controllers/admin/booths.controller';
import { AdminDashboardController } from '@controllers/admin/dashboard.controller';
import { AdminDispatchController } from '@controllers/admin/dispatch.controller';
import { AdminFieldAgentsController } from '@controllers/admin/field-agents.controller';
import { AdminFinancialsController } from '@controllers/admin/financials.controller';
import { AdminNegotiationsController } from '@controllers/admin/negotiations.controller';
import { AdminOrdersController } from '@controllers/admin/orders.controller';
import { AdminProductsController } from '@controllers/admin/products.controller';
import { AdminReportsController } from '@controllers/admin/reports.controller';
import { AdminSettingsController } from '@controllers/admin/settings.controller';
import { AdminUsersController } from '@controllers/admin/users.controller';
import { AdminVendorsController } from '@controllers/admin/vendors.controller';
import { createAdminAuthRouter } from '@controllers/admin/admin-auth.controller';
import { requireAuth } from '@middleware/auth';
import { requireAdmin, requireSuperAdmin } from '@middleware/roles';
import { validateBody } from '@middleware/validate';
import {
  adminUserSchema,
  orderStatusSchema,
  productReviewSchema,
  reportSchema,
  roleSchema,
  settingsSchema,
  settlementTriggerSchema,
  vendorTierSchema,
} from '@validations/common.schemas';
import { asyncHandler } from '@utils/http';

export function createAdminRouter() {
  const router = Router();
  const dashboard = new AdminDashboardController();
  const users = new AdminUsersController();
  const vendors = new AdminVendorsController();
  const products = new AdminProductsController();
  const orders = new AdminOrdersController();
  const dispatch = new AdminDispatchController();
  const fieldAgents = new AdminFieldAgentsController();
  const booths = new AdminBoothsController();
  const financials = new AdminFinancialsController();
  const negotiations = new AdminNegotiationsController();
  const reports = new AdminReportsController();
  const settings = new AdminSettingsController();

  router.use('/auth', createAdminAuthRouter());
  router.use(requireAuth, requireAdmin);

  router.get('/dashboard', asyncHandler(dashboard.dashboard));
  router.get('/analytics', asyncHandler(dashboard.analytics));
  router.get('/health', asyncHandler(dashboard.health));

  router.get('/users', asyncHandler(users.list));
  router.get('/customers', asyncHandler(users.customers));
  router.get('/users/:id', asyncHandler(users.detail));
  router.post('/users', requireSuperAdmin, validateBody(adminUserSchema), asyncHandler(users.create));
  router.patch('/users/:id/toggle', asyncHandler(users.toggle));
  router.patch('/users/:id/role', requireSuperAdmin, validateBody(roleSchema), asyncHandler(users.role));

  router.get('/vendors', asyncHandler(vendors.list));
  router.patch('/vendors/:id/approve', asyncHandler(vendors.approve));
  router.patch('/vendors/:id/reject', validateBody(z.object({ reason: z.string().optional() })), asyncHandler(vendors.reject));
  router.patch('/vendors/:id/tier', requireSuperAdmin, validateBody(vendorTierSchema), asyncHandler(vendors.tier));

  router.get('/products/review', asyncHandler(products.reviewQueue));
  router.get('/products', asyncHandler(products.list));
  router.patch('/products/:id/review', validateBody(productReviewSchema), asyncHandler(products.review));

  router.get('/orders', asyncHandler(orders.list));
  router.get('/orders/:id', asyncHandler(orders.detail));
  router.patch('/orders/:id/status', validateBody(orderStatusSchema), asyncHandler(orders.status));

  router.get('/dispatch/active', asyncHandler(dispatch.active));
  router.get('/dispatch', asyncHandler(dispatch.list));
  router.get('/dispatch/drivers', asyncHandler(dispatch.drivers));

  router.get('/field-agents', asyncHandler(fieldAgents.list));
  router.get('/field-agents/:id', asyncHandler(fieldAgents.detail));
  router.patch('/field-agents/:id/toggle', asyncHandler(fieldAgents.toggle));

  router.get('/booths', asyncHandler(booths.list));
  router.get('/booths/analytics', asyncHandler(booths.analytics));
  router.get('/booths/:id', asyncHandler(booths.detail));
  router.post('/booths', requireSuperAdmin, asyncHandler(booths.create));
  router.patch('/booths/:id/status', asyncHandler(booths.status));

  router.get('/financials', requireSuperAdmin, asyncHandler(financials.dashboard));
  router.get('/financials/settlements', requireSuperAdmin, asyncHandler(financials.settlements));
  router.post('/financials/settlements/trigger/:vendorId', requireSuperAdmin, validateBody(settlementTriggerSchema), asyncHandler(financials.trigger));
  router.get('/financials/audit-logs', requireSuperAdmin, asyncHandler(financials.audit));

  router.get('/negotiations', asyncHandler(negotiations.list));
  router.get('/negotiations/:id', asyncHandler(negotiations.detail));

  router.get('/reports', asyncHandler(reports.list));
  router.post('/reports/generate', validateBody(reportSchema), asyncHandler(reports.generate));

  router.get('/settings', asyncHandler(settings.get));
  router.patch('/settings', requireSuperAdmin, validateBody(settingsSchema), asyncHandler(settings.update));

  return router;
}
