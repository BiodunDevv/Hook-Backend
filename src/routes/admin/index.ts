import { Router } from "express";
import { AdminCategoriesController } from "@controllers/admin/categories.controller";
import { AdminDashboardController } from "@controllers/admin/dashboard.controller";
import { AdminFieldAgentsController } from "@controllers/admin/field-agents.controller";
import { AdminFinancialsController } from "@controllers/admin/financials.controller";
import { AdminNegotiationsController } from "@controllers/admin/negotiations.controller";
import { AdminOrdersController } from "@controllers/admin/orders.controller";
import { AdminOperationsController } from "@controllers/admin/operations.controller";
import { AdminSearchController } from "@controllers/admin/search.controller";
import { AdminProductsController } from "@controllers/admin/products.controller";
import { AdminReportsController } from "@controllers/admin/reports.controller";
import { AdminSettingsController } from "@controllers/admin/settings.controller";
import { AdminUsersController } from "@controllers/admin/users.controller";
import { AdminCommerceController } from "@controllers/admin/commerce.controller";
import { AdminCatalogReviewController } from "@controllers/admin/catalog-review.controller";
import { AdminCommercialCatalogController } from "@controllers/admin/commercial-catalog.controller";
import { PhaseFourCommerceController } from "@controllers/admin/phase-four-commerce.controller";
import { createAdminAuthRouter } from "@controllers/admin/admin-auth.controller";
import { createPlatformAdminRouter } from "./platform";
import { requireAuth } from "@middleware/auth";
import { platformContext } from "@middleware/platform-context";
import { requireAdmin, requireSuperAdmin } from "@middleware/roles";
import { requirePermission } from "@middleware/permissions";
import { validateBody } from "@middleware/validate";
import {
  adminUserSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  adminProductCreateSchema,
  adminProductUpdateSchema,
  operationalStateAssignSchema,
  operationalStateToggleSchema,
  productReviewSchema,
  reportSchema,
  roleSchema,
  settingsSchema,
  adminRefundReviewSchema,
  deletionUpdateSchema,
  refundSchema,
} from "@validations/common.schemas";
import {
  commercialProductSchema,
  lifecycleReasonSchema,
  negotiationRulesSchema,
  pricingSchema,
  reviewReasonSchema,
  reviewStartSchema,
} from "@validations/catalog.schemas";
import { asyncHandler } from "@utils/http";
import {
  commerceSettingsSchema,
  podCallSchema,
  podDecisionSchema,
  podOverrideSchema,
} from "@validations/commerce.schemas";
import { z } from "zod";
import { FulfilmentController } from "@controllers/fulfilment.controller";
import { AdminNotificationsController } from "@controllers/admin/notifications.controller";
import { AdminDeliveryController } from "@controllers/admin/delivery.controller";

