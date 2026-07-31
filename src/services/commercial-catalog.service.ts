import { ProductAvailabilityStatus, ProductStatus } from '@lib/constants';
import { Category } from '@models/categories/category.model';
import { CatalogMediaAsset, ProductSubmission, ProductVariant } from '@models/catalog/catalog.model';
import { Market } from '@models/platform/network.model';
import { OperationState } from '@models/platform/geography.model';
import { Product } from '@models/products/product.model';
import { CatalogMediaService } from './catalog-media.service';
import { byIdentifier } from './catalog.service';
import { HttpError } from '@utils/http';

function versionFilter(record: any, version: number) {
  if (Number(record.catalogVersion || record.__v || 1) !== version) {
    throw new HttpError(409, 'This product was updated elsewhere', undefined, 'STALE_VERSION');
  }
  return record.catalogVersion === undefined
    ? { _id: record._id, $or: [{ catalogVersion: { $exists: false } }, { catalogVersion: version }] }
    : { _id: record._id, catalogVersion: version };
}

function derivedPricing(basePriceMinor: number, sellingPriceMinor: number, discountMinor: number) {
  if (![basePriceMinor, sellingPriceMinor, discountMinor].every(Number.isSafeInteger)) {
    throw new HttpError(400, 'Prices must use integer minor units', undefined, 'PRODUCT_PRICING_INVALID');
  }
  if (basePriceMinor <= 0 || sellingPriceMinor <= 0 || discountMinor < 0 || discountMinor >= sellingPriceMinor) {
    throw new HttpError(400, 'Product pricing is invalid', undefined, 'PRODUCT_PRICING_INVALID');
  }
  const effectivePriceMinor = sellingPriceMinor - discountMinor;
  const markupMinor = sellingPriceMinor - basePriceMinor;
  if (markupMinor < 0 || effectivePriceMinor < basePriceMinor) {
    throw new HttpError(400, 'Customer price cannot be below the approved base market price', undefined, 'PRODUCT_PRICING_INVALID');
  }
  const marginMinor = effectivePriceMinor - basePriceMinor;
  return {
    basePriceMinor,
    sellingPriceMinor,
    discountMinor,
    effectivePriceMinor,
    markupMinor,
    marginMinor,
    marginPercentage: Number(((marginMinor / effectivePriceMinor) * 100).toFixed(2)),
  };
}

async function productRecord(identifier: string, stateIds?: string[]) {
  const product = await byIdentifier<any>(Product, identifier);
  if (stateIds?.length && (!product.sourceStateId || !stateIds.includes(product.sourceStateId))) {
    throw new HttpError(404, 'Product not found', undefined, 'NOT_FOUND');
  }
  return product;
}

