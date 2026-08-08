import { ProductAvailabilityStatus, ProductStatus } from '@lib/constants';
import { CommerceSettings } from '@models/commerce/commerce.model';
import { Product } from '@models/products/product.model';
import { RunnerMarketAssignment, RunnerProfile } from '@models/platform/operations-accounts.model';
import { byIdentifier } from '@services/catalog.service';
import { MarketVendorService } from '@services/market-vendor.service';
import { publishRealtime } from '@services/realtime.service';
import { HttpError } from '@utils/http';

function versionFilter(product: any, version: number) {
  const currentVersion = Number(product.catalogVersion || 1);
  if (currentVersion !== version) throw new HttpError(409, 'This product was updated elsewhere', undefined, 'STALE_VERSION');
  return product.catalogVersion === undefined
    ? { _id: product._id, $or: [{ catalogVersion: { $exists: false } }, { catalogVersion: version }] }
    : { _id: product._id, catalogVersion: version };
}

function publishUpdate(product: any) {
  const event = { entityId: product.publicId || product._id?.toString(), version: Number(product.catalogVersion || 1), scope: product.sourceStateId ? { stateId: String(product.sourceStateId) } : undefined };
  publishRealtime({ type: 'catalog.updated', ...event }, { public: true, admin: true });
  publishRealtime({ type: 'home.updated', ...event }, { public: true, admin: true });
  publishRealtime({ type: 'admin.dashboard.updated', ...event }, { admin: true });
}

async function runnerForProduct(accountId: string, identifier: string) {
  const runner = await RunnerProfile.findOne({ accountId, status: 'active' }).lean();
  if (!runner) throw new HttpError(403, 'Active Runner profile required', undefined, 'ACCESS_DENIED');
  const product = await byIdentifier<any>(Product, identifier);
  const runnerId = product.sourceRunnerId || product.commercialApproval?.sourceRunnerId;
  const assignment = await RunnerMarketAssignment.findOne({ runnerId: runner._id.toString(), marketId: product.marketId, status: 'active', activeFrom: { $lte: new Date() }, $or: [{ activeTo: { $exists: false } }, { activeTo: null }, { activeTo: { $gt: new Date() } }] }).lean();
  if (!assignment) throw new HttpError(403, 'An active Market assignment is required', undefined, 'RUNNER_MARKET_ASSIGNMENT_REQUIRED');
  if (runnerId && runnerId !== runner._id.toString()) {
    const sourceRunner = await RunnerProfile.findById(runnerId).select('status').lean();
    if (sourceRunner?.status === 'active') throw new HttpError(403, 'This availability check belongs to another Runner', undefined, 'SCOPE_DENIED');
  }
  if (product.availabilityStatus !== ProductAvailabilityStatus.UNCONFIRMED) throw new HttpError(409, 'This Product has no pending availability check', undefined, 'AVAILABILITY_CHECK_NOT_PENDING');
  return { runner, product };
}

export class CatalogAvailabilityService {
  async request(identifier: string, input: { reason: string; version: number }, actorId: string, stateIds?: string[]) {
    const product = await byIdentifier<any>(Product, identifier);
    if (stateIds?.length && (!product.sourceStateId || !stateIds.includes(product.sourceStateId))) throw new HttpError(404, 'Product not found', undefined, 'NOT_FOUND');
    if (![ProductStatus.PUBLISHED, ProductStatus.PAUSED, ProductStatus.AVAILABILITY_UNCONFIRMED].includes(product.status)) throw new HttpError(409, 'This Product cannot enter an availability check', undefined, 'INVALID_STATE_TRANSITION');
    const settings = await CommerceSettings.findOne({ key: 'commerce' }).lean();
    const days = Math.min(Math.max(Number(settings?.catalogAvailabilityCheckDays || 4), 1), 30);
    const now = new Date();
    const updated = await Product.findOneAndUpdate(
      versionFilter(product, input.version),
      {
        $set: {
          status: ProductStatus.AVAILABILITY_UNCONFIRMED,
          availabilityStatus: ProductAvailabilityStatus.UNCONFIRMED,
          availabilityPreviousStatus: product.status === ProductStatus.AVAILABILITY_UNCONFIRMED ? product.availabilityPreviousStatus || ProductStatus.PUBLISHED : product.status,
          availabilityCheckRequestedAt: now,
          availabilityCheckDueAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
          availabilityCheckRequestedBy: actorId,
          availabilityCheckNote: input.reason,
          customerAvailabilityNote: input.reason,
        },
        $unset: { availabilityEscalatedAt: 1 },
        $inc: { catalogVersion: 1 },
      },
      { returnDocument: 'after' },
    ).lean({ virtuals: true });
    if (!updated) throw new HttpError(409, 'This Product was updated elsewhere', undefined, 'STALE_VERSION');
    await new MarketVendorService().notifyAvailability(actorId, updated);
    publishUpdate(updated);
    return updated;
  }

