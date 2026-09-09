import { ProductAvailabilityStatus, ProductStatus } from "@lib/constants";
import { Category } from "@models/categories/category.model";
import {
  CatalogMediaAsset,
  ProductSubmission,
  ProductVariant,
} from "@models/catalog/catalog.model";
import { Market } from "@models/platform/network.model";
import { OperationState } from "@models/platform/geography.model";
import { Product } from "@models/products/product.model";
import { CatalogMediaService } from "./catalog-media.service";
import { byIdentifier } from "./catalog.service";
import { HttpError } from "@utils/http";
import { publishRealtime } from "@services/realtime.service";
import { CommerceSettings } from "@models/commerce/commerce.model";
import { getLowStockThreshold } from "@services/inventory-settings.service";

async function nextAvailabilityDeadline(from = new Date()) {
  const settings = await CommerceSettings.findOne({ key: "commerce" })
    .select("catalogAvailabilityCheckDays")
    .lean();
  const days = Math.min(
    Math.max(Number(settings?.catalogAvailabilityCheckDays || 4), 1),
    30,
  );
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

function versionFilter(record: any, version: number) {
  if (Number(record.catalogVersion || record.__v || 1) !== version) {
    throw new HttpError(
      409,
      "This product was updated elsewhere",
      undefined,
      "STALE_VERSION",
    );
  }
  return record.catalogVersion === undefined
    ? {
        _id: record._id,
        $or: [
          { catalogVersion: { $exists: false } },
          { catalogVersion: version },
        ],
      }
    : { _id: record._id, catalogVersion: version };
}

function derivedPricing(
  basePriceMinor: number,
  sellingPriceMinor: number,
  discountMinor: number,
) {
  if (
    ![basePriceMinor, sellingPriceMinor, discountMinor].every(
      Number.isSafeInteger,
    )
  ) {
    throw new HttpError(
      400,
      "Prices must use integer minor units",
      undefined,
      "PRODUCT_PRICING_INVALID",
    );
  }
  if (
    basePriceMinor <= 0 ||
    sellingPriceMinor <= 0 ||
    discountMinor < 0 ||
    discountMinor >= sellingPriceMinor
  ) {
    throw new HttpError(
      400,
      "Product pricing is invalid",
      undefined,
      "PRODUCT_PRICING_INVALID",
    );
  }
  const effectivePriceMinor = sellingPriceMinor - discountMinor;
  const markupMinor = sellingPriceMinor - basePriceMinor;
  if (markupMinor < 0 || effectivePriceMinor < basePriceMinor) {
    throw new HttpError(
      400,
      "Customer price cannot be below the approved base market price",
      undefined,
      "PRODUCT_PRICING_INVALID",
    );
  }
  const marginMinor = effectivePriceMinor - basePriceMinor;
  return {
    basePriceMinor,
    sellingPriceMinor,
    discountMinor,
    effectivePriceMinor,
    markupMinor,
    marginMinor,
    marginPercentage: Number(
      ((marginMinor / effectivePriceMinor) * 100).toFixed(2),
    ),
  };
}

async function productRecord(identifier: string, stateIds?: string[]) {
  const product = await byIdentifier<any>(Product, identifier);
  if (
    stateIds?.length &&
    (!product.sourceStateId || !stateIds.includes(product.sourceStateId))
  ) {
    throw new HttpError(404, "Product not found", undefined, "NOT_FOUND");
  }
  return product;
}

export class CommercialCatalogService {
  async dashboard(stateIds?: string[]) {
    const scope = stateIds?.length ? { sourceStateId: { $in: stateIds } } : {};
    const [
      counts,
      awaitingCommercial,
      staleAvailability,
      margin,
      awaitingPricing,
      awaitingNegotiationConfiguration,
    ] = await Promise.all([
      Product.aggregate([
        { $match: scope },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Product.countDocuments({
        ...scope,
        status: ProductStatus.DRAFT,
        "commercialApproval.approved": { $ne: true },
      }),
      Product.countDocuments({
        ...scope,
        status: ProductStatus.PUBLISHED,
        $or: [
          { lastAvailabilityConfirmedAt: { $exists: false } },
          {
            lastAvailabilityConfirmedAt: {
              $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            },
          },
        ],
      }),
      Product.aggregate([
        {
          $match: {
            ...scope,
            sellingPriceMinor: { $gt: 0 },
            basePriceMinor: { $gt: 0 },
          },
        },
        {
          $group: {
            _id: null,
            averageMarginMinor: {
              $avg: {
                $subtract: [
                  {
                    $subtract: [
                      "$sellingPriceMinor",
                      { $ifNull: ["$discountMinor", 0] },
                    ],
                  },
                  "$basePriceMinor",
                ],
              },
            },
          },
        },
      ]),
      Product.countDocuments({
        ...scope,
        status: ProductStatus.DRAFT,
        sellingPriceMinor: { $exists: false },
      }),
      Product.countDocuments({
        ...scope,
        status: ProductStatus.DRAFT,
        negotiationRules: { $exists: false },
      }),
    ]);
    const byStatus = Object.fromEntries(
      counts.map((item) => [item._id, item.count]),
    );
    return {
      awaitingCommercial,
      drafts: byStatus.draft || 0,
      awaitingPricing,
      awaitingNegotiationConfiguration,
      published: byStatus.published || 0,
      paused: byStatus.paused || 0,
      availabilityUnconfirmed:
        staleAvailability + (byStatus.availability_unconfirmed || 0),
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
    const data = await Product.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean({ virtuals: true });
    const hasMore = data.length > limit;
    const page = data.slice(0, limit);
    return {
      data: page.map(this.internalSummary),
      nextCursor:
        hasMore && page.length ? page[page.length - 1]._id.toString() : null,
      hasMore,
    };
  }

  async detail(identifier: string, stateIds?: string[]) {
    const product = await productRecord(identifier, stateIds);
    const [submission, variants, category, market, media] = await Promise.all([
      product.sourceSubmissionId
        ? ProductSubmission.findById(product.sourceSubmissionId).lean({
            virtuals: true,
          })
        : null,
      ProductVariant.find({
        productId: product._id.toString(),
        deletedAt: { $exists: false },
      })
        .sort({ createdAt: 1 })
        .lean({ virtuals: true }),
      product.categoryId
        ? Category.findById(product.categoryId).lean({ virtuals: true })
        : null,
      product.marketId
        ? Market.findById(product.marketId).lean({ virtuals: true })
        : null,
      CatalogMediaAsset.find({
        $or: [
          { publicId: { $in: product.mediaAssetIds || [] } },
          {
            _id: {
              $in: (product.mediaAssetIds || []).filter((id: string) =>
                /^[a-f\d]{24}$/i.test(id),
              ),
            },
          },
        ],
        status: "ready",
      })
        .sort({ order: 1 })
        .lean({ virtuals: true }),
    ]);
    return {
      ...this.internalSummary(product),
      submission,
      variants,
      category,
      market,
      media: media.map((asset) => ({
        ...asset,
        deliveryUrl:
          asset.deliveryType === "external"
            ? asset.secureUrl
            : new CatalogMediaService().deliveryUrl(asset),
      })),
    };
  }

  internalSummary(product: any) {
    const pricing =
      product.basePriceMinor && product.sellingPriceMinor
        ? derivedPricing(
            product.basePriceMinor,
            product.sellingPriceMinor,
            product.discountMinor || 0,
          )
        : undefined;
    return {
      ...product,
      id: product.hookId || product.publicId || product.id,
      catalogVersion: product.catalogVersion || 1,
      pricing,
    };
  }

  async update(
    identifier: string,
    input: any,
    actorId: string,
    stateIds?: string[],
  ) {
    const current = await productRecord(identifier, stateIds);
    const filter = versionFilter(current, input.version);
    if (input.categoryId) {
      const category = await byIdentifier<any>(Category, input.categoryId);
      if (!category.isActive)
        throw new HttpError(
          409,
          "The selected category is inactive",
          undefined,
          "CONFLICT",
        );
      input.categoryId = category._id.toString();
    }
    if (input.mediaAssetIds) {
      const assets = await CatalogMediaAsset.find({
        $or: [
          { publicId: { $in: input.mediaAssetIds } },
          {
            _id: {
              $in: input.mediaAssetIds.filter((id: string) =>
                /^[a-f\d]{24}$/i.test(id),
              ),
            },
          },
        ],
        status: "ready",
      }).lean({ virtuals: true });
      if (assets.length !== new Set(input.mediaAssetIds).size)
        throw new HttpError(400, "One or more product images are invalid");
      if (
        assets.some(
          (asset) => asset.ownerId && asset.ownerId !== current._id.toString(),
        )
      ) {
        throw new HttpError(
          409,
          "An image is already attached to another catalog record",
          undefined,
          "CONFLICT",
        );
      }
      if (
        assets.some(
          (asset) => !asset.ownerId && asset.uploaderAccountId !== actorId,
        )
      ) {
        throw new HttpError(
          403,
          "An image belongs to another uploader",
          undefined,
          "ACCESS_DENIED",
        );
      }
      await CatalogMediaAsset.updateMany(
        { _id: { $in: assets.map((asset) => asset._id) } },
        { $set: { ownerType: "product", ownerId: current._id.toString() } },
      );
    }
    const { version, variantUpdates, ...updates } = input;
    const updated = await Product.findOneAndUpdate(
      filter,
      { $set: updates, $inc: { catalogVersion: 1 } },
      { returnDocument: "after" },
    ).lean({ virtuals: true });
    if (!updated)
      throw new HttpError(
        409,
        "This product was updated elsewhere",
        undefined,
        "STALE_VERSION",
      );
    if (variantUpdates) {
      for (const variant of variantUpdates) {
        if (!variant.id) continue;
        await ProductVariant.updateOne(
          {
            $or: [{ _id: variant.id }, { publicId: variant.id }],
            productId: current._id.toString(),
          },
          {
            $set: {
              size: variant.size,
              colour: variant.colour,
              attributes: variant.attributes,
              active: variant.active,
            },
          },
        );
      }
    }
    const detail = await this.detail(
      updated.publicId || updated._id.toString(),
      stateIds,
    );
    this.publishCatalogUpdate(updated);
    return detail;
  }

  async pricing(
    identifier: string,
    input: any,
    actorId: string,
    stateIds?: string[],
  ) {
    const current = await productRecord(identifier, stateIds);
    const pricing = derivedPricing(
      input.basePriceMinor,
      input.sellingPriceMinor,
      input.discountMinor,
    );
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
          "commercialApproval.pricingBy": actorId,
        },
        $inc: { catalogVersion: 1 },
      },
      { returnDocument: "after" },
    ).lean({ virtuals: true });
    if (!updated)
      throw new HttpError(
        409,
        "This product was updated elsewhere",
        undefined,
        "STALE_VERSION",
      );
    this.publishCatalogUpdate(updated);
    return this.internalSummary(updated);
  }

  async rules(
    identifier: string,
    input: any,
    actorId: string,
    stateIds?: string[],
  ) {
    const current = await productRecord(identifier, stateIds);
    if (input.enabled) {
      if (!current.sellingPriceMinor || !input.minimumNegotiablePriceMinor) {
        throw new HttpError(
          400,
          "Set product pricing before enabling negotiation",
          undefined,
          "PRODUCT_PRICING_INVALID",
        );
      }
      const discountFloor =
        current.sellingPriceMinor - Number(input.maximumDiscountMinor || 0);
      if (
        input.minimumNegotiablePriceMinor > current.sellingPriceMinor ||
        input.minimumNegotiablePriceMinor < current.basePriceMinor ||
        input.minimumNegotiablePriceMinor < discountFloor
      ) {
        throw new HttpError(
          400,
          "Negotiation rules exceed approved pricing boundaries",
          undefined,
          "PRICING_BOUNDARY_VIOLATION",
        );
      }
    }
    const updated = await Product.findOneAndUpdate(
      versionFilter(current, input.version),
      {
        $set: {
          negotiationRules: {
            enabled: input.enabled,
            minimumNegotiablePriceMinor: input.enabled
              ? input.minimumNegotiablePriceMinor
              : undefined,
            maximumDiscountMinor: input.enabled
              ? input.maximumDiscountMinor
              : undefined,
            maximumCustomerOffers: 3,
            acceptedQuoteExpiryMinutes: 30,
            updatedBy: actorId,
            updatedAt: new Date(),
          },
          minAcceptablePrice: input.enabled
            ? input.minimumNegotiablePriceMinor / 100
            : current.sellingPrice,
        },
        $inc: { catalogVersion: 1 },
      },
      { returnDocument: "after" },
    ).lean({ virtuals: true });
    if (!updated)
      throw new HttpError(
        409,
        "This product was updated elsewhere",
        undefined,
        "STALE_VERSION",
      );
    this.publishCatalogUpdate(updated);
    return this.internalSummary(updated);
  }

  async lifecycle(
    identifier: string,
    action: "publish" | "pause" | "unpublish" | "availability_unconfirmed",
    input: { reason: string; version: number },
    actorId: string,
    stateIds?: string[],
  ) {
    const current = await productRecord(identifier, stateIds);
    let nextStatus: ProductStatus;
    let availabilityValidUntil: Date | undefined;
    if (action === "publish") {
      const [submission, market, category, variants, mediaCount, nextDeadline] =
        await Promise.all([
          current.sourceSubmissionId
            ? ProductSubmission.findById(current.sourceSubmissionId).lean()
            : null,
          current.marketId ? Market.findById(current.marketId).lean() : null,
          current.categoryId
            ? Category.findById(current.categoryId).lean()
            : null,
          ProductVariant.countDocuments({
            productId: current._id.toString(),
            active: true,
            deletedAt: { $exists: false },
          }),
          CatalogMediaAsset.countDocuments({
            $or: [
              { publicId: { $in: current.mediaAssetIds || [] } },
              {
                _id: {
                  $in: (current.mediaAssetIds || []).filter((id: string) =>
                    /^[a-f\d]{24}$/i.test(id),
                  ),
                },
              },
            ],
            status: "ready",
          }),
          nextAvailabilityDeadline(),
        ]);
      availabilityValidUntil = nextDeadline;
      const missing: string[] = [];
      // Products created directly (Product Inventory, or a Product Submission
      // approved into a live product) have no sourceSubmissionId at all — only
      // require an approved submission when the product actually originated
      // from one.
      if (current.sourceSubmissionId && (!submission || submission.status !== "approved"))
        missing.push("approvedSubmission");
      if (!market || market.status !== "active") missing.push("activeMarket");
      if (!category || !category.isActive) missing.push("activeCategory");
      if (!current.title?.trim()) missing.push("title");
      if (!current.description || current.description.trim().length < 20)
        missing.push("description");
      if (!current.sellingPriceMinor) missing.push("sellingPrice");
      if (!variants) missing.push("variants");
      if (!mediaCount) missing.push("media");
      if (
        current.negotiationRules?.enabled &&
        (!current.negotiationRules.minimumNegotiablePriceMinor ||
          current.negotiationRules.maximumDiscountMinor === undefined)
      )
        missing.push("negotiationRules");
      if (missing.length) {
        throw new HttpError(
          409,
          "Product publication requirements are not met",
          { fields: missing },
          "PRODUCT_PUBLICATION_REQUIREMENTS_NOT_MET",
        );
      }
      nextStatus = ProductStatus.PUBLISHED;
    } else if (action === "pause") nextStatus = ProductStatus.PAUSED;
    else if (action === "availability_unconfirmed")
      nextStatus = ProductStatus.AVAILABILITY_UNCONFIRMED;
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
                availabilityStatus: ProductAvailabilityStatus.AVAILABLE,
                lastAvailabilityConfirmedAt: new Date(),
                availabilityValidUntil,
                commercialApproval: {
                  ...(current.commercialApproval || {}),
                  approved: true,
                  approvedBy: actorId,
                  approvedAt: new Date(),
                },
              }
            : {}),
          ...(nextStatus === ProductStatus.AVAILABILITY_UNCONFIRMED
            ? { availabilityStatus: ProductAvailabilityStatus.UNCONFIRMED }
            : {}),
          lifecycleReason: input.reason,
        },
        $inc: { catalogVersion: 1 },
      },
      { returnDocument: "after" },
    ).lean({ virtuals: true });
    if (!updated)
      throw new HttpError(
        409,
        "This product was updated elsewhere",
        undefined,
        "STALE_VERSION",
      );
    this.publishCatalogUpdate(updated);
    return this.internalSummary(updated);
  }

  private publishCatalogUpdate(product: any) {
    const event = {
      entityId: product.publicId || product._id?.toString(),
      version: Number(product.catalogVersion || 1),
      scope: product.sourceStateId
        ? { stateId: String(product.sourceStateId) }
        : undefined,
    };
    publishRealtime(
      { type: "catalog.updated", entityType: "product", ...event },
      { public: true, admin: true },
    );
    publishRealtime(
      { type: "home.updated", entityType: "product", ...event },
      { public: true, admin: true },
    );
    publishRealtime(
      { type: "admin.dashboard.updated", ...event },
      { admin: true },
    );
  }
}