export class CommercialCatalogService {
  async dashboard(stateIds?: string[]) {
    const scope = stateIds?.length ? { sourceStateId: { $in: stateIds } } : {};
    const [counts, awaitingCommercial, staleAvailability, margin] = await Promise.all([
      Product.aggregate([{ $match: scope }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Product.countDocuments({ ...scope, status: ProductStatus.DRAFT, 'commercialApproval.approved': { $ne: true } }),
      Product.countDocuments({
        ...scope,
        status: ProductStatus.PUBLISHED,
        $or: [
          { lastAvailabilityConfirmedAt: { $exists: false } },
          { lastAvailabilityConfirmedAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        ],
      }),
      Product.aggregate([
        { $match: { ...scope, sellingPriceMinor: { $gt: 0 }, basePriceMinor: { $gt: 0 } } },
        {
          $group: {
            _id: null,
            averageMarginMinor: { $avg: { $subtract: [{ $subtract: ['$sellingPriceMinor', { $ifNull: ['$discountMinor', 0] }] }, '$basePriceMinor'] } },
          },
        },
      ]),
    ]);
    const byStatus = Object.fromEntries(counts.map((item) => [item._id, item.count]));
    return {
      awaitingCommercial,
      drafts: byStatus.draft || 0,
      awaitingPricing: await Product.countDocuments({ ...scope, status: ProductStatus.DRAFT, sellingPriceMinor: { $exists: false } }),
      awaitingNegotiationConfiguration: await Product.countDocuments({ ...scope, status: ProductStatus.DRAFT, negotiationRules: { $exists: false } }),
      published: byStatus.published || 0,
      paused: byStatus.paused || 0,
      availabilityUnconfirmed: staleAvailability + (byStatus.availability_unconfirmed || 0),
      averageMarginMinor: Math.round(margin[0]?.averageMarginMinor || 0),
    };
  }

  async list(query: Record<string, unknown>, stateIds?: string[]) {
    const limit = Math.min(Math.max(Number(query.limit || 20), 1), 50);
    const filter: Record<string, any> = { deletedAt: { $exists: false } };
    if (stateIds?.length) filter.sourceStateId = { $in: stateIds };
    if (query.status) filter.status = query.status;
    if (query.stateId) filter.sourceStateId = query.stateId;
    if (query.marketId) filter.marketId = query.marketId;
    if (query.categoryId) filter.categoryId = query.categoryId;
    if (query.cursor) filter._id = { $lt: query.cursor };
    if (query.q) filter.$text = { $search: String(query.q) };
    const data = await Product.find(filter).sort({ _id: -1 }).limit(limit + 1).lean({ virtuals: true });
    const hasMore = data.length > limit;
    const page = data.slice(0, limit);
    return {
      data: page.map(this.internalSummary),
      nextCursor: hasMore && page.length ? page[page.length - 1]._id.toString() : null,
      hasMore,
    };
  }

  async detail(identifier: string, stateIds?: string[]) {
    const product = await productRecord(identifier, stateIds);
    const [submission, variants, category, market, media] = await Promise.all([
      product.sourceSubmissionId ? ProductSubmission.findById(product.sourceSubmissionId).lean({ virtuals: true }) : null,
      ProductVariant.find({ productId: product._id.toString(), deletedAt: { $exists: false } }).sort({ createdAt: 1 }).lean({ virtuals: true }),
      product.categoryId ? Category.findById(product.categoryId).lean({ virtuals: true }) : null,
      product.marketId ? Market.findById(product.marketId).lean({ virtuals: true }) : null,
      CatalogMediaAsset.find({
        $or: [
          { publicId: { $in: product.mediaAssetIds || [] } },
          { _id: { $in: (product.mediaAssetIds || []).filter((id: string) => /^[a-f\d]{24}$/i.test(id)) } },
        ],
        status: 'ready',
      }).sort({ order: 1 }).lean({ virtuals: true }),
    ]);
    return {
      ...this.internalSummary(product),
      submission,
      variants,
      category,
      market,
      media: media.map((asset) => ({
        ...asset,
        deliveryUrl: asset.deliveryType === 'external'
          ? asset.secureUrl
          : new CatalogMediaService().deliveryUrl(asset),
      })),
    };
  }

  internalSummary(product: any) {
    const pricing = product.basePriceMinor && product.sellingPriceMinor
      ? derivedPricing(product.basePriceMinor, product.sellingPriceMinor, product.discountMinor || 0)
      : undefined;
    return {
      ...product,
      id: product.publicId || product.hookId || product.id,
      catalogVersion: product.catalogVersion || 1,
      pricing,
    };
  }

  async update(identifier: string, input: any, actorId: string, stateIds?: string[]) {
    const current = await productRecord(identifier, stateIds);
    const filter = versionFilter(current, input.version);
    if (input.categoryId) {
      const category = await byIdentifier<any>(Category, input.categoryId);
      if (!category.isActive) throw new HttpError(409, 'The selected category is inactive', undefined, 'CONFLICT');
      input.categoryId = category._id.toString();
    }
    if (input.mediaAssetIds) {
      const assets = await CatalogMediaAsset.find({
        $or: [{ publicId: { $in: input.mediaAssetIds } }, { _id: { $in: input.mediaAssetIds.filter((id: string) => /^[a-f\d]{24}$/i.test(id)) } }],
        status: 'ready',
      }).lean({ virtuals: true });
      if (assets.length !== new Set(input.mediaAssetIds).size) throw new HttpError(400, 'One or more product images are invalid');
      if (assets.some((asset) => asset.ownerId && asset.ownerId !== current._id.toString())) {
        throw new HttpError(409, 'An image is already attached to another catalog record', undefined, 'CONFLICT');
      }
      if (assets.some((asset) => !asset.ownerId && asset.uploaderAccountId !== actorId)) {
        throw new HttpError(403, 'An image belongs to another uploader', undefined, 'ACCESS_DENIED');
      }
      await CatalogMediaAsset.updateMany(
        { _id: { $in: assets.map((asset) => asset._id) } },
        { $set: { ownerType: 'product', ownerId: current._id.toString() } },
      );
    }
    const { version, variantUpdates, ...updates } = input;
    const updated = await Product.findOneAndUpdate(
      filter,
      { $set: updates, $inc: { catalogVersion: 1 } },
      { returnDocument: 'after' },
    ).lean({ virtuals: true });
    if (!updated) throw new HttpError(409, 'This product was updated elsewhere', undefined, 'STALE_VERSION');
    if (variantUpdates) {
      for (const variant of variantUpdates) {
        if (!variant.id) continue;
        await ProductVariant.updateOne(
          { $or: [{ _id: variant.id }, { publicId: variant.id }], productId: current._id.toString() },
          { $set: { size: variant.size, colour: variant.colour, attributes: variant.attributes, active: variant.active } },
        );
      }
    }
    return this.detail(updated.publicId || updated._id.toString(), stateIds);
  }

  async pricing(identifier: string, input: any, actorId: string, stateIds?: string[]) {
    const current = await productRecord(identifier, stateIds);
    const pricing = derivedPricing(input.basePriceMinor, input.sellingPriceMinor, input.discountMinor);
    const updated = await Product.findOneAndUpdate(
      versionFilter(current, input.version),
      {
        $set: {
          basePriceMinor: pricing.basePriceMinor,
          sellingPriceMinor: pricing.sellingPriceMinor,
          markupMinor: pricing.markupMinor,
          discountMinor: pricing.discountMinor,
          currency: input.currency,
          costPrice: pricing.basePriceMinor / 100,
          sellingPrice: pricing.sellingPriceMinor / 100,
          discountedPrice: pricing.effectivePriceMinor / 100,
          lastPriceVerifiedAt: new Date(),
          'commercialApproval.pricingBy': actorId,
        },
        $inc: { catalogVersion: 1 },
      },
      { returnDocument: 'after' },
    ).lean({ virtuals: true });
    if (!updated) throw new HttpError(409, 'This product was updated elsewhere', undefined, 'STALE_VERSION');
    return this.internalSummary(updated);
  }

  async rules(identifier: string, input: any, actorId: string, stateIds?: string[]) {
    const current = await productRecord(identifier, stateIds);
    if (input.enabled) {
      if (!current.sellingPriceMinor || !input.minimumNegotiablePriceMinor) {
        throw new HttpError(400, 'Set product pricing before enabling negotiation', undefined, 'PRODUCT_PRICING_INVALID');
      }
      const discountFloor = current.sellingPriceMinor - Number(input.maximumDiscountMinor || 0);
      if (
        input.minimumNegotiablePriceMinor > current.sellingPriceMinor
        || input.minimumNegotiablePriceMinor < current.basePriceMinor
        || input.minimumNegotiablePriceMinor < discountFloor
      ) {
        throw new HttpError(400, 'Negotiation rules exceed approved pricing boundaries', undefined, 'PRICING_BOUNDARY_VIOLATION');
      }
    }
    const updated = await Product.findOneAndUpdate(
      versionFilter(current, input.version),
      {
        $set: {
          negotiationRules: {
            enabled: input.enabled,
            minimumNegotiablePriceMinor: input.enabled ? input.minimumNegotiablePriceMinor : undefined,
            maximumDiscountMinor: input.enabled ? input.maximumDiscountMinor : undefined,
            maximumCustomerOffers: 3,
            acceptedQuoteExpiryMinutes: 30,
            updatedBy: actorId,
            updatedAt: new Date(),
          },
          minAcceptablePrice: input.enabled ? input.minimumNegotiablePriceMinor / 100 : current.sellingPrice,
        },
        $inc: { catalogVersion: 1 },
      },
      { returnDocument: 'after' },
    ).lean({ virtuals: true });
    if (!updated) throw new HttpError(409, 'This product was updated elsewhere', undefined, 'STALE_VERSION');
    return this.internalSummary(updated);
  }

  async lifecycle(
    identifier: string,
    action: 'publish' | 'pause' | 'unpublish' | 'availability_unconfirmed',
    input: { reason: string; version: number },
    actorId: string,
    stateIds?: string[],
  ) {
    const current = await productRecord(identifier, stateIds);
    let nextStatus: ProductStatus;
    if (action === 'publish') {
      const [submission, market, category, variants, mediaCount] = await Promise.all([
        current.sourceSubmissionId ? ProductSubmission.findById(current.sourceSubmissionId).lean() : null,
        current.marketId ? Market.findById(current.marketId).lean() : null,
        current.categoryId ? Category.findById(current.categoryId).lean() : null,
        ProductVariant.countDocuments({ productId: current._id.toString(), active: true, deletedAt: { $exists: false } }),
        CatalogMediaAsset.countDocuments({
          $or: [
            { publicId: { $in: current.mediaAssetIds || [] } },
            { _id: { $in: (current.mediaAssetIds || []).filter((id: string) => /^[a-f\d]{24}$/i.test(id)) } },
          ],
          status: 'ready',
        }),
      ]);
      const missing: string[] = [];
      if (!submission || submission.status !== 'approved') missing.push('approvedSubmission');
      if (!market || market.status !== 'active') missing.push('activeMarket');
      if (!category || !category.isActive) missing.push('activeCategory');
      if (!current.title?.trim()) missing.push('title');
      if (!current.description || current.description.trim().length < 20) missing.push('description');
      if (!current.sellingPriceMinor) missing.push('sellingPrice');
      if (!variants) missing.push('variants');
      if (!mediaCount) missing.push('media');
      if (
        current.negotiationRules?.enabled
        && (!current.negotiationRules.minimumNegotiablePriceMinor || current.negotiationRules.maximumDiscountMinor === undefined)
      ) missing.push('negotiationRules');
      if (missing.length) {
        throw new HttpError(
          409,
          'Product publication requirements are not met',
          { fields: missing },
          'PRODUCT_PUBLICATION_REQUIREMENTS_NOT_MET',
        );
      }
      nextStatus = ProductStatus.PUBLISHED;
    } else if (action === 'pause') nextStatus = ProductStatus.PAUSED;
    else if (action === 'availability_unconfirmed') nextStatus = ProductStatus.AVAILABILITY_UNCONFIRMED;
    else nextStatus = ProductStatus.UNPUBLISHED;

    const updated = await Product.findOneAndUpdate(
      versionFilter(current, input.version),
      {
        $set: {
          status: nextStatus,
          ...(nextStatus === ProductStatus.PUBLISHED
            ? {
                publishedAt: new Date(),
                publishedBy: actorId,
                commercialApproval: { ...(current.commercialApproval || {}), approved: true, approvedBy: actorId, approvedAt: new Date() },
              }
            : {}),
          ...(nextStatus === ProductStatus.AVAILABILITY_UNCONFIRMED
            ? { availabilityStatus: ProductAvailabilityStatus.UNCONFIRMED }
            : {}),
          lifecycleReason: input.reason,
        },
        $inc: { catalogVersion: 1 },
      },
      { returnDocument: 'after' },
    ).lean({ virtuals: true });
    if (!updated) throw new HttpError(409, 'This product was updated elsewhere', undefined, 'STALE_VERSION');
    return this.internalSummary(updated);
  }
}

export async function publicProductRepresentation(product: any) {
  const [category, market, state, variants, media] = await Promise.all([
    Category.findById(product.categoryId).select('publicId name slug iconUrl').lean({ virtuals: true }),
    Market.findById(product.marketId).select('publicId name stateId cityId').lean({ virtuals: true }),
    OperationState.findById(product.sourceStateId).select('publicId name code').lean({ virtuals: true }),
    ProductVariant.find({ productId: product._id.toString(), active: true, deletedAt: { $exists: false } })
      .select('publicId sku size colour attributes mediaAssetIds')
      .lean({ virtuals: true }),
    CatalogMediaAsset.find({
      $or: [
        { publicId: { $in: product.mediaAssetIds || [] } },
        { _id: { $in: (product.mediaAssetIds || []).filter((id: string) => /^[a-f\d]{24}$/i.test(id)) } },
      ],
      status: 'ready',
    }).sort({ order: 1 }).lean({ virtuals: true }),
  ]);
  const mediaService = new CatalogMediaService();
  const effectivePriceMinor = Number(product.sellingPriceMinor || 0) - Number(product.discountMinor || 0);
  return {
    publicId: product.publicId,
    title: product.title,
    slug: product.slug,
    description: product.description,
    media: media.map((asset) => ({
      type: 'image',
      url: asset.deliveryType === 'external' ? asset.secureUrl : mediaService.deliveryUrl(asset),
      width: asset.width,
      height: asset.height,
      alt: product.title,
    })),
    sourceState: state ? { publicId: state.publicId, name: state.name, code: state.code } : null,
    market: market ? { publicId: market.publicId, name: market.name } : null,
    category: category ? {
      publicId: category.publicId,
      name: category.name,
      slug: category.slug,
      iconUrl: category.iconUrl || null,
    } : null,
    variants: variants.map((variant: any) => ({
      publicId: variant.publicId,
      size: variant.size || null,
      colour: variant.colour || null,
      attributes: variant.attributes || {},
    })),
    currency: product.currency || 'NGN',
    sellingPriceMinor: product.sellingPriceMinor,
    effectivePriceMinor,
    discountMinor: product.discountMinor || 0,
    negotiationAvailable: Boolean(product.negotiationRules?.enabled),
    availabilityStatus: product.availabilityStatus,
    availabilityNote: product.customerAvailabilityNote,
    publishedAt: product.publishedAt,
  };
}
