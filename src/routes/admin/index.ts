import { Router } from 'express';
import { z } from 'zod';
import { AdminBoothsController } from '@controllers/admin/booths.controller';
import { AdminCategoriesController } from '@controllers/admin/categories.controller';
import { AdminDashboardController } from '@controllers/admin/dashboard.controller';
import { AdminDispatchController } from '@controllers/admin/dispatch.controller';
import { AdminFieldAgentsController } from '@controllers/admin/field-agents.controller';
import { AdminFinancialsController } from '@controllers/admin/financials.controller';
import { AdminNegotiationsController } from '@controllers/admin/negotiations.controller';
import { AdminOrdersController } from '@controllers/admin/orders.controller';
import { AdminOperationsController } from '@controllers/admin/operations.controller';
import { AdminSearchController } from '@controllers/admin/search.controller';
import { AdminProductsController } from '@controllers/admin/products.controller';
import { AdminReportsController } from '@controllers/admin/reports.controller';
import { AdminSettingsController } from '@controllers/admin/settings.controller';
import { AdminStaffController } from '@controllers/admin/staff.controller';
import { AdminUsersController } from '@controllers/admin/users.controller';
import { AdminVendorsController } from '@controllers/admin/vendors.controller';
import { createAdminAuthRouter } from '@controllers/admin/admin-auth.controller';
import { requireAuth } from '@middleware/auth';
import { requireAdmin, requireSuperAdmin } from '@middleware/roles';
import { requirePermission } from '@middleware/permissions';
import { validateBody } from '@middleware/validate';
import {
  adminUserSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  staffCategoriesSchema,
  staffCreateSchema,
  staffPermissionsSchema,
  staffUpdateSchema,
  adminAssignDriverSchema,
  adminBoothCreateSchema,
  adminDriverCreateSchema,
  adminOrderCreateSchema,
  adminOrderUpdateSchema,
  adminProductCreateSchema,
  adminProductUpdateSchema,
  adminVendorCreateSchema,
  adminVendorUpdateSchema,
  orderStatusSchema,
  operationalStateAssignSchema,
  operationalStateToggleSchema,
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
  const dashboard   = new AdminDashboardController();
  const users       = new AdminUsersController();
  const vendors     = new AdminVendorsController();
  const products    = new AdminProductsController();
  const orders      = new AdminOrdersController();
  const dispatch    = new AdminDispatchController();
  const fieldAgents = new AdminFieldAgentsController();
  const booths      = new AdminBoothsController();
  const financials  = new AdminFinancialsController();
  const negotiations = new AdminNegotiationsController();
  const reports     = new AdminReportsController();
  const settings    = new AdminSettingsController();
  const staff       = new AdminStaffController();
  const search      = new AdminSearchController();
  const categories  = new AdminCategoriesController();
  const operations  = new AdminOperationsController();

  // ── Public admin auth (no token required) ──────────────────────────────
  router.use('/auth', createAdminAuthRouter());

  // ── All routes below require a valid admin token ───────────────────────
  router.use(requireAuth, requireAdmin);

  // ── Search (permission-scoped — controller reads user from req) ────────
  router.get('/search', asyncHandler(search.global));

  // ── Dashboard & analytics (all admin roles) ────────────────────────────
  router.get('/dashboard', asyncHandler(dashboard.dashboard));
  router.get('/analytics',  asyncHandler(dashboard.analytics));
  router.get('/health',     asyncHandler(dashboard.health));

  // ── Operations catalog (Nigeria-first operating states) ───────────────
  router.get('/operations/states', asyncHandler(operations.listStates));
  router.patch('/operations/states/:code', requireSuperAdmin, validateBody(operationalStateToggleSchema), asyncHandler(operations.setStateStatus));
  router.post('/operations/states/reset', requireSuperAdmin, asyncHandler(operations.resetCatalog));

  // ── Users / Customers ──────────────────────────────────────────────────
  router.get('/users',             requirePermission('customers.view'), asyncHandler(users.list));
  router.get('/customers',         requirePermission('customers.view'), asyncHandler(users.customers));
  router.get('/users/:id',         requirePermission('customers.view'), asyncHandler(users.detail));
  router.post('/users',            requireSuperAdmin, validateBody(adminUserSchema), asyncHandler(users.create));
  router.patch('/users/:id/toggle', requirePermission('customers.edit'), asyncHandler(users.toggle));
  router.patch('/users/:id/role',  requireSuperAdmin, validateBody(roleSchema), asyncHandler(users.role));

  // ── Staff management (super_admin only) ────────────────────────────────
  router.get('/staff',                   requireSuperAdmin, asyncHandler(staff.list));
  router.post('/staff',                  requireSuperAdmin, validateBody(staffCreateSchema), asyncHandler(staff.create));
  router.get('/staff/:id',               requireSuperAdmin, asyncHandler(staff.detail));
  router.patch('/staff/:id',             requireSuperAdmin, validateBody(staffUpdateSchema), asyncHandler(staff.update));
  router.patch('/staff/:id/permissions', requireSuperAdmin, validateBody(staffPermissionsSchema), asyncHandler(staff.updatePermissions));
  router.patch('/staff/:id/categories',  requireSuperAdmin, validateBody(staffCategoriesSchema), asyncHandler(staff.updateCategories));
  router.patch('/staff/:id/toggle',      requireSuperAdmin, asyncHandler(staff.toggle));
  router.delete('/staff/:id',            requireSuperAdmin, asyncHandler(staff.remove));

  // ── Vendors ────────────────────────────────────────────────────────────
  router.get('/vendors',             requirePermission('vendors.view'),   asyncHandler(vendors.list));
  router.get('/vendors/stats',       requirePermission('vendors.view'),   asyncHandler(vendors.stats));
  router.post('/vendors',            requireSuperAdmin, validateBody(adminVendorCreateSchema), asyncHandler(vendors.create));
  router.get('/vendors/:id',         requirePermission('vendors.view'),   asyncHandler(vendors.detail));
  router.patch('/vendors/:id',       requirePermission('vendors.edit'),   validateBody(adminVendorUpdateSchema), asyncHandler(vendors.update));
  router.patch('/vendors/:id/approve', requirePermission('vendors.approve'), asyncHandler(vendors.approve));
  router.patch('/vendors/:id/reject',  requirePermission('vendors.approve'), validateBody(z.object({ reason: z.string().optional() })), asyncHandler(vendors.reject));
  router.patch('/vendors/:id/tier',    requireSuperAdmin, validateBody(vendorTierSchema), asyncHandler(vendors.tier));
  router.patch('/vendors/:id/toggle',  requirePermission('vendors.edit'), asyncHandler(vendors.toggle));

  // ── Categories (taxonomy managed by super_admin, viewable with products.view) ──
  router.get('/categories',              requirePermission('products.view'), asyncHandler(categories.list));
  router.post('/categories',             requireSuperAdmin, validateBody(categoryCreateSchema), asyncHandler(categories.create));
  router.get('/categories/:id',          requirePermission('products.view'), asyncHandler(categories.detail));
  router.patch('/categories/:id',        requireSuperAdmin, validateBody(categoryUpdateSchema), asyncHandler(categories.update));
  router.patch('/categories/:id/toggle', requireSuperAdmin, asyncHandler(categories.toggle));
  router.delete('/categories/:id',       requireSuperAdmin, asyncHandler(categories.remove));

  // ── Products ───────────────────────────────────────────────────────────
  router.get('/products/review', requirePermission('products.review'), asyncHandler(products.reviewQueue));
  router.get('/products/stats',  requirePermission('products.view'),   asyncHandler(products.stats));
  router.get('/products',        requirePermission('products.view'),   asyncHandler(products.list));
  router.post('/products',       requireSuperAdmin, validateBody(adminProductCreateSchema), asyncHandler(products.create));
  router.get('/products/:id',    requirePermission('products.view'),   asyncHandler(products.detail));
  router.patch('/products/:id',  requirePermission('products.edit'),   validateBody(adminProductUpdateSchema), asyncHandler(products.update));
  router.patch('/products/:id/review',  requirePermission('products.review'), validateBody(productReviewSchema), asyncHandler(products.review));
  router.patch('/products/:id/disable', requirePermission('products.edit'),   asyncHandler(products.disable));

  // ── Orders ─────────────────────────────────────────────────────────────
  router.get('/orders/stats',              requirePermission('orders.view'),   asyncHandler(orders.stats));
  router.get('/orders',                    requirePermission('orders.view'),   asyncHandler(orders.list));
  router.post('/orders',                   requirePermission('orders.create'), validateBody(adminOrderCreateSchema), asyncHandler(orders.create));
  router.get('/orders/:id',               requirePermission('orders.view'),   asyncHandler(orders.detail));
  router.patch('/orders/:id',             requirePermission('orders.edit'),   validateBody(adminOrderUpdateSchema), asyncHandler(orders.update));
  router.patch('/orders/:id/status',      requirePermission('orders.edit'),   validateBody(orderStatusSchema), asyncHandler(orders.status));
  router.patch('/orders/:id/assign-driver', requirePermission('orders.edit'), validateBody(adminAssignDriverSchema), asyncHandler(orders.assignDriver));

  // ── Dispatch / Drivers ────────────────────────────────────────────────
  router.get('/dispatch/active',           requirePermission('drivers.view'), asyncHandler(dispatch.active));
  router.get('/dispatch/drivers/stats',    requirePermission('drivers.view'), asyncHandler(dispatch.driverStats));
  router.get('/dispatch',                  requirePermission('drivers.view'), asyncHandler(dispatch.list));
  router.get('/dispatch/drivers',          requirePermission('drivers.view'), asyncHandler(dispatch.drivers));
  router.post('/dispatch/drivers',         requirePermission('drivers.edit'), validateBody(adminDriverCreateSchema), asyncHandler(dispatch.createDriver));
  router.get('/dispatch/drivers/:id',      requirePermission('drivers.view'), asyncHandler(dispatch.driverDetail));
  router.patch('/dispatch/drivers/:id/toggle', requirePermission('drivers.edit'), asyncHandler(dispatch.toggleDriver));

  // ── Field Agents ──────────────────────────────────────────────────────
  router.get('/field-agents',         requirePermission('field_agents.view'), asyncHandler(fieldAgents.list));
  router.get('/field-agents/stats',   requirePermission('field_agents.view'), asyncHandler(fieldAgents.stats));
  router.get('/field-agents/queue',   requirePermission('field_agents.view'), asyncHandler(fieldAgents.queue));
  router.get('/field-agents/:id',     requirePermission('field_agents.view'), asyncHandler(fieldAgents.detail));
  router.patch('/field-agents/:id/toggle', requirePermission('field_agents.view'), asyncHandler(fieldAgents.toggle));
  router.patch('/field-agents/:id/state', requirePermission('field_agents.view'), validateBody(operationalStateAssignSchema), asyncHandler(fieldAgents.setState));

  // ── Booths ─────────────────────────────────────────────────────────────
  router.get('/booths',           requirePermission('booths.view'), asyncHandler(booths.list));
  router.get('/booths/analytics', requirePermission('booths.view'), asyncHandler(booths.analytics));
  router.get('/booths/:id',       requirePermission('booths.view'), asyncHandler(booths.detail));
  router.post('/booths',          requirePermission('booths.edit'), validateBody(adminBoothCreateSchema), asyncHandler(booths.create));
  router.patch('/booths/:id/status', requirePermission('booths.edit'), asyncHandler(booths.status));

  // ── Financials (view gated by permission, write stays super_admin) ─────
  router.get('/financials',                    requirePermission('financials.view'), asyncHandler(financials.dashboard));
  router.get('/financials/settlements',        requirePermission('financials.view'), asyncHandler(financials.settlements));
  router.get('/financials/settlements/:id',    requirePermission('financials.view'), asyncHandler(financials.settlementDetail));
  router.post('/financials/settlements/trigger/:vendorId', requireSuperAdmin, validateBody(settlementTriggerSchema), asyncHandler(financials.trigger));
  router.get('/financials/audit-logs',         requireSuperAdmin, asyncHandler(financials.audit));

  // ── Negotiations ──────────────────────────────────────────────────────
  router.get('/negotiations',    requirePermission('ai_negotiation.view'), asyncHandler(negotiations.list));
  router.get('/negotiations/:id', requirePermission('ai_negotiation.view'), asyncHandler(negotiations.detail));

  // ── Reports ───────────────────────────────────────────────────────────
  router.get('/reports',     requirePermission('reports.view'), asyncHandler(reports.list));
  router.post('/reports/generate', requirePermission('reports.view'), validateBody(reportSchema), asyncHandler(reports.generate));
  router.get('/reports/:id', requirePermission('reports.view'), asyncHandler(reports.detail));

  // ── Settings ──────────────────────────────────────────────────────────
  router.get('/settings',    requirePermission('settings.view'), asyncHandler(settings.get));
  router.patch('/settings',  requireSuperAdmin, validateBody(settingsSchema), asyncHandler(settings.update));

  return router;
}