type PublicCatalogPresentationOptions = { compact?: boolean };

function idOf(record: any) {
  return record?._id?.toString?.() || record?.id || "";
}

function identifierFilter(ids: string[]) {
  const mongoIds = ids.filter((id) => /^[a-f\d]{24}$/i.test(String(id)));
  return {
    $or: [
      ...(mongoIds.length ? [{ _id: { $in: mongoIds } }] : []),
      ...(ids.length ? [{ publicId: { $in: ids } }] : []),
    ],
  };
}

function legacyMedia(product: any) {
  if (!Array.isArray(product.images)) return [];
  return product.images
    .map((image: any) => (typeof image === "string" ? { url: image } : image))
    .filter(
      (image: any) => typeof image?.url === "string" && image.url.length > 0,
    )
    .map((image: any) => ({
      type: "image",
      url: image.url,
      width: Number(image.width || 0),
      height: Number(image.height || 0),
      alt: product.title,
    }));
}

/** Hydrates a page with one query per related collection instead of N+1 reads. */
export async function publicProductRepresentations(
  products: any[],
  options: PublicCatalogPresentationOptions = {},
) {
  if (!products.length) return [];
  const productIdentifiers = [
    ...new Set(
      products
        .flatMap((product) => [idOf(product), product.publicId])
        .filter(Boolean)
        .map(String),
    ),
  ];
  const categoryIds = [
    ...new Set(
      products
        .map((product) => String(product.categoryId || ""))
        .filter(Boolean),
    ),
  ];
  const marketIds = [
    ...new Set(
      products.map((product) => String(product.marketId || "")).filter(Boolean),
    ),
  ];
  const stateIds = [
    ...new Set(
      products
        .map((product) => String(product.sourceStateId || ""))
        .filter(Boolean),
    ),
  ];
  const mediaIds = [
    ...new Set(
      products.flatMap((product) =>
        Array.isArray(product.mediaAssetIds) ? product.mediaAssetIds : [],
      ),
    ),
  ];
  const mongoMediaIds = mediaIds.filter((id: string) =>
    /^[a-f\d]{24}$/i.test(String(id)),
  );

  const [categories, markets, states, variants, media] = await Promise.all([
    categoryIds.length
      ? Category.find(identifierFilter(categoryIds))
          .select("publicId name slug iconUrl attributeSchema")
          .lean({ virtuals: true })
      : Promise.resolve([]),
    marketIds.length
      ? Market.find(identifierFilter(marketIds))
          .select("publicId name stateId cityId")
          .lean({ virtuals: true })
      : Promise.resolve([]),
    stateIds.length
      ? OperationState.find(identifierFilter(stateIds))
          .select("publicId name code")
          .lean({ virtuals: true })
      : Promise.resolve([]),
    options.compact
      ? Promise.resolve([])
      : ProductVariant.find({
          productId: { $in: productIdentifiers },
          active: true,
          deletedAt: { $exists: false },
        })
          .select("publicId productId sku size colour attributes mediaAssetIds")
          .lean({ virtuals: true }),
    mediaIds.length
      ? CatalogMediaAsset.find({
          $or: [
            { publicId: { $in: mediaIds } },
            ...(mongoMediaIds.length ? [{ _id: { $in: mongoMediaIds } }] : []),
          ],
          status: "ready",
        })
          .sort({ order: 1 })
          .lean({ virtuals: true })
      : Promise.resolve([]),
  ]);

  const lowStockThreshold = await getLowStockThreshold();

  const mapByIdentifier = (records: any[]) => {
    const map = new Map<string, any>();
    records.forEach((item) => {
      map.set(idOf(item), item);
      if (item.publicId) map.set(String(item.publicId), item);
    });
    return map;
  };
  const categoryMap = mapByIdentifier(categories as any[]);
  const marketMap = mapByIdentifier(markets as any[]);
  const stateMap = mapByIdentifier(states as any[]);
  const variantsMap = new Map<string, any[]>();
  for (const variant of variants as any[]) {
    const key = String(variant.productId || "");
    variantsMap.set(key, [...(variantsMap.get(key) || []), variant]);
  }
  for (const product of products) {
    const productId = idOf(product);
    if (product.publicId && productId !== String(product.publicId)) {
      variantsMap.set(
        String(product.publicId),
        variantsMap.get(productId) || [],
      );
    }
  }
  const mediaMap = new Map<string, any>();
  for (const asset of media as any[]) {
    mediaMap.set(idOf(asset), asset);
    if (asset.publicId) mediaMap.set(String(asset.publicId), asset);
  }
  const mediaService = new CatalogMediaService();

  return products.map((product) => {
    const productId = idOf(product);
    const category = categoryMap.get(String(product.categoryId));
    const market = marketMap.get(String(product.marketId));
    const state = stateMap.get(String(product.sourceStateId));
    const productMedia = (
      Array.isArray(product.mediaAssetIds) ? product.mediaAssetIds : []
    )
      .map((mediaId: string) => mediaMap.get(String(mediaId)))
      .filter(Boolean)
      .map((asset: any) => ({
        type: "image",
        url:
          asset.deliveryType === "external"
            ? asset.secureUrl
            : mediaService.deliveryUrl(asset),
        width: asset.width,
        height: asset.height,
        alt: product.title,
      }));
    const mediaPresentation = productMedia.length
      ? productMedia
      : legacyMedia(product);
    const effectivePriceMinor =
      Number(product.sellingPriceMinor || 0) -
      Number(product.discountMinor || 0);
    const isPurchasable =
      product.status === ProductStatus.PUBLISHED &&
      [
        ProductAvailabilityStatus.AVAILABLE,
        ProductAvailabilityStatus.LIMITED,
      ].includes(product.availabilityStatus);
    const storedVariants = variantsMap.get(productId) || [];
    const legacyColors = [
      ...new Set(
        (product.colors || [])
          .map((value: unknown) => String(value).trim())
          .filter(Boolean),
      ),
    ];
    const legacySizes = [
      ...new Set(
        (product.sizes || [])
          .map((value: unknown) => String(value).trim())
          .filter(Boolean),
      ),
    ];
    const fallbackVariants = storedVariants.length
      ? []
      : legacyColors.length && legacySizes.length
        ? legacyColors.flatMap((colour) =>
            legacySizes.map((size) => ({ colour, size })),
          )
        : legacyColors.length
          ? legacyColors.map((colour) => ({ colour }))
          : legacySizes.map((size) => ({ size }));
    const productVariants = options.compact
      ? []
      : [...storedVariants, ...fallbackVariants].map((variant: any) => ({
          publicId: variant.publicId,
          size: variant.size || null,
          colour: variant.colour || null,
          attributes: variant.attributes || {},
        }));
    const compact = {
      publicId: product.publicId,
      title: product.title,
      slug: product.slug,
      media: options.compact
        ? mediaPresentation.slice(0, 1)
        : mediaPresentation,
      sourceState: state
        ? { publicId: state.publicId, name: state.name, code: state.code }
        : null,
      market: market ? { publicId: market.publicId, name: market.name } : null,
      category: category
        ? {
            publicId: category.publicId,
            name: category.name,
            slug: category.slug,
            iconUrl: category.iconUrl || null,
            sizingGuide: (category as any).attributeSchema?.sizingGuide || null,
          }
        : null,
      variants: productVariants,
      currency: product.currency || "NGN",
      sellingPriceMinor: product.sellingPriceMinor,
      effectivePriceMinor,
      discountMinor: product.discountMinor || 0,
      negotiationAvailable:
        isPurchasable && Boolean(product.negotiationRules?.enabled),
      availabilityStatus: product.availabilityStatus,
      isPurchasable,
      availableQuantity: Math.max(
        0,
        Number(product.quantity || 0) - Number(product.reservedQuantity || 0),
      ),
      lowStockThreshold,
    };
    return options.compact
      ? compact
      : {
          ...compact,
          description: product.description,
          media: mediaPresentation,
          variants: productVariants,
          availabilityNote: product.customerAvailabilityNote,
          publishedAt: product.publishedAt,
        };
  });
}

export async function publicProductRepresentation(product: any) {
  const [representation] = await publicProductRepresentations([product]);
  return representation;
}

export async function publicProductSummaryRepresentation(product: any) {
  const [representation] = await publicProductRepresentations([product], {
    compact: true,
  });
  return representation;
}
