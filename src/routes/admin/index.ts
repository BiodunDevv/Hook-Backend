import { Router } from 'express';
import { AdminCategoriesController } from '@controllers/admin/categories.controller';
import { AdminDashboardController } from '@controllers/admin/dashboard.controller';
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
import { AdminCommerceController } from '@controllers/admin/commerce.controller';
import { AdminCatalogReviewController } from '@controllers/admin/catalog-review.controller';
import { AdminCommercialCatalogController } from '@controllers/admin/commercial-catalog.controller';
import { createAdminAuthRouter } from '@controllers/admin/admin-auth.controller';
import { createPlatformAdminRouter } from './platform';
import { requireAuth } from '@middleware/auth';
import { platformContext } from '@middleware/platform-context';
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
  adminOrderCreateSchema,
  adminOrderUpdateSchema,
  adminProductCreateSchema,
  adminProductUpdateSchema,
  orderStatusSchema,
  operationalStateAssignSchema,
  operationalStateToggleSchema,
  productReviewSchema,
  reportSchema,
  roleSchema,
  settingsSchema,
  adminRefundReviewSchema,
  deletionUpdateSchema,
  refundSchema,
} from '@validations/common.schemas';
import {
  commercialProductSchema,
  lifecycleReasonSchema,
  negotiationRulesSchema,
  pricingSchema,
  reviewReasonSchema,
  reviewStartSchema,
} from '@validations/catalog.schemas';
import { asyncHandler } from '@utils/http';

