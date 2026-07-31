import { Router } from 'express';
import { z } from 'zod';
import { PlatformController } from '@controllers/admin/platform.controller';
import { validateBody } from '@middleware/validate';
import { asyncHandler } from '@utils/http';

const idList = z.array(z.string().min(1)).default([]);
const reason = z.string().trim().min(3).max(500).optional();
const status = z.enum(['active', 'inactive']).optional();
const coordinates = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional();
const lifecycleSchema = z.object({ reason: z.string().trim().min(3).max(500) });

const stateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().length(2),
  status,
  timezone: z.string().default('Africa/Lagos'),
  currency: z.string().length(3).default('NGN'),
  deliveryPromiseHours: z.number().int().positive().default(24),
  payAtHubEnabled: z.boolean().default(false),
  payAtHubLimitMinor: z.number().int().nonnegative().default(10000000),
  configuration: z.record(z.string(), z.unknown()).optional(),
  reason,
});
const citySchema = z.object({
  stateId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().min(2).max(12),
  status,
  defaultHubId: z.string().optional(),
  reason,
});
const zoneSchema = z.object({
  stateId: z.string().min(1),
  cityId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().min(2).max(16),
  status,
  areaRules: z.record(z.string(), z.unknown()).optional(),
  geometry: z.record(z.string(), z.unknown()).optional(),
  deliveryEligible: z.boolean().default(false),
  reason,
});
const marketSchema = z.object({
  name: z.string().trim().min(2).max(150),
  stateId: z.string().min(1),
  cityId: z.string().min(1),
  zoneId: z.string().optional(),
  hubId: z.string().optional(),
  address: z.string().trim().min(5).max(500),
  coordinates,
  operatingHours: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().max(1000).optional(),
  status,
  reason,
});
const hubSchema = z.object({
  name: z.string().trim().min(2).max(150),
  stateId: z.string().min(1),
  cityId: z.string().min(1),
  zoneIds: idList,
  address: z.string().trim().min(5).max(500),
  coordinates,
  capacity: z.record(z.string(), z.unknown()).optional(),
  operatingHours: z.record(z.string(), z.unknown()).optional(),
  cutoffRules: z.record(z.string(), z.unknown()).optional(),
  contact: z.record(z.string(), z.unknown()).optional(),
  marketIds: idList,
  staffIds: idList,
  status,
  reason,
});
const person = {
  email: z.string().email(),
  phone: z.string().trim().min(7).max(30),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  password: z.string().min(9).max(128).optional(),
};
const staffSchema = z.object({
  ...person,
  roleIds: z.array(z.string().min(1)).min(1),
  scopeType: z.enum(['global', 'multi_state', 'single_state', 'hub']),
  stateIds: idList,
  hubIds: idList,
});
const partnerSchema = z.object({
  ...person,
  name: z.string().trim().min(2).max(150),
  stateId: z.string().min(1),
  cityId: z.string().min(1),
  zoneId: z.string().optional(),
  address: z.string().trim().min(5).max(500),
  coordinates,
  contact: z.record(z.string(), z.unknown()),
  devicePolicy: z.record(z.string(), z.unknown()).optional(),
  reason,
});
const runnerSchema = z.object({
  ...person,
  stateIds: z.array(z.string().min(1)).min(1),
  hubIds: idList,
  availability: z.enum(['available', 'unavailable', 'paused']).optional(),
  reason,
});
const assignmentSchema = z.object({
  runnerId: z.string().min(1),
  marketId: z.string().min(1),
  preferredHubId: z.string().optional(),
  priority: z.number().int().positive().default(100),
  isPrimary: z.boolean().default(false),
  activeFrom: z.coerce.date(),
  activeTo: z.coerce.date().optional(),
  assignmentReason: z.string().trim().min(3).max(500),
});

function crud(
  router: Router,
  path: string,
  handlers: {
    list: any; create: any; detail: any; update: any; status?: any;
  },
  schema: z.ZodObject<any>,
) {
  router.get(path, asyncHandler(handlers.list));
  router.post(path, validateBody(schema), asyncHandler(handlers.create));
  router.get(`${path}/:id`, asyncHandler(handlers.detail));
  router.patch(`${path}/:id`, validateBody(schema.partial()), asyncHandler(handlers.update));
  if (handlers.status) {
    router.post(`${path}/:id/activate`, validateBody(lifecycleSchema), asyncHandler(handlers.status));
    router.post(`${path}/:id/deactivate`, validateBody(lifecycleSchema), asyncHandler(handlers.status));
  }
}

