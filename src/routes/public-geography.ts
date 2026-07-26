import { Router } from 'express';
import { OperationCity, OperationState, ServiceZone } from '@models/platform/geography.model';
import { Market } from '@models/platform/network.model';
import { asyncHandler, sendSuccess } from '@utils/http';

export function createPublicGeographyRouter() {
  const router = Router();
  router.get('/states', asyncHandler(async (_req, res) => {
    sendSuccess(res, await OperationState.find({ status: 'active' })
      .select('publicId name code timezone currency deliveryPromiseHours payAtHubEnabled')
      .sort({ name: 1 }).lean({ virtuals: true }));
  }));
  router.get('/cities', asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = { status: 'active' };
    if (req.query.stateId) filter.stateId = req.query.stateId;
    sendSuccess(res, await OperationCity.find(filter).select('publicId stateId name code').sort({ name: 1 }).lean({ virtuals: true }));
  }));
  router.get('/zones', asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = { status: 'active', deliveryEligible: true };
    if (req.query.stateId) filter.stateId = req.query.stateId;
    if (req.query.cityId) filter.cityId = req.query.cityId;
    sendSuccess(res, await ServiceZone.find(filter).select('publicId stateId cityId name code deliveryEligible').sort({ name: 1 }).lean({ virtuals: true }));
  }));
  router.get('/markets', asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = { status: 'active' };
    if (req.query.stateId) filter.stateId = req.query.stateId;
    if (req.query.cityId) filter.cityId = req.query.cityId;
    sendSuccess(res, await Market.find(filter).select('publicId name stateId cityId zoneId address coordinates operatingHours').sort({ name: 1 }).lean({ virtuals: true }));
  }));
  return router;
}
