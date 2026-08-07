import { DEFAULT_DELIVERY_FEE_MINOR } from '@lib/constants';
import { DeliveryPricingRule } from '@models/platform/delivery-pricing.model';
import { DispatchHub } from '@models/platform/network.model';
import { OperationCity, OperationState, ServiceZone } from '@models/platform/geography.model';
import { isValidObjectId } from 'mongoose';

type Coordinates = { latitude: number; longitude: number };

function distanceKm(from: { lat: number; lng: number }, to: Coordinates) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6371;
  const latitudeDelta = radians(to.latitude - from.lat);
  const longitudeDelta = radians(to.longitude - from.lng);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.lat)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 100) / 100;
}

function activeRuleFilter(now: Date, scope: string, scopeIds: string[] = []) {
  return {
    scope,
    ...(scopeIds.length ? { scopeId: { $in: scopeIds } } : {}),
    status: 'active',
    $and: [
      { $or: [{ effectiveFrom: { $exists: false } }, { effectiveFrom: null }, { effectiveFrom: { $lte: now } }] },
      { $or: [{ effectiveUntil: { $exists: false } }, { effectiveUntil: null }, { effectiveUntil: { $gt: now } }] },
    ],
  } as any;
}

function hubIdentity(identifier: unknown) {
  const value = String(identifier || '').trim();
  const clauses: Array<Record<string, string>> = [{ publicId: value }];
  if (isValidObjectId(value)) clauses.push({ _id: value });
  return { $or: clauses };
}

async function firstRule(scope: string, scopeIds: string[] = [], now: Date) {
  return DeliveryPricingRule.findOne(activeRuleFilter(now, scope, scopeIds))
    .sort({ version: -1, effectiveFrom: -1, createdAt: -1 })
    .lean({ virtuals: true }) as any;
}

async function resolveOrigin(state: any, rule: any) {
  const stateId = String(state?.id || state?._id || '');
  const hubId = rule?.originHubId || state.defaultHubId;
  if (hubId) {
    const selected = await DispatchHub.findOne({ ...hubIdentity(hubId), status: 'active' }).lean({ virtuals: true });
    if (selected?.coordinates?.lat != null && selected?.coordinates?.lng != null) return selected.coordinates;
  }
  const city = await OperationCity.findOne({ stateId, status: 'active', defaultHubId: { $exists: true } }).sort({ createdAt: 1 }).lean({ virtuals: true });
  if (city?.defaultHubId) {
    const selected = await DispatchHub.findOne({ ...hubIdentity(city.defaultHubId), status: 'active' }).lean({ virtuals: true });
    if (selected?.coordinates?.lat != null && selected?.coordinates?.lng != null) return selected.coordinates;
  }
  const fallback = await DispatchHub.findOne({ stateId, status: 'active' }).sort({ createdAt: 1 }).lean({ virtuals: true });
  return fallback?.coordinates?.lat != null && fallback?.coordinates?.lng != null ? fallback.coordinates : undefined;
}

export async function calculateDeliveryPricing(input: {
  state: any;
  zone?: any;
  coordinates?: Coordinates;
  defaultFeeMinor?: number;
}) {
  const now = new Date();
  const stateId = String(input.state?.id || input.state?._id || '');
  const rule = input.zone
    ? await firstRule('zone', [String(input.zone.id || input.zone._id), String(input.zone.publicId || '')].filter(Boolean), now)
    : undefined;
  const selectedRule = rule
    || await firstRule('state', [stateId, String(input.state.publicId || '')].filter(Boolean), now)
    || await firstRule('global', undefined, now);
  const fallbackFee = Number(input.defaultFeeMinor ?? DEFAULT_DELIVERY_FEE_MINOR);
  if (!selectedRule) {
    return {
      scope: 'global' as const,
      mode: 'flat' as const,
      distanceKm: undefined,
      billableKm: undefined,
      feeMinor: fallbackFee,
      ruleVersion: 'global-fallback-v1',
      originHubId: undefined,
    };
  }

  let distance: number | undefined;
  let billableKm: number | undefined;
  const fallbackRuleFee = Number(selectedRule.fallbackFeeMinor ?? selectedRule.flatFeeMinor ?? fallbackFee);
  let fee = fallbackRuleFee;
  const originHubId = selectedRule.originHubId;
  if ((selectedRule.mode === 'distance_bands' || selectedRule.mode === 'per_km') && input.coordinates) {
    const origin = await resolveOrigin(input.state, selectedRule);
    if (origin) {
      distance = distanceKm(origin, input.coordinates);
      billableKm = Math.max(1, Math.ceil(distance));
      if (selectedRule.mode === 'per_km') {
        fee = Number(selectedRule.baseFeeMinor || 0) + Number(selectedRule.feePerKmMinor || 0) * billableKm;
      } else {
        const bands = [...(selectedRule.bands || [])].sort((a, b) => Number(a.upToKm) - Number(b.upToKm));
        const band = bands.find((item) => distance! <= Number(item.upToKm)) || bands[bands.length - 1];
        if (band) fee = Number(band.feeMinor);
      }
    }
  }
  return {
    scope: selectedRule.scope,
    mode: selectedRule.mode,
    distanceKm: distance,
    billableKm,
    baseFeeMinor: selectedRule.baseFeeMinor,
    feePerKmMinor: selectedRule.feePerKmMinor,
    fallbackFeeMinor: fallbackRuleFee,
    feeMinor: Math.max(0, Math.round(fee)),
    ruleVersion: `${selectedRule.publicId}:v${selectedRule.version}`,
    originHubId,
  };
}

export async function resolveDeliveryState(identifier: string) {
  const alternatives: Array<Record<string, string>> = [
    { publicId: identifier },
    { code: String(identifier).toUpperCase() },
  ];
  if (isValidObjectId(identifier)) alternatives.push({ _id: identifier });
  return OperationState.findOne({
    countryCode: 'NG',
    status: 'active',
    $or: alternatives,
  }).lean({ virtuals: true });
}

export async function resolveDeliveryZone(identifier: string | undefined, stateId: string) {
  if (!identifier) return undefined;
  const alternatives: Array<Record<string, string>> = [{ publicId: identifier }];
  if (isValidObjectId(identifier)) alternatives.push({ _id: identifier });
  return ServiceZone.findOne({
    status: 'active', deliveryEligible: true, stateId,
    $or: alternatives,
  }).lean({ virtuals: true });
}
