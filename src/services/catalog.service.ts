import mongoose from 'mongoose';
import {
  ProductAvailabilityStatus,
  ProductStatus,
  ProductSubmissionStatus,
} from '@lib/constants';
import { Category } from '@models/categories/category.model';
import {
  CatalogMediaAsset,
  ProductSubmission,
  ProductVariant,
  SubmissionVariant,
} from '@models/catalog/catalog.model';
import { Product } from '@models/products/product.model';
import { MarketVendor } from '@models/catalog/market-vendor.model';
import { Market } from '@models/platform/network.model';
import { RunnerMarketAssignment, RunnerProfile } from '@models/platform/operations-accounts.model';
import { nextPublicId } from './public-id.service';
import { CatalogMediaService } from './catalog-media.service';
import { HttpError } from '@utils/http';
import { adminReviewCache } from '@lib/ttl-cache';

type SubmissionInput = {
  marketId: string;
  marketVendorId: string;
  categorySuggestionId: string;
  basicTitle: string;
  notes?: string;
  mediaIds: string[];
  basePriceMinor: number;
  currency: string;
  variants: SubmissionVariant[];
  availabilityStatus: ProductAvailabilityStatus;
  availabilityNote?: string;
  internalSellerReference?: string;
  version?: number;
};

function identifierQuery(identifier: string) {
  return /^[a-f\d]{24}$/i.test(identifier)
    ? { $or: [{ _id: identifier }, { publicId: identifier }] }
    : { publicId: identifier };
}

export async function byIdentifier<T>(model: any, identifier: string, select?: string): Promise<T> {
  const query = model.findOne(identifierQuery(identifier));
  if (select) query.select(select);
  const record = await query.lean({ virtuals: true });
  if (!record) throw new HttpError(404, 'Record not found', undefined, 'NOT_FOUND');
  return record as T;
}

function slugify(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-');
}

async function runnerContext(accountId: string, marketIdentifier?: string) {
  const runner = await RunnerProfile.findOne({ accountId, status: 'active' }).lean({ virtuals: true });
  if (!runner) throw new HttpError(403, 'Active Runner profile required', undefined, 'ACCESS_DENIED');
  if (!marketIdentifier) return { runner };
  const market = await byIdentifier<any>(Market, marketIdentifier);
  if (market.status !== 'active') throw new HttpError(409, 'The selected Market is inactive', undefined, 'MARKET_INACTIVE');
  const assignment = await RunnerMarketAssignment.findOne({
    runnerId: runner._id.toString(),
    marketId: market._id.toString(),
    status: 'active',
    activeFrom: { $lte: new Date() },
    $or: [{ activeTo: { $exists: false } }, { activeTo: null }, { activeTo: { $gt: new Date() } }],
  }).lean({ virtuals: true });
  if (!assignment) {
    throw new HttpError(403, 'An active Market assignment is required', undefined, 'RUNNER_MARKET_ASSIGNMENT_REQUIRED');
  }
  return { runner, market, assignment };
}

async function ensureMarketVendor(identifier: string, marketId: string) {
  const filter = /^[a-f\d]{24}$/i.test(identifier)
    ? { $or: [{ _id: identifier }, { publicId: identifier }] }
    : { publicId: identifier };
  const vendor = await MarketVendor.findOne({
    ...filter,
    marketId,
    status: { $in: ['pending', 'active'] },
    deletedAt: { $exists: false },
  }).lean({ virtuals: true });
  if (!vendor) {
    throw new HttpError(409, 'Select an active vendor from this Market', undefined, 'MARKET_VENDOR_INVALID');
  }
  return vendor;
}

async function category(identifier: string) {
  const result = await byIdentifier<any>(Category, identifier);
  if (!result.isActive || result.deletedAt) throw new HttpError(409, 'The selected category is inactive', undefined, 'CONFLICT');
  return result;
}

async function claimMedia(accountId: string, submissionId: string, mediaIds: string[]) {
  if (!mediaIds.length) return [];
  const assets = await CatalogMediaAsset.find({
    $and: [
      { $or: [{ publicId: { $in: mediaIds } }, { _id: { $in: mediaIds.filter((id) => /^[a-f\d]{24}$/i.test(id)) } }] },
      { $or: [{ ownerId: { $exists: false } }, { ownerId: submissionId }] },
    ],
    uploaderAccountId: accountId,
    status: 'ready',
  }).lean({ virtuals: true });
  if (assets.length !== new Set(mediaIds).size) {
    throw new HttpError(400, 'One or more images are invalid or belong to another record', undefined, 'SUBMISSION_VALIDATION_FAILED');
  }
  await CatalogMediaAsset.updateMany(
    { _id: { $in: assets.map((asset) => asset._id) }, $or: [{ ownerId: { $exists: false } }, { ownerId: submissionId }] },
    { $set: { ownerType: 'submission', ownerId: submissionId } },
  );
  return assets;
}