  async confirm(accountId: string, identifier: string, input: { status: 'available' | 'limited'; note?: string; version: number }) {
    const { product } = await runnerForProduct(accountId, identifier);
    const nextStatus = product.availabilityPreviousStatus === ProductStatus.PUBLISHED && product.commercialApproval?.approved === true ? ProductStatus.PUBLISHED : product.status === ProductStatus.AVAILABILITY_UNCONFIRMED ? ProductStatus.DRAFT : product.status;
    const updated = await Product.findOneAndUpdate(
      versionFilter(product, input.version),
      {
        $set: {
          status: nextStatus,
          availabilityStatus: input.status === 'available' ? ProductAvailabilityStatus.AVAILABLE : ProductAvailabilityStatus.LIMITED,
          availabilityCheckNote: input.note,
          customerAvailabilityNote: input.note,
          lastAvailabilityConfirmedAt: new Date(),
          availabilityPreviousStatus: undefined,
          availabilityCheckDueAt: undefined,
        },
        $inc: { catalogVersion: 1 },
      },
      { returnDocument: 'after' },
    ).lean({ virtuals: true });
    if (!updated) throw new HttpError(409, 'This Product was updated elsewhere', undefined, 'STALE_VERSION');
    publishUpdate(updated);
    return updated;
  }

  async report(accountId: string, identifier: string, input: { note: string; version: number }) {
    const { product } = await runnerForProduct(accountId, identifier);
    const updated = await Product.findOneAndUpdate(
      versionFilter(product, input.version),
      {
        $set: {
          status: ProductStatus.PAUSED,
          availabilityStatus: ProductAvailabilityStatus.UNAVAILABLE,
          availabilityCheckNote: input.note,
          customerAvailabilityNote: input.note,
          availabilityCheckDueAt: undefined,
        },
        $inc: { catalogVersion: 1 },
      },
      { returnDocument: 'after' },
    ).lean({ virtuals: true });
    if (!updated) throw new HttpError(409, 'This Product was updated elsewhere', undefined, 'STALE_VERSION');
    publishUpdate(updated);
    return updated;
  }
}

export async function escalateOverdueAvailabilityChecks() {
  const products = await Product.find({
    availabilityStatus: ProductAvailabilityStatus.UNCONFIRMED,
    availabilityCheckDueAt: { $lt: new Date() },
    availabilityEscalatedAt: { $exists: false },
    deletedAt: { $exists: false },
  }).select('publicId title marketId sourceStateId availabilityCheckDueAt').limit(100).lean({ virtuals: true });
  const notifier = new MarketVendorService();
  let escalated = 0;
  for (const product of products) {
    const recipients = await notifier.notifyAvailabilityOverdue(product);
    if (!recipients) continue;
    const result = await Product.updateOne(
      { _id: product._id, availabilityEscalatedAt: { $exists: false } },
      { $set: { availabilityEscalatedAt: new Date() } },
    );
    if (result.modifiedCount) escalated += 1;
  }
  return escalated;
}