export function createPlatformAdminRouter() {
  const router = Router();
  const controller = new PlatformController();

  router.get('/permissions', asyncHandler(controller.permissions));
  router.get('/roles', asyncHandler(controller.roles));
  router.post('/roles', validateBody(z.object({
    key: z.string().min(3), name: z.string().min(2), description: z.string().default(''),
    permissionKeys: idList, defaultScopeType: z.enum(['global', 'multi_state', 'single_state', 'hub', 'self']),
    isSystem: z.boolean().default(false), isActive: z.boolean().default(true),
  })), asyncHandler(controller.createRole));
  router.get('/roles/:id', asyncHandler(controller.roleDetail));
  router.patch('/roles/:id', asyncHandler(controller.updateRole));

  router.get('/staff', asyncHandler(controller.listStaff));
  router.post('/staff', validateBody(staffSchema), asyncHandler(controller.createStaff));
  router.get('/staff/:id', asyncHandler(controller.staffDetail));
  router.patch('/staff/:id', asyncHandler(controller.updateStaff));
  router.post('/staff/:id/suspend', validateBody(lifecycleSchema), asyncHandler(controller.staffStatus));
  router.post('/staff/:id/reactivate', validateBody(lifecycleSchema), asyncHandler(controller.staffStatus));
  router.post('/staff/:id/revoke-sessions', validateBody(lifecycleSchema), asyncHandler(controller.revokeStaffSessions));
  router.post('/staff/:id/resend-invitation', asyncHandler(controller.resendStaffInvitation));
  router.post('/staff/:id/cancel-invitation', validateBody(lifecycleSchema), asyncHandler(controller.cancelStaffInvitation));

  crud(router, '/states', {
    list: controller.listStates, create: controller.createState, detail: controller.stateDetail,
    update: controller.updateState, status: controller.stateStatus,
  }, stateSchema);
  crud(router, '/cities', {
    list: controller.listCities, create: controller.createCity, detail: controller.cityDetail,
    update: controller.updateCity, status: controller.cityStatus,
  }, citySchema);
  crud(router, '/zones', {
    list: controller.listZones, create: controller.createZone, detail: controller.zoneDetail,
    update: controller.updateZone, status: controller.zoneStatus,
  }, zoneSchema);
  crud(router, '/markets', {
    list: controller.listMarkets, create: controller.createMarket, detail: controller.marketDetail,
    update: controller.updateMarket, status: controller.marketStatus,
  }, marketSchema);
  router.post('/markets/:id/assign-hub', validateBody(z.object({ hubId: z.string().min(1), reason: z.string().min(3) })), asyncHandler(controller.assignMarketHub));
  crud(router, '/hubs', {
    list: controller.listHubs, create: controller.createHub, detail: controller.hubDetail,
    update: controller.updateHub, status: controller.hubStatus,
  }, hubSchema);
  router.post('/hubs/:id/assign-markets', validateBody(z.object({ marketIds: z.array(z.string()).min(1), reason: z.string().min(3) })), asyncHandler(controller.assignHubMarkets));

  router.get('/partners', asyncHandler(controller.listPartners));
  router.post('/partners', validateBody(partnerSchema), asyncHandler(controller.createPartner));
  router.get('/partners/:id', asyncHandler(controller.partnerDetail));
  router.patch('/partners/:id', validateBody(partnerSchema.partial()), asyncHandler(controller.updatePartner));
  router.post('/partners/:id/activate', validateBody(lifecycleSchema), asyncHandler(controller.partnerStatus));
  router.post('/partners/:id/suspend', validateBody(lifecycleSchema), asyncHandler(controller.partnerStatus));
  router.post('/partners/:id/reactivate', validateBody(lifecycleSchema), asyncHandler(controller.partnerStatus));
  router.post('/partners/:id/resend-invitation', asyncHandler(controller.resendPartnerInvitation));
  router.post('/partners/:id/cancel-invitation', validateBody(lifecycleSchema), asyncHandler(controller.cancelPartnerInvitation));

  router.get('/runners', asyncHandler(controller.listRunners));
  router.post('/runners', validateBody(runnerSchema), asyncHandler(controller.createRunner));
  router.get('/runners/:id', asyncHandler(controller.runnerDetail));
  router.patch('/runners/:id', validateBody(runnerSchema.partial()), asyncHandler(controller.updateRunner));
  router.post('/runners/:id/activate', validateBody(lifecycleSchema), asyncHandler(controller.runnerStatus));
  router.post('/runners/:id/suspend', validateBody(lifecycleSchema), asyncHandler(controller.runnerStatus));
  router.post('/runners/:id/reactivate', validateBody(lifecycleSchema), asyncHandler(controller.runnerStatus));
  router.post('/runners/:id/resend-invitation', asyncHandler(controller.resendRunnerInvitation));
  router.post('/runners/:id/cancel-invitation', validateBody(lifecycleSchema), asyncHandler(controller.cancelRunnerInvitation));

  router.get('/runner-assignments', asyncHandler(controller.listAssignments));
  router.post('/runner-assignments', validateBody(assignmentSchema), asyncHandler(controller.createAssignment));
  router.get('/runner-assignments/:id', asyncHandler(controller.assignmentDetail));
  router.patch('/runner-assignments/:id', asyncHandler(controller.updateAssignment));
  router.post('/runner-assignments/:id/activate', validateBody(lifecycleSchema), asyncHandler(controller.assignmentStatus));
  router.post('/runner-assignments/:id/pause', validateBody(lifecycleSchema), asyncHandler(controller.assignmentStatus));
  router.post('/runner-assignments/:id/end', validateBody(lifecycleSchema), asyncHandler(controller.assignmentStatus));

  router.get('/audit-logs', asyncHandler(controller.auditLogs));
  router.get('/audit-logs/:id', asyncHandler(controller.auditDetail));
  router.get('/public-id-counters', asyncHandler(controller.counters));
  router.post('/public-id-counters/repair', validateBody(z.object({
    domain: z.enum([
      'state', 'city', 'zone', 'market', 'hub', 'partner', 'runner', 'customer', 'staff', 'audit',
      'category', 'submission', 'product', 'variant', 'negotiation', 'quote',
    ]),
    year: z.number().int().min(2020).optional(), sequence: z.number().int().nonnegative(), reason: z.string().min(5),
  })), asyncHandler(controller.repairCounter));

  return router;
}