function validateSubmissionReady(submission: any, mediaCount: number) {
  const fields: string[] = [];
  if (!submission.basicTitle?.trim()) fields.push('basicTitle');
  if (!submission.categorySuggestionId) fields.push('categorySuggestionId');
  if (!Number.isSafeInteger(submission.basePriceMinor) || submission.basePriceMinor <= 0) fields.push('basePriceMinor');
  if (!submission.variants?.some((item: SubmissionVariant) => item.active)) fields.push('variants');
  if (mediaCount < 1) fields.push('mediaIds');
  if (fields.length) {
    throw new HttpError(400, 'Complete the required submission fields before submitting', { fields }, 'SUBMISSION_VALIDATION_FAILED');
  }
}

export class RunnerCatalogService {
  async dashboard(accountId: string) {
    const { runner } = await runnerContext(accountId);
    const runnerId = runner._id.toString();
    const [assignments, counts, recentPublished] = await Promise.all([
      RunnerMarketAssignment.countDocuments({ runnerId, status: 'active' }),
      ProductSubmission.aggregate([
        { $match: { runnerId, deletedAt: { $exists: false } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Product.find({ 'commercialApproval.sourceRunnerId': runnerId, status: ProductStatus.PUBLISHED })
        .select('publicId title status publishedAt')
        .sort({ publishedAt: -1 })
        .limit(5)
        .lean({ virtuals: true }),
    ]);
    const byStatus = Object.fromEntries(counts.map((item) => [item._id, item.count]));
    return {
      assignedMarkets: assignments,
      drafts: byStatus[ProductSubmissionStatus.DRAFT] || 0,
      submitted: byStatus[ProductSubmissionStatus.SUBMITTED] || 0,
      changesRequested: byStatus[ProductSubmissionStatus.CHANGES_REQUESTED] || 0,
      approved: byStatus[ProductSubmissionStatus.APPROVED] || 0,
      recentPublished,
    };
  }

  async list(accountId: string, query: Record<string, unknown>) {
    const { runner } = await runnerContext(accountId);
    const limit = Math.min(Math.max(Number(query.limit || 20), 1), 50);
    const filter: Record<string, any> = { runnerId: runner._id.toString(), deletedAt: { $exists: false } };
    if (query.status && Object.values(ProductSubmissionStatus).includes(query.status as ProductSubmissionStatus)) {
      filter.status = query.status;
    }
    if (query.cursor) filter._id = { $lt: query.cursor };
    const data = await ProductSubmission.find(filter).sort({ _id: -1 }).limit(limit + 1).lean({ virtuals: true });
    const hasMore = data.length > limit;
    const page = data.slice(0, limit);
    return { data: page, nextCursor: hasMore && page.length ? page[page.length - 1]._id.toString() : null, hasMore };
  }

  async detail(accountId: string, identifier: string) {
    const { runner } = await runnerContext(accountId);
    const submission = await ProductSubmission.findOne({
      ...identifierQuery(identifier),
      runnerId: runner._id.toString(),
      deletedAt: { $exists: false },
    }).lean({ virtuals: true });
    if (!submission) throw new HttpError(404, 'Submission not found', undefined, 'NOT_FOUND');
    return submission;
  }

  async create(accountId: string, input: SubmissionInput) {
    const [{ runner, market }] = await Promise.all([
      runnerContext(accountId, input.marketId),
      category(input.categorySuggestionId),
    ]);
    const vendor = await ensureMarketVendor(input.marketVendorId, market._id.toString());
    const publicId = await nextPublicId('submission');
    const submission = await ProductSubmission.create({
      publicId,
      runnerId: runner._id.toString(),
      marketId: market._id.toString(),
      marketVendorId: vendor._id.toString(),
      sourceStateId: market.stateId,
      categorySuggestionId: (await category(input.categorySuggestionId))._id.toString(),
      basicTitle: input.basicTitle,
      notes: input.notes,
      mediaIds: input.mediaIds,
      basePriceMinor: input.basePriceMinor,
      currency: input.currency,
      variants: input.variants,
      availabilityStatus: input.availabilityStatus,
      availabilityNote: input.availabilityNote,
      internalSellerReference: input.internalSellerReference,
      status: ProductSubmissionStatus.DRAFT,
      version: 1,
    });
    await claimMedia(accountId, submission.id, input.mediaIds);
    return submission.toJSON();
  }

  async update(accountId: string, identifier: string, input: SubmissionInput) {
    const current = await this.detail(accountId, identifier);
    if (![ProductSubmissionStatus.DRAFT, ProductSubmissionStatus.CHANGES_REQUESTED].includes(current.status)) {
      throw new HttpError(409, 'This submission cannot be edited in its current state', undefined, 'SUBMISSION_STATE_CONFLICT');
    }
    if (input.version !== current.version) throw new HttpError(409, 'This submission was updated elsewhere', undefined, 'STALE_VERSION');
    const [{ market }] = await Promise.all([
      runnerContext(accountId, input.marketId),
      category(input.categorySuggestionId),
    ]);
    const vendor = await ensureMarketVendor(input.marketVendorId, market._id.toString());
    const updated = await ProductSubmission.findOneAndUpdate(
      { _id: current._id, version: current.version },
      {
        $set: {
          marketId: market._id.toString(),
          marketVendorId: vendor._id.toString(),
          sourceStateId: market.stateId,
          categorySuggestionId: (await category(input.categorySuggestionId))._id.toString(),
          basicTitle: input.basicTitle,
          notes: input.notes,
          mediaIds: input.mediaIds,
          basePriceMinor: input.basePriceMinor,
          currency: input.currency,
          variants: input.variants,
          availabilityStatus: input.availabilityStatus,
          availabilityNote: input.availabilityNote,
          internalSellerReference: input.internalSellerReference,
        },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    ).lean({ virtuals: true });
    if (!updated) throw new HttpError(409, 'This submission was updated elsewhere', undefined, 'STALE_VERSION');
    await claimMedia(accountId, current._id.toString(), input.mediaIds);
    return updated;
  }

  async submit(accountId: string, identifier: string, version: number) {
    const current = await this.detail(accountId, identifier);
    if (![ProductSubmissionStatus.DRAFT, ProductSubmissionStatus.CHANGES_REQUESTED].includes(current.status)) {
      throw new HttpError(409, 'This submission cannot be submitted in its current state', undefined, 'SUBMISSION_STATE_CONFLICT');
    }
    if (current.version !== version) throw new HttpError(409, 'This submission was updated elsewhere', undefined, 'STALE_VERSION');
    await runnerContext(accountId, current.marketId);
    await category(current.categorySuggestionId);
    const mediaCount = await CatalogMediaAsset.countDocuments({
      $or: [
        { publicId: { $in: current.mediaIds } },
        { _id: { $in: current.mediaIds.filter((id: string) => /^[a-f\d]{24}$/i.test(id)) } },
      ],
      uploaderAccountId: accountId,
      ownerId: current._id.toString(),
      status: 'ready',
    });
    validateSubmissionReady(current, mediaCount);
    const updated = await ProductSubmission.findOneAndUpdate(
      { _id: current._id, version, status: current.status },
      {
        $set: { status: ProductSubmissionStatus.SUBMITTED, submittedAt: new Date() },
        $push: {
          reviewNotes: {
            action: 'submitted',
            actorId: accountId,
            createdAt: new Date(),
          },
        },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    ).lean({ virtuals: true });
    if (!updated) throw new HttpError(409, 'Submission state changed before this action completed', undefined, 'SUBMISSION_STATE_CONFLICT');
    return updated;
  }
}

export class CatalogReviewService {
  async dashboard(stateIds?: string[]) {
    const cacheKey = `review:${stateIds?.length ? [...stateIds].sort().join(',') : 'global'}`;
    const cached = adminReviewCache.get(cacheKey);
    if (cached) return cached;

    const stateFilter = stateIds?.length ? { sourceStateId: { $in: stateIds } } : {};
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const [summary] = await ProductSubmission.aggregate([
      { $match: { ...stateFilter, deletedAt: { $exists: false } } },
      {
        $facet: {
          statusCounts: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          approvedToday: [
            { $match: { status: ProductSubmissionStatus.APPROVED, reviewedAt: { $gte: today } } },
            { $count: 'count' },
          ],
          rejectedToday: [
            { $match: { status: ProductSubmissionStatus.REJECTED, reviewedAt: { $gte: today } } },
            { $count: 'count' },
          ],
          age: [
            { $match: { status: { $in: [ProductSubmissionStatus.SUBMITTED, ProductSubmissionStatus.IN_REVIEW] }, submittedAt: { $type: 'date' } } },
            { $group: { _id: null, averageMs: { $avg: { $subtract: [now, '$submittedAt'] } } } },
          ],
          byState: [{ $group: { _id: '$sourceStateId', count: { $sum: 1 } } }],
          byMarket: [{ $group: { _id: '$marketId', count: { $sum: 1 } } }],
        },
      },
    ]);
    const statusCounts = summary?.statusCounts || [];
    const counts = Object.fromEntries((statusCounts as any[]).map((item: any) => [item._id, item.count]));
    const result = {
      pending: counts.submitted || 0,
      inReview: counts.in_review || 0,
      changesRequested: counts.changes_requested || 0,
      approvedToday: summary?.approvedToday?.[0]?.count || 0,
      rejectedToday: summary?.rejectedToday?.[0]?.count || 0,
      averageReviewAgeHours: Number(((summary?.age?.[0]?.averageMs || 0) / 3_600_000).toFixed(1)),
      byState: summary?.byState || [],
      byMarket: summary?.byMarket || [],
    };
    adminReviewCache.set(cacheKey, result);
    return result;
  }

  async list(query: Record<string, unknown>, stateIds?: string[]) {
    const limit = Math.min(Math.max(Number(query.limit || 20), 1), 50);
    const filter: Record<string, any> = { deletedAt: { $exists: false } };
    if (stateIds?.length) filter.sourceStateId = { $in: stateIds };
    if (query.status) filter.status = query.status;
    if (query.stateId) filter.sourceStateId = query.stateId;
    if (query.marketId) filter.marketId = query.marketId;
    if (query.runnerId) filter.runnerId = query.runnerId;
    if (query.categoryId) filter.categorySuggestionId = query.categoryId;
    if (query.cursor) filter._id = { $lt: query.cursor };
    if (query.q) filter.$text = { $search: String(query.q) };
    const direction = query.sort === 'oldest' ? 1 : -1;
    const data = await ProductSubmission.find(filter).sort({ _id: direction }).limit(limit + 1).lean({ virtuals: true });
    const hasMore = data.length > limit;
    const page = data.slice(0, limit);
    return { data: page, nextCursor: hasMore && page.length ? page[page.length - 1]._id.toString() : null, hasMore };
  }

  async detail(identifier: string, stateIds?: string[]) {
    const filter: Record<string, unknown> = { ...identifierQuery(identifier) };
    if (stateIds?.length) filter.sourceStateId = { $in: stateIds };
    const submission = await ProductSubmission.findOne(filter).lean({ virtuals: true });
    if (!submission) throw new HttpError(404, 'Submission not found', undefined, 'NOT_FOUND');
    const [runner, market, categoryRecord, media] = await Promise.all([
      RunnerProfile.findById(submission.runnerId).select('publicId accountId').lean({ virtuals: true }),
      Market.findById(submission.marketId).select('publicId name stateId cityId hubId').lean({ virtuals: true }),
      Category.findById(submission.categorySuggestionId).select('publicId name slug').lean({ virtuals: true }),
      CatalogMediaAsset.find({
        $or: [
          { publicId: { $in: submission.mediaIds } },
          { _id: { $in: submission.mediaIds.filter((id: string) => /^[a-f\d]{24}$/i.test(id)) } },
        ],
        status: 'ready',
      }).sort({ order: 1 }).lean({ virtuals: true }),
    ]);
    const mediaService = new CatalogMediaService();
    return {
      ...submission,
      runner,
      market,
      category: categoryRecord,
      media: media.map((asset) => ({
        ...asset,
        deliveryUrl: asset.deliveryType === 'external' ? asset.secureUrl : mediaService.deliveryUrl(asset),
      })),
    };
  }

  async start(identifier: string, actorId: string, actorPublicId: string | undefined, version: number, stateIds?: string[]) {
    const current = await this.detail(identifier, stateIds);
    if (current.status !== ProductSubmissionStatus.SUBMITTED) {
      throw new HttpError(409, 'Only submitted records can enter review', undefined, 'SUBMISSION_STATE_CONFLICT');
    }
    const updated = await ProductSubmission.findOneAndUpdate(
      { _id: current._id, version, status: ProductSubmissionStatus.SUBMITTED },
      {
        $set: { status: ProductSubmissionStatus.IN_REVIEW, reviewStartedAt: new Date(), reviewedBy: actorId },
        $push: { reviewNotes: { action: 'review_started', actorId, actorPublicId, createdAt: new Date() } },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    ).lean({ virtuals: true });
    if (!updated) throw new HttpError(409, 'Another reviewer changed this submission', undefined, 'SUBMISSION_REVIEW_CONFLICT');
    return updated;
  }

  async decide(
    identifier: string,
    actorId: string,
    actorPublicId: string | undefined,
    action: 'changes_requested' | 'rejected' | 'approved',
    input: { reason: string; fields: string[]; version: number },
    stateIds?: string[],
  ) {
    const current = await this.detail(identifier, stateIds);
    if (current.status !== ProductSubmissionStatus.IN_REVIEW || current.reviewedBy !== actorId) {
      throw new HttpError(409, 'Start review before recording this decision', undefined, 'SUBMISSION_REVIEW_CONFLICT');
    }
    if (action !== 'approved') {
      const next = action === 'rejected' ? ProductSubmissionStatus.REJECTED : ProductSubmissionStatus.CHANGES_REQUESTED;
      const updated = await ProductSubmission.findOneAndUpdate(
        { _id: current._id, version: input.version, status: ProductSubmissionStatus.IN_REVIEW },
        {
          $set: { status: next, reviewedAt: new Date() },
          $push: {
            reviewNotes: {
              action,
              message: input.reason,
              fields: input.fields,
              actorId,
              actorPublicId,
              createdAt: new Date(),
            },
          },
          $inc: { version: 1 },
        },
        { returnDocument: 'after' },
      ).lean({ virtuals: true });
      if (!updated) throw new HttpError(409, 'Another reviewer changed this submission', undefined, 'SUBMISSION_REVIEW_CONFLICT');
      return updated;
    }

    validateSubmissionReady(current, current.media.length);
    await category(current.categorySuggestionId);
    const transaction = await mongoose.startSession();
    try {
      let result: any;
      await transaction.withTransaction(async () => {
        const productPublicId = await nextPublicId('product');
        const slug = `${slugify(current.basicTitle)}-${productPublicId.toLowerCase()}`;
        const product = await Product.create([{
          publicId: productPublicId,
          hookId: productPublicId,
          sourceSubmissionId: current._id.toString(),
          sourceMarketVendorId: current.marketVendorId,
          sourceRunnerId: current.runnerId,
          marketId: current.marketId,
          sourceStateId: current.sourceStateId,
          categoryId: current.categorySuggestionId,
          title: current.basicTitle,
          slug,
          description: '',
          basePriceMinor: current.basePriceMinor,
          sellingPriceMinor: current.basePriceMinor,
          markupMinor: 0,
          discountMinor: 0,
          currency: current.currency,
          mediaAssetIds: current.mediaIds,
          images: [],
          quantity: 0,
          reservedQuantity: 0,
          costPrice: current.basePriceMinor / 100,
          sellingPrice: current.basePriceMinor / 100,
          minAcceptablePrice: current.basePriceMinor / 100,
          status: ProductStatus.DRAFT,
          availabilityStatus: current.availabilityStatus,
          customerAvailabilityNote: current.availabilityNote,
          negotiationRules: { enabled: false, maximumCustomerOffers: 3, acceptedQuoteExpiryMinutes: 30 },
          commercialApproval: { approved: false, sourceRunnerId: current.runnerId },
          source: 'admin',
          viewCount: 0,
          orderCount: 0,
          averageRating: 0,
          catalogMigrationVersion: 3,
        }], { session: transaction });
        for (let index = 0; index < current.variants.length; index += 1) {
          const item = current.variants[index];
          const publicId = await nextPublicId('variant');
          await ProductVariant.create([{
            publicId,
            productId: product[0].id,
            sku: `${productPublicId}-${String(index + 1).padStart(2, '0')}`,
            size: item.size,
            colour: item.colour,
            attributes: item.attributes || {},
            active: item.active !== false,
            mediaAssetIds: [],
          }], { session: transaction });
        }
        result = await ProductSubmission.findOneAndUpdate(
          { _id: current._id, version: input.version, status: ProductSubmissionStatus.IN_REVIEW },
          {
            $set: {
              status: ProductSubmissionStatus.APPROVED,
              reviewedAt: new Date(),
              productId: product[0].id,
            },
            $push: {
              reviewNotes: {
                action: 'approved',
                message: input.reason,
                fields: input.fields,
                actorId,
                actorPublicId,
                createdAt: new Date(),
              },
            },
            $inc: { version: 1 },
          },
          { returnDocument: 'after', session: transaction },
        ).lean({ virtuals: true });
        if (!result) throw new HttpError(409, 'Another reviewer changed this submission', undefined, 'SUBMISSION_REVIEW_CONFLICT');
        await CatalogMediaAsset.updateMany(
          {
            $or: [
              { publicId: { $in: current.mediaIds } },
              { _id: { $in: current.mediaIds.filter((id: string) => /^[a-f\d]{24}$/i.test(id)) } },
            ],
          },
          { $set: { ownerType: 'product', ownerId: product[0].id } },
          { session: transaction },
        );
      });
      return result;
    } finally {
      await transaction.endSession();
    }
  }
}