export function createAdminRouter() {
  const router = Router();
  const dashboard   = new AdminDashboardController();
  const users       = new AdminUsersController();
  const products    = new AdminProductsController();
  const orders      = new AdminOrdersController();
  const runners     = new AdminFieldAgentsController();
  const financials  = new AdminFinancialsController();
  const negotiations = new AdminNegotiationsController();
  const reports     = new AdminReportsController();
  const settings    = new AdminSettingsController();
  const staff       = new AdminStaffController();
  const search      = new AdminSearchController();
  const categories  = new AdminCategoriesController();
  const operations  = new AdminOperationsController();
  const commerce    = new AdminCommerceController();
  const catalogReview = new AdminCatalogReviewController();
  const commercial = new AdminCommercialCatalogController();

  // ── Public admin auth (no token required) ──────────────────────────────
  router.use('/auth', createAdminAuthRouter());

  // ── All routes below require a valid admin token ───────────────────────
  router.use(requireAuth, requireAdmin);
  router.use(platformContext);
  router.use('/', createPlatformAdminRouter());

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

  // ── Categories (taxonomy managed by super_admin, viewable with products.view) ──
  router.get('/categories',              requirePermission('products.view'), asyncHandler(categories.list));
  router.post('/categories',             requireSuperAdmin, validateBody(categoryCreateSchema), asyncHandler(categories.create));
  router.get('/categories/:id',          requirePermission('products.view'), asyncHandler(categories.detail));
  router.patch('/categories/:id',        requireSuperAdmin, validateBody(categoryUpdateSchema), asyncHandler(categories.update));
  router.patch('/categories/:id/toggle', requireSuperAdmin, asyncHandler(categories.toggle));
  router.delete('/categories/:id',       requireSuperAdmin, asyncHandler(categories.remove));

  // ── Products ───────────────────────────────────────────────────────────
  router.get('/catalog/review/dashboard', requirePermission('catalog.submission.view'), asyncHandler(catalogReview.dashboard));
  router.get('/catalog/review', requirePermission('catalog.submission.view'), asyncHandler(catalogReview.list));
  router.get('/catalog/review/:id', requirePermission('catalog.submission.view'), asyncHandler(catalogReview.detail));
  router.post('/catalog/review/:id/start', requirePermission('catalog.submission.review'), validateBody(reviewStartSchema), asyncHandler(catalogReview.start));
  router.post('/catalog/review/:id/request-changes', requirePermission('catalog.submission.request_changes'), validateBody(reviewReasonSchema), asyncHandler(catalogReview.requestChanges));
  router.post('/catalog/review/:id/approve', requirePermission('catalog.submission.approve'), validateBody(reviewReasonSchema), asyncHandler(catalogReview.approve));
  router.post('/catalog/review/:id/reject', requirePermission('catalog.submission.reject'), validateBody(reviewReasonSchema), asyncHandler(catalogReview.reject));

  router.get('/commercial/dashboard', requirePermission('catalog.product.view'), asyncHandler(commercial.dashboard));
  router.get('/commercial/products', requirePermission('catalog.product.view'), asyncHandler(commercial.list));
  router.get('/commercial/products/:id', requirePermission('catalog.product.view'), asyncHandler(commercial.detail));
  router.get('/commercial/products/:id/preview', requirePermission('catalog.product.view'), asyncHandler(commercial.preview));
  router.patch('/commercial/products/:id', requirePermission('catalog.product.edit'), validateBody(commercialProductSchema), asyncHandler(commercial.update));
  router.patch('/commercial/products/:id/pricing', requirePermission('catalog.pricing.edit'), validateBody(pricingSchema), asyncHandler(commercial.pricing));
  router.patch('/commercial/products/:id/negotiation-rules', requirePermission('catalog.negotiation_rules.edit'), validateBody(negotiationRulesSchema), asyncHandler(commercial.rules));
  router.post('/commercial/products/:id/publish', requirePermission('catalog.product.publish'), validateBody(lifecycleReasonSchema), asyncHandler(commercial.publish));
  router.post('/commercial/products/:id/pause', requirePermission('catalog.product.pause'), validateBody(lifecycleReasonSchema), asyncHandler(commercial.pause));
  router.post('/commercial/products/:id/unpublish', requirePermission('catalog.product.unpublish'), validateBody(lifecycleReasonSchema), asyncHandler(commercial.unpublish));
  router.post('/commercial/products/:id/availability-unconfirmed', requirePermission('catalog.product.pause'), validateBody(lifecycleReasonSchema), asyncHandler(commercial.availabilityUnconfirmed));

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
  // ── Runners ───────────────────────────────────────────────────────────
  // The controller still reads legacy field-agent collections. The API and
  // active permission vocabulary are canonical for the current product.
  router.get('/runners',         requirePermission('runners.view'), asyncHandler(runners.list));
  router.get('/runners/stats',   requirePermission('runners.view'), asyncHandler(runners.stats));
  router.get('/runners/queue',   requirePermission('runners.view'), asyncHandler(runners.queue));
  router.get('/runners/:id',     requirePermission('runners.view'), asyncHandler(runners.detail));
  router.patch('/runners/:id/toggle', requirePermission('runners.manage'), asyncHandler(runners.toggle));
  router.patch('/runners/:id/state', requirePermission('runners.manage'), validateBody(operationalStateAssignSchema), asyncHandler(runners.setState));

  // ── Support operations ───────────────────────────────────────────────
  router.get('/support/deletion-requests', requirePermission('deletions.view'), asyncHandler(commerce.deletionRequests));
  router.patch('/support/deletion-requests/:id', requirePermission('deletions.manage'), validateBody(deletionUpdateSchema), asyncHandler(commerce.updateDeletion));
  router.get('/analytics/checkout', requirePermission('analytics.checkout'), asyncHandler(commerce.checkoutAnalytics));

  // ── Financials (view gated by permission, write stays super_admin) ─────
  router.get('/financials',                    requirePermission('financials.view'), asyncHandler(financials.dashboard));
  router.get('/financials/audit-logs',         requireSuperAdmin, asyncHandler(financials.audit));
  router.get('/financials/payments',           requirePermission('financials.view'), asyncHandler(financials.payments));
  router.get('/financials/escrow-ledger',      requirePermission('financials.view'), asyncHandler(financials.escrow));
  router.get('/financials/reconciliation',     requirePermission('financials.reconcile'), asyncHandler(financials.reconciliation));
  router.get('/financials/refund-requests', requirePermission('refunds.view'), asyncHandler(commerce.refundRequests));
  router.patch('/financials/refund-requests/:id/review', requirePermission('refunds.manage'), validateBody(adminRefundReviewSchema), asyncHandler(commerce.reviewRefund));
  router.post('/financials/refund-requests/:id/approve', requireSuperAdmin, validateBody(refundSchema.pick({ reason: true })), asyncHandler(commerce.approveRefund));
  router.post('/financials/payments/:paymentId/refund', requireSuperAdmin, validateBody(refundSchema), asyncHandler(financials.refund));

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