export function createAdminRouter() {
  const router = Router();
  const dashboard = new AdminDashboardController();
  const users = new AdminUsersController();
  const products = new AdminProductsController();
  const orders = new AdminOrdersController();
  const runners = new AdminFieldAgentsController();
  const financials = new AdminFinancialsController();
  const negotiations = new AdminNegotiationsController();
  const reports = new AdminReportsController();
  const settings = new AdminSettingsController();
  const search = new AdminSearchController();
  const categories = new AdminCategoriesController();
  const operations = new AdminOperationsController();
  const commerce = new AdminCommerceController();
  const catalogReview = new AdminCatalogReviewController();
  const commercial = new AdminCommercialCatalogController();
  const phaseFour = new PhaseFourCommerceController();
  const fulfilment = new FulfilmentController();
  const notifications = new AdminNotificationsController();
  const delivery = new AdminDeliveryController();

  // ── Public admin auth (no token required) ──────────────────────────────
  router.use("/auth", createAdminAuthRouter());

  // ── All routes below require a valid admin token ───────────────────────
  router.use(requireAuth, requireAdmin);
  router.use(platformContext);
  router.use("/", createPlatformAdminRouter());

  // The customer notification route is intentionally customer/guest scoped.
  // Keep staff notifications on an explicit admin path so the Admin shell
  // never presents a customer identity to the API.
  router.get("/notifications", asyncHandler(notifications.list));

  // ── Search (permission-scoped — controller reads user from req) ────────
  router.get("/search", asyncHandler(search.global));

  // ── Dashboard & analytics (all admin roles) ────────────────────────────
  router.get("/dashboard", asyncHandler(dashboard.dashboard));
  router.get("/analytics", asyncHandler(dashboard.analytics));
  router.get("/health", asyncHandler(dashboard.health));

  // ── Operations catalog (Nigeria-first operating states) ───────────────
  router.get("/operations/states", asyncHandler(operations.listStates));
  router.patch(
    "/operations/states/:code",
    requireSuperAdmin,
    validateBody(operationalStateToggleSchema),
    asyncHandler(operations.setStateStatus),
  );
  router.post(
    "/operations/states/reset",
    requireSuperAdmin,
    asyncHandler(operations.resetCatalog),
  );

  // ── Users / Customers ──────────────────────────────────────────────────
  router.get(
    "/users",
    requirePermission("customers.view"),
    asyncHandler(users.list),
  );
  router.get(
    "/customers",
    requirePermission("customers.view"),
    asyncHandler(users.customers),
  );
  router.get(
    "/users/:id",
    requirePermission("customers.view"),
    asyncHandler(users.detail),
  );
  router.post(
    "/users",
    requireSuperAdmin,
    validateBody(adminUserSchema),
    asyncHandler(users.create),
  );
  router.patch(
    "/users/:id/toggle",
    requirePermission("customers.edit"),
    asyncHandler(users.toggle),
  );
  router.patch(
    "/users/:id/role",
    requireSuperAdmin,
    validateBody(roleSchema),
    asyncHandler(users.role),
  );

  // ── Categories (taxonomy managed through explicit catalog permissions) ──
  router.get(
    "/categories",
    requirePermission("categories.view"),
    asyncHandler(categories.list),
  );
  router.post(
    "/categories",
    requirePermission("categories.manage"),
    validateBody(categoryCreateSchema),
    asyncHandler(categories.create),
  );
  router.get(
    "/categories/:id",
    requirePermission("categories.view"),
    asyncHandler(categories.detail),
  );
  router.patch(
    "/categories/:id",
    requirePermission("categories.manage"),
    validateBody(categoryUpdateSchema),
    asyncHandler(categories.update),
  );
  router.patch(
    "/categories/:id/toggle",
    requirePermission("categories.manage"),
    asyncHandler(categories.toggle),
  );
  router.delete(
    "/categories/:id",
    requirePermission("categories.manage"),
    asyncHandler(categories.remove),
  );

  // ── Products ───────────────────────────────────────────────────────────
  router.get(
    "/catalog/review/dashboard",
    requirePermission("catalog.submission.view"),
    asyncHandler(catalogReview.dashboard),
  );
  router.get(
    "/catalog/review",
    requirePermission("catalog.submission.view"),
    asyncHandler(catalogReview.list),
  );
  router.get(
    "/catalog/review/:id",
    requirePermission("catalog.submission.view"),
    asyncHandler(catalogReview.detail),
  );
  router.post(
    "/catalog/review/:id/start",
    requirePermission("catalog.submission.review"),
    validateBody(reviewStartSchema),
    asyncHandler(catalogReview.start),
  );
  router.post(
    "/catalog/review/:id/request-changes",
    requirePermission("catalog.submission.request_changes"),
    validateBody(reviewReasonSchema),
    asyncHandler(catalogReview.requestChanges),
  );
  router.post(
    "/catalog/review/:id/approve",
    requirePermission("catalog.submission.approve"),
    validateBody(reviewReasonSchema),
    asyncHandler(catalogReview.approve),
  );
  router.post(
    "/catalog/review/:id/reject",
    requirePermission("catalog.submission.reject"),
    validateBody(reviewReasonSchema),
    asyncHandler(catalogReview.reject),
  );

  router.get(
    "/commercial/dashboard",
    requirePermission("catalog.product.view"),
    asyncHandler(commercial.dashboard),
  );
  router.get(
    "/commercial/products",
    requirePermission("catalog.product.view"),
    asyncHandler(commercial.list),
  );
  router.get(
    "/commercial/products/:id",
    requirePermission("catalog.product.view"),
    asyncHandler(commercial.detail),
  );
  router.get(
    "/commercial/products/:id/preview",
    requirePermission("catalog.product.view"),
    asyncHandler(commercial.preview),
  );
  router.patch(
    "/commercial/products/:id",
    requirePermission("catalog.product.edit"),
    validateBody(commercialProductSchema),
    asyncHandler(commercial.update),
  );
  router.patch(
    "/commercial/products/:id/pricing",
    requirePermission("catalog.pricing.edit"),
    validateBody(pricingSchema),
    asyncHandler(commercial.pricing),
  );
  router.patch(
    "/commercial/products/:id/negotiation-rules",
    requirePermission("catalog.negotiation_rules.edit"),
    validateBody(negotiationRulesSchema),
    asyncHandler(commercial.rules),
  );
  router.post(
    "/commercial/products/:id/publish",
    requirePermission("catalog.product.publish"),
    validateBody(lifecycleReasonSchema),
    asyncHandler(commercial.publish),
  );
  router.post(
    "/commercial/products/:id/pause",
    requirePermission("catalog.product.pause"),
    validateBody(lifecycleReasonSchema),
    asyncHandler(commercial.pause),
  );
  router.post(
    "/commercial/products/:id/unpublish",
    requirePermission("catalog.product.unpublish"),
    validateBody(lifecycleReasonSchema),
    asyncHandler(commercial.unpublish),
  );
  router.post(
    "/commercial/products/:id/availability-unconfirmed",
    requirePermission("catalog.product.pause"),
    validateBody(lifecycleReasonSchema),
    asyncHandler(commercial.availabilityUnconfirmed),
  );

  router.get(
    "/products/review",
    requirePermission("products.review"),
    asyncHandler(products.reviewQueue),
  );
  router.get(
    "/products/stats",
    requirePermission("products.view"),
    asyncHandler(products.stats),
  );
  router.get(
    "/products",
    requirePermission("products.view"),
    asyncHandler(products.list),
  );
  router.post(
    "/products",
    requireSuperAdmin,
    validateBody(adminProductCreateSchema),
    asyncHandler(products.create),
  );
  router.get(
    "/products/:id",
    requirePermission("products.view"),
    asyncHandler(products.detail),
  );
  router.patch(
    "/products/:id",
    requirePermission("products.edit"),
    validateBody(adminProductUpdateSchema),
    asyncHandler(products.update),
  );
  router.patch(
    "/products/:id/review",
    requirePermission("products.review"),
    validateBody(productReviewSchema),
    asyncHandler(products.review),
  );
  router.patch(
    "/products/:id/disable",
    requirePermission("products.edit"),
    asyncHandler(products.disable),
  );

  // ── Orders ─────────────────────────────────────────────────────────────
  router.get(
    "/orders/stats",
    requirePermission("orders.view"),
    asyncHandler(orders.stats),
  );
  router.get(
    "/orders",
    requirePermission("orders.view"),
    asyncHandler(orders.list),
  );
  // Phase 4 Orders are created only by the Checkout service.
  router.get(
    "/orders/:id",
    requirePermission("orders.view"),
    asyncHandler(orders.detail),
  );
  router.get(
    "/commerce/pod",
    requirePermission("commerce.pod.review"),
    asyncHandler(phaseFour.podQueue),
  );
  router.post(
    "/commerce/pod/:id/calls",
    requirePermission("commerce.pod.review"),
    validateBody(podCallSchema),
    asyncHandler(phaseFour.recordCall),
  );
  router.post(
    "/commerce/pod/:id/decision",
    requirePermission("commerce.pod.review"),
    validateBody(podDecisionSchema),
    asyncHandler(phaseFour.decide),
  );
  router.post(
    "/commerce/pod/:id/override",
    requireSuperAdmin,
    validateBody(podOverrideSchema),
    asyncHandler(phaseFour.override),
  );
  router.post(
    "/commerce/customers/:id/pod-eligibility/restore",
    requirePermission("commerce.pod.eligibility"),
    validateBody(z.object({ reason: z.string().min(10).max(1000) }).strict()),
    asyncHandler(phaseFour.restoreEligibility),
  );
  router.get(
    "/commerce/payments",
    requirePermission("commerce.payments.view"),
    asyncHandler(phaseFour.payments),
  );
  router.get(
    "/commerce/integration-exceptions",
    requirePermission("commerce.payments.reconcile"),
    asyncHandler(phaseFour.exceptions),
  );
  router.get(
    "/commerce/outbox",
    requirePermission("commerce.outbox.view"),
    asyncHandler(phaseFour.outbox),
  );
  router.get(
    "/commerce/settings",
    requireSuperAdmin,
    asyncHandler(phaseFour.settings),
  );
  router.patch(
    "/commerce/settings",
    requireSuperAdmin,
    validateBody(commerceSettingsSchema),
    asyncHandler(phaseFour.updateSettings),
  );

  // ── Phase 5 fulfilment, Hub, logistics, returns and refunds ───────────
  router.get('/fulfilment/control-tower', requirePermission('fulfilment.view'), asyncHandler(fulfilment.controlTower));
  router.get('/fulfilment/tasks/:id', requirePermission('fulfilment.view'), asyncHandler(fulfilment.adminTaskDetail));
  router.get('/fulfilment/runners', requirePermission('fulfilment.assign'), asyncHandler(fulfilment.assignmentRunners));
  router.get('/fulfilment/hubs', requirePermission('fulfilment.assign'), asyncHandler(fulfilment.assignmentHubs));
  router.post('/fulfilment/tasks/:id/reassign', requirePermission('fulfilment.assign'), validateBody(z.object({ runnerId: z.string().min(1), hubId: z.string().min(1), version: z.coerce.number().int().positive(), reason: z.string().min(3).max(1000) }).strict()), asyncHandler(fulfilment.reassignTask));
  router.get('/fulfilment/exceptions', requirePermission('fulfilment.view'), asyncHandler(fulfilment.adminExceptions));
  router.patch('/fulfilment/exceptions/:id', requirePermission('fulfilment.resolve'), validateBody(z.object({ status: z.enum(['IN_PROGRESS', 'RESOLVED', 'DISMISSED']), reason: z.string().min(3).max(1000) }).strict()), asyncHandler(fulfilment.resolveException));
  router.get('/fulfilment/hub', requirePermission('fulfilment.hub.view'), asyncHandler(fulfilment.hubDashboard));
  router.get('/fulfilment/consolidations', requirePermission('fulfilment.hub.view'), asyncHandler(fulfilment.adminConsolidations));
  router.post('/fulfilment/packages/:id/receive', requirePermission('fulfilment.hub.receive'), validateBody(z.object({ hubId: z.string().min(1), scanCredential: z.string().regex(/^\d{6}$/), idempotencyKey: z.string().min(8), stateId: z.string().optional(), evidence: z.array(z.object({ type: z.string().min(1), url: z.string().url().optional(), assetId: z.string().optional(), note: z.string().max(500).optional() })).optional() }).strict()), asyncHandler(fulfilment.receivePackage));
  router.post('/fulfilment/packages/:id/qc', requirePermission('fulfilment.hub.qc'), validateBody(z.object({ version: z.coerce.number().int().positive().optional(), passed: z.boolean(), checks: z.array(z.record(z.string(), z.unknown())).default([]) }).strict()), asyncHandler(fulfilment.qualityCheck));
  router.post('/fulfilment/orders/:id/consolidate', requirePermission('fulfilment.consolidate'), validateBody(z.object({ hubId: z.string().min(1) }).strict()), asyncHandler(fulfilment.consolidate));
  router.post('/fulfilment/consolidations/:id/seal', requirePermission('fulfilment.consolidate'), validateBody(z.object({ version: z.coerce.number().int().positive().optional(), weightGrams: z.number().positive().optional(), dimensions: z.object({ lengthCm: z.number().positive(), widthCm: z.number().positive(), heightCm: z.number().positive() }).optional(), sealReference: z.string().max(100).optional() }).strict()), asyncHandler(fulfilment.sealConsolidation));
  router.get('/fulfilment/shipments', requirePermission('logistics.view'), asyncHandler(fulfilment.adminShipments));
  router.get('/fulfilment/logistics/readiness', requirePermission('logistics.view'), asyncHandler(fulfilment.logisticsReadiness));
  router.post('/fulfilment/orders/:id/shipments', requirePermission('logistics.book'), validateBody(z.object({ provider: z.enum(['manual', 'simulated', 'gig', 'fez', 'other']), hubId: z.string().min(1), serviceName: z.string().max(100).optional(), externalReference: z.string().max(160).optional(), trackingNumber: z.string().max(160).optional(), estimatedDeliveryAt: z.string().datetime().optional(), providerCostMinor: z.number().int().nonnegative().optional(), providerQuoteMinor: z.number().int().nonnegative().optional(), idempotencyKey: z.string().min(8), evidence: z.array(z.object({ type: z.string().min(1), url: z.string().url().optional(), assetId: z.string().optional(), note: z.string().max(500).optional() })).optional() }).strict()), asyncHandler(fulfilment.createShipment));
  router.patch('/fulfilment/shipments/:id', requirePermission('logistics.manage'), validateBody(z.object({ status: z.string().min(1), version: z.coerce.number().int().positive().optional(), note: z.string().max(500).optional() }).strict()), asyncHandler(fulfilment.updateShipment));
  router.get('/fulfilment/returns', requirePermission('returns.view'), asyncHandler(fulfilment.adminReturns));
  router.patch('/fulfilment/returns/:id/review', requirePermission('returns.review'), validateBody(z.object({ decision: z.enum(['APPROVED', 'REJECTED']), reason: z.string().min(3).max(1000) }).strict()), asyncHandler(fulfilment.adminReturnReview));
  router.get('/fulfilment/refunds', requirePermission('refunds.view'), asyncHandler(fulfilment.adminRefunds));
  router.post('/fulfilment/refunds', requirePermission('refunds.process'), validateBody(z.object({ orderId: z.string().min(1), returnRequestId: z.string().optional(), amountMinor: z.number().int().positive(), reason: z.string().min(3).max(1000), idempotencyKey: z.string().min(8) }).strict()), asyncHandler(fulfilment.adminRefund));
  router.post('/fulfilment/refunds/:id/process', requirePermission('finance.refunds.process'), validateBody(z.object({ idempotencyKey: z.string().min(8).optional(), reason: z.string().max(1000).optional() }).strict()), asyncHandler(fulfilment.adminRefundProcess));
  // ── Runners ───────────────────────────────────────────────────────────
  // The controller still reads legacy field-agent collections. The API and
  // active permission vocabulary are canonical for the current product.
  router.get(
    "/runners",
    requirePermission("runners.view"),
    asyncHandler(runners.list),
  );
  router.get(
    "/runners/stats",
    requirePermission("runners.view"),
    asyncHandler(runners.stats),
  );
  router.get(
    "/runners/queue",
    requirePermission("runners.view"),
    asyncHandler(runners.queue),
  );
  router.get(
    "/runners/:id",
    requirePermission("runners.view"),
    asyncHandler(runners.detail),
  );
  router.patch(
    "/runners/:id/toggle",
    requirePermission("runners.manage"),
    asyncHandler(runners.toggle),
  );
  router.patch(
    "/runners/:id/state",
    requirePermission("runners.manage"),
    validateBody(operationalStateAssignSchema),
    asyncHandler(runners.setState),
  );

  // ── Support operations ───────────────────────────────────────────────
  router.get(
    "/support/deletion-requests",
    requirePermission("deletions.view"),
    asyncHandler(commerce.deletionRequests),
  );
  router.patch(
    "/support/deletion-requests/:id",
    requirePermission("deletions.manage"),
    validateBody(deletionUpdateSchema),
    asyncHandler(commerce.updateDeletion),
  );
  router.get(
    "/analytics/checkout",
    requirePermission("analytics.checkout"),
    asyncHandler(commerce.checkoutAnalytics),
  );

  // ── Financials (view gated by permission, write stays super_admin) ─────
  router.get(
    "/financials",
    requirePermission("financials.view"),
    asyncHandler(financials.dashboard),
  );
  router.get(
    "/financials/audit-logs",
    requireSuperAdmin,
    asyncHandler(financials.audit),
  );
  router.get(
    "/financials/payments",
    requirePermission("financials.view"),
    asyncHandler(financials.payments),
  );
  router.get(
    "/financials/escrow-ledger",
    requirePermission("financials.view"),
    asyncHandler(financials.escrow),
  );
  router.get(
    "/financials/reconciliation",
    requirePermission("financials.reconcile"),
    asyncHandler(financials.reconciliation),
  );
  router.get(
    "/financials/refund-requests",
    requirePermission("refunds.view"),
    asyncHandler(commerce.refundRequests),
  );
  router.patch(
    "/financials/refund-requests/:id/review",
    requirePermission("refunds.manage"),
    validateBody(adminRefundReviewSchema),
    asyncHandler(commerce.reviewRefund),
  );
  router.post(
    "/financials/refund-requests/:id/approve",
    requireSuperAdmin,
    validateBody(refundSchema.pick({ reason: true })),
    asyncHandler(commerce.approveRefund),
  );
  router.post(
    "/financials/payments/:paymentId/refund",
    requireSuperAdmin,
    validateBody(refundSchema),
    asyncHandler(financials.refund),
  );

  // ── Negotiations ──────────────────────────────────────────────────────
  router.get(
    "/negotiations",
    requirePermission("ai_negotiation.view"),
    asyncHandler(negotiations.list),
  );
  router.get(
    "/negotiations/:id",
    requirePermission("ai_negotiation.view"),
    asyncHandler(negotiations.detail),
  );

  // ── Reports ───────────────────────────────────────────────────────────
  router.get(
    "/reports",
    requirePermission("reports.view"),
    asyncHandler(reports.list),
  );
  router.post(
    "/reports/generate",
    requirePermission("reports.view"),
    validateBody(reportSchema),
    asyncHandler(reports.generate),
  );
  router.get(
    "/reports/:id",
    requirePermission("reports.view"),
    asyncHandler(reports.detail),
  );

  // ── Settings ──────────────────────────────────────────────────────────
  router.get(
    "/settings",
    requirePermission("settings.view"),
    asyncHandler(settings.get),
  );
  router.patch(
    "/settings",
    requireSuperAdmin,
    validateBody(settingsSchema),
    asyncHandler(settings.update),
  );
  router.get('/settings/catalog-availability', requirePermission('catalog.availability.view'), asyncHandler(settings.catalogAvailability));
  router.patch('/settings/catalog-availability', requirePermission('catalog.availability.manage'), validateBody(z.object({ catalogAvailabilityCheckDays: z.coerce.number().int().min(1).max(30), reason: z.string().trim().min(3).max(500) }).strict()), asyncHandler(settings.updateCatalogAvailability));

  // ── Delivery coverage and fee rules ────────────────────────────────────
  router.get('/delivery', requirePermission('delivery.coverage.view'), asyncHandler(delivery.settings));
  router.get('/delivery/settings', requirePermission('delivery.coverage.view'), asyncHandler(delivery.settings));
  router.patch('/delivery/settings', requirePermission('delivery.pricing.manage'), validateBody(z.object({
    defaultDeliveryFeeMinor: z.number().int().nonnegative(),
    reason: z.string().trim().min(3).max(500).optional(),
  }).strict()), asyncHandler(delivery.updateSettings));
  router.get('/delivery/rules', requirePermission('delivery.pricing.view'), asyncHandler(delivery.listRules));
  router.post('/delivery/rules', requirePermission('delivery.pricing.manage'), validateBody(z.object({
    name: z.string().trim().min(2).max(120),
    scope: z.enum(['global', 'state', 'zone']),
    scopeId: z.string().min(1).optional(),
    mode: z.enum(['flat', 'per_km', 'distance_bands']),
    flatFeeMinor: z.number().int().nonnegative().optional(),
    baseFeeMinor: z.number().int().nonnegative().optional(),
    feePerKmMinor: z.number().int().nonnegative().optional(),
    fallbackFeeMinor: z.number().int().nonnegative().optional(),
    originHubId: z.string().min(1).optional(),
    bands: z.array(z.object({ upToKm: z.number().positive(), feeMinor: z.number().int().nonnegative() }).strict()).max(20).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    effectiveFrom: z.coerce.date().optional(),
    effectiveUntil: z.coerce.date().optional(),
    reason: z.string().trim().min(3).max(500).optional(),
  }).strict()), asyncHandler(delivery.createRule));
  router.patch('/delivery/rules/:id', requirePermission('delivery.pricing.manage'), validateBody(z.object({
    name: z.string().trim().min(2).max(120).optional(),
    scope: z.enum(['global', 'state', 'zone']).optional(),
    scopeId: z.string().min(1).optional(),
    mode: z.enum(['flat', 'per_km', 'distance_bands']).optional(),
    flatFeeMinor: z.number().int().nonnegative().optional(),
    baseFeeMinor: z.number().int().nonnegative().optional(),
    feePerKmMinor: z.number().int().nonnegative().optional(),
    fallbackFeeMinor: z.number().int().nonnegative().optional(),
    originHubId: z.string().min(1).optional(),
    bands: z.array(z.object({ upToKm: z.number().positive(), feeMinor: z.number().int().nonnegative() }).strict()).max(20).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    effectiveFrom: z.coerce.date().optional(),
    effectiveUntil: z.coerce.date().optional(),
    reason: z.string().trim().min(3).max(500).optional(),
  }).strict()), asyncHandler(delivery.updateRule));
  router.patch('/delivery/states/:id', requirePermission('delivery.coverage.manage'), validateBody(z.object({
    deliveryEnabled: z.boolean(),
    reason: z.string().trim().min(3).max(500).optional(),
  }).strict()), asyncHandler(delivery.toggleState));
  router.post('/delivery/locations/refresh', requirePermission('delivery.coverage.manage'), validateBody(z.object({
    reason: z.string().trim().min(3).max(500).optional(),
  }).strict()), asyncHandler(delivery.refreshLocations));
  router.post('/delivery/preview', requirePermission('delivery.pricing.preview'), validateBody(z.object({
    stateId: z.string().min(1),
    zoneId: z.string().min(1).optional(),
    coordinates: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  }).strict()), asyncHandler(delivery.preview));

  return router;
}
