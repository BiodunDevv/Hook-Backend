import { Request, Response } from 'express';
import { ProductAvailabilityStatus, ProductStatus, UserRole } from '@lib/constants';
import { auditAdminAction } from '@lib/audit';
import { HttpError, sendCreated, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';
import { publicProduct } from '@lib/public-resource';
import { Product } from '@models/products/product.model';
import { Category } from '@models/categories/category.model';
import { User } from '@models/users/user.model';
import { Market } from '@models/platform/network.model';
import { MarketVendor } from '@models/catalog/market-vendor.model';
import { hookIdFromPublicId, nextPublicId } from '@services/public-id.service';
import { adminCategoryManagersCache, adminProductStatsCache } from '@lib/ttl-cache';
import { publishRealtime } from '@services/realtime.service';
import { CommerceSettings } from '@models/commerce/commerce.model';
import { defaultNegotiationRules } from '@lib/negotiation-defaults';

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'product';
}

const MANAGER_ROLES: UserRole[] = [UserRole.SUPPORT, UserRole.ADMIN];

function referenceFilter(value: unknown) {
  const reference = String(value || '');
  if (!reference) return null;
  return /^[a-f\d]{24}$/i.test(reference) ? { _id: reference } : { publicId: reference };
}

async function activeCatalogRelations(categoryIdentifier: string, marketIdentifier: string) {
  const [category, market] = await Promise.all([
    Category.findOne(referenceFilter(categoryIdentifier) as any).lean({ virtuals: true }),
    Market.findOne(referenceFilter(marketIdentifier) as any).lean({ virtuals: true }),
  ]);
  if (!category) throw new HttpError(404, 'Category not found');
  if (!category.isActive) throw new HttpError(409, 'Select an active category', undefined, 'CONFLICT');
  if (!market) throw new HttpError(404, 'Market not found');
  if (market.status !== 'active') throw new HttpError(409, 'Select an active Market', undefined, 'CONFLICT');
  return { category, market };
}

/**
 * Resolves the vendor an admin picked for a product's "Vendor" field to its
 * internal id, and confirms it actually belongs to the product's own market
 * — a vendor is only ever attached to one market, so cross-market assignment
 * would silently misrepresent who supplies the product. An empty string is
 * the deliberate "no vendor / None" selection and resolves to `undefined`,
 * clearing the field rather than leaving a stale reference.
 */
async function resolveSourceVendor(identifier: unknown, marketObjectId: string) {
  const value = String(identifier ?? '').trim();
  if (!value) return undefined;
  const vendor = await MarketVendor.findOne(referenceFilter(value) as any).lean({ virtuals: true });
  if (!vendor) throw new HttpError(404, 'Vendor not found', undefined, 'NOT_FOUND');
  if (String(vendor.marketId) !== String(marketObjectId)) {
    throw new HttpError(409, 'Select a vendor that belongs to this product\'s Market', undefined, 'CONFLICT');
  }
  return vendor._id.toString();
}

async function availabilityDeadline() {
  const settings = await CommerceSettings.findOne({ key: 'commerce' }).select('catalogAvailabilityCheckDays').lean();
  const days = Math.min(Math.max(Number(settings?.catalogAvailabilityCheckDays || 4), 1), 30);
  return new Date(Date.now() + days * 86_400_000);
}

function publishProductUpdate(product: any) {
  const event = {
    entityId: product.publicId || product.id,
    version: Number(product.catalogVersion || 1),
    scope: product.sourceStateId ? { stateId: String(product.sourceStateId) } : undefined,
  };
  publishRealtime({ type: 'catalog.updated', entityType: 'product', ...event }, { public: true, admin: true });
  publishRealtime({ type: 'home.updated', entityType: 'product', ...event }, { public: true, admin: true });
  publishRealtime({ type: 'admin.dashboard.updated', ...event }, { admin: true });
}

function assertAdminPublishReady(product: Record<string, any>) {
  const missing: string[] = [];
  if (!String(product.description || '').trim() || String(product.description).trim().length < 20) missing.push('description');
  if (!Array.isArray(product.images) || !product.images.length) missing.push('images');
  if (Number(product.quantity || 0) < 1) missing.push('quantity');
  if (Number(product.costPrice || 0) <= 0) missing.push('costPrice');
  if (Number(product.sellingPrice || 0) <= 0) missing.push('sellingPrice');
  if (missing.length) {
    throw new HttpError(409, 'Complete the required product information before activation', { fields: missing }, 'CONFLICT');
  }
}

function adminProductSummary(product: any) {
  const { _id, ...safeProduct } = product;
  if (safeProduct.category) {
    const { _id: categoryMongoId, ...safeCategory } = safeProduct.category;
    safeProduct.category = {
      ...safeCategory,
      id: safeCategory.publicId || safeCategory.id || categoryMongoId?.toString?.(),
    };
  }
  return publicProduct(safeProduct);
}

// categoryId → managers, computed once per request (no N+1)
async function categoryManagersMap(): Promise<Map<string, any[]>> {
  const cached = adminCategoryManagersCache.get('active');
  if (cached) return cached;
  const users = await User.find({
    role: { $in: MANAGER_ROLES },
    isActive: true,
    assignedCategoryIds: { $exists: true, $ne: [] },
  })
    .select('firstName lastName email phone role assignedCategoryIds')
    .lean({ virtuals: true });
  const map = new Map<string, any[]>();
  for (const user of users as any[]) {
    if (!MANAGER_ROLES.includes(user.role) || !user.isActive) continue;
    for (const categoryId of user.assignedCategoryIds || []) {
      const bucket = map.get(categoryId) || [];
      bucket.push({
        id: user.publicId || user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone || null,
        role: user.role,
      });
      map.set(categoryId, bucket);
    }
  }
  return adminCategoryManagersCache.set('active', map);
}

export class AdminProductsController {
  reviewQueue = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const [data, total] = await adminRepos.products().findAndCount({
      where: { status: ProductStatus.PENDING_APPROVAL, deletedAt: { $exists: false } },
      relations: { category: true },
      order: { createdAt: 'ASC' },
      skip,
      take: limit,
    });
    sendSuccess(res, { ...paginated(data.map((product) => publicProduct(product as any)), total, page, limit), queueSize: total });
  };

  list = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : undefined;
    const where: Record<string, any> = { deletedAt: { $exists: false } };
    if (typeof req.query.status === 'string') where.status = req.query.status;
    if (typeof req.query.categoryId === 'string') where.categoryId = req.query.categoryId;
    if (req.query.stock === 'low') where.quantity = { $gt: 0, $lt: 10 };
    if (req.query.stock === 'out') where.quantity = 0;
    if (search) {
      const expression = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      where.$or = [{ title: expression }, { hookId: expression }, { publicId: expression }];
    }
    const listFields = 'publicId hookId title slug description costPrice sellingPrice discountedPrice minAcceptablePrice sellingPriceMinor discountMinor currency quantity reservedQuantity colors sizes images status categoryId marketId sourceStateId availabilityStatus vendorId source viewCount orderCount averageRating createdAt updatedAt';
    const productsQuery = Product.find(where)
      .select(listFields)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean({ virtuals: true });
    const [rows, total, managers, stats] = await Promise.all([
      productsQuery,
      Product.countDocuments(where),
      categoryManagersMap(),
      this.statsData(),
    ]);
    const categoryIds = [...new Set((rows as any[]).map((product) => String(product.categoryId || '')).filter(Boolean))];
    const objectIds = categoryIds.filter((value) => /^[a-f\d]{24}$/i.test(value));
    const categories = categoryIds.length
      ? await Category.find({
          $or: [
            { publicId: { $in: categoryIds } },
            ...(objectIds.length ? [{ _id: { $in: objectIds } }] : []),
          ],
        }).select('publicId name slug iconUrl').lean({ virtuals: true })
      : [];
    const categoryMap = new Map<string, any>();
    (categories as any[]).forEach((category) => {
      const { _id, ...safeCategory } = category;
      const value = {
        ...safeCategory,
        id: safeCategory.publicId || safeCategory.id || _id?.toString?.(),
      };
      categoryMap.set(String(_id), value);
      if (category.publicId) categoryMap.set(String(category.publicId), value);
    });
    const data = (rows as any[]).map((product) => ({
      ...product,
      category: categoryMap.get(String(product.categoryId)) || null,
      managers: managers.get(String(product.categoryId)) || [],
    }));
    sendSuccess(res, { ...paginated(data.map(adminProductSummary), total, page, limit), stats });
  };

  stats = async (_req: Request, res: Response) => {
    sendSuccess(res, await this.statsData());
  };

  detail = async (req: Request, res: Response) => {
    const product: any = await adminRepos.products().findOne({
      where: { id: routeParam(req.params.id), deletedAt: { $exists: false } },
      relations: { category: true, orderItems: true, negotiations: true },
    });
    if (!product) throw new HttpError(404, 'Product not found');
    const [managers, sourceMarket, sourceMarketVendor] = await Promise.all([
      categoryManagersMap(),
      referenceFilter(product.marketId)
        ? Market.findOne(referenceFilter(product.marketId) as any).select('publicId name address').lean({ virtuals: true })
        : null,
      referenceFilter(product.sourceMarketVendorId)
        ? MarketVendor.findOne(referenceFilter(product.sourceMarketVendorId) as any).select('publicId businessName status').lean({ virtuals: true })
        : null,
    ]);
    sendSuccess(res, publicProduct({
      ...product,
      categoryManagers: managers.get(product.categoryId) || [],
      sourceMarket: sourceMarket
        ? { publicId: sourceMarket.publicId, name: sourceMarket.name, address: sourceMarket.address }
        : null,
      sourceMarketVendor: sourceMarketVendor
        ? { publicId: sourceMarketVendor.publicId, businessName: sourceMarketVendor.businessName, status: sourceMarketVendor.status }
        : null,
    }));
  };

  create = async (req: Request, res: Response) => {
    const products = adminRepos.products();
    const { category, market } = await activeCatalogRelations(req.body.categoryId, req.body.marketId);
    const body = { ...req.body };
    delete body.vendorId;
    // Both identifiers come from the same reserved sequence: publicId is the
    // durable internal key, hookId the human-facing alias shown in the UI.
    const productPublicId = await nextPublicId('product');
    const isPublished = body.status === ProductStatus.PUBLISHED;
    if (isPublished) assertAdminPublishReady(body);
    const now = new Date();
    const basePriceMinor = Math.round(Number(body.costPrice) * 100);
    const sellingPriceMinor = Math.round(Number(body.sellingPrice) * 100);
    const negotiationRules = defaultNegotiationRules({
      sellingPriceMinor,
      basePriceMinor,
      minAcceptablePriceMinor: Math.round(Number(body.minAcceptablePrice) * 100),
    });
    const product = await products.save(products.create({
      ...body,
      categoryId: category._id.toString(),
      marketId: market._id.toString(),
      sourceStateId: market.stateId,
      basePriceMinor,
      sellingPriceMinor,
      discountMinor: body.discountedPrice ? Math.max(0, Math.round((Number(body.sellingPrice) - Number(body.discountedPrice)) * 100)) : 0,
      currency: 'NGN',
      catalogVersion: 1,
      ...(negotiationRules ? { negotiationRules } : {}),
      ...(isPublished ? {
        availabilityStatus: ProductAvailabilityStatus.AVAILABLE,
        publishedAt: now,
        publishedBy: req.user!.sub,
        lastAvailabilityConfirmedAt: now,
        availabilityValidUntil: await availabilityDeadline(),
        commercialApproval: { approved: true, approvedBy: req.user!.sub, approvedAt: now },
      } : {}),
      source: 'admin',
      slug: `${slugify(req.body.title)}-${productPublicId.toLowerCase()}`,
      publicId: productPublicId,
      hookId: hookIdFromPublicId(productPublicId),
    } as any)) as any;
    await auditAdminAction(req, 'product.create', 'product', product.id, { title: product.title });
    publishProductUpdate(product);
    sendCreated(res, publicProduct(await products.findOne({ where: { id: product.id }, relations: { category: true } }) as any));
  };

  update = async (req: Request, res: Response) => {
    const products = adminRepos.products();
    const product = await products.findOne({ where: { id: routeParam(req.params.id) } });
    if (!product) throw new HttpError(404, 'Product not found');
    const categoryIdentifier = req.body.categoryId || product.categoryId;
    const marketIdentifier = req.body.marketId || product.marketId;
    if (!marketIdentifier) throw new HttpError(400, 'Market is required', undefined, 'VALIDATION_ERROR');
    const { category, market } = await activeCatalogRelations(categoryIdentifier, marketIdentifier);
    const updates = { ...req.body };
    delete updates.vendorId;
    delete updates.source;
    updates.categoryId = category._id.toString();
    updates.marketId = market._id.toString();
    updates.sourceStateId = market.stateId;
    // Only touch the vendor link if the field was actually sent — omitting it
    // leaves whatever vendor (or lack of one) the product already has.
    if ('sourceMarketVendorId' in req.body) {
      updates.sourceMarketVendorId = await resolveSourceVendor(req.body.sourceMarketVendorId, market._id.toString());
    }
    if (updates.costPrice !== undefined) updates.basePriceMinor = Math.round(Number(updates.costPrice) * 100);
    if (updates.sellingPrice !== undefined) updates.sellingPriceMinor = Math.round(Number(updates.sellingPrice) * 100);
    // Only fill in a default when negotiation isn't already configured — never
    // override rules an admin set explicitly via the negotiation-rules editor.
    if (!product.negotiationRules?.enabled) {
      const negotiationRules = defaultNegotiationRules({
        sellingPriceMinor: updates.sellingPriceMinor ?? product.sellingPriceMinor,
        basePriceMinor: updates.basePriceMinor ?? product.basePriceMinor,
        minAcceptablePriceMinor: Math.round(Number(updates.minAcceptablePrice ?? product.minAcceptablePrice) * 100),
      });
      if (negotiationRules) updates.negotiationRules = negotiationRules;
    }
    const nextStatus = updates.status || product.status;
    if (nextStatus === ProductStatus.PUBLISHED) assertAdminPublishReady({ ...product, ...updates });
    if (nextStatus === ProductStatus.PUBLISHED && product.status !== ProductStatus.PUBLISHED) {
      const now = new Date();
      Object.assign(updates, {
        availabilityStatus: ProductAvailabilityStatus.AVAILABLE,
        publishedAt: now,
        publishedBy: req.user!.sub,
        lastAvailabilityConfirmedAt: now,
        availabilityValidUntil: await availabilityDeadline(),
        commercialApproval: { approved: true, approvedBy: req.user!.sub, approvedAt: now },
      });
    }
    updates.catalogVersion = Number(product.catalogVersion || 1) + 1;
    Object.assign(product, updates);
    if (req.body.title && !req.body.slug) product.slug = `${slugify(req.body.title)}-${Date.now().toString().slice(-6)}`;
    await products.save(product);
    await auditAdminAction(req, 'product.update', 'product', product.id, { fields: Object.keys(req.body) });
    publishProductUpdate(product);
    sendSuccess(res, publicProduct(await products.findOne({ where: { id: product.id }, relations: { category: true } }) as any));
  };

  review = async (req: Request, res: Response) => {
    const products = adminRepos.products();
    const product = await products.findOne({ where: { id: routeParam(req.params.id) } });
    if (!product) throw new HttpError(404, 'Product not found');
    const requestedStatus = req.body.status || product.status;
    if ([ProductStatus.APPROVED, ProductStatus.PUBLISHED].includes(requestedStatus)) {
      assertAdminPublishReady(product as any);
      if (!product.marketId) throw new HttpError(409, 'Assign an active Market before activating this product', undefined, 'CONFLICT');
      const { category, market } = await activeCatalogRelations(product.categoryId, product.marketId);
      const now = new Date();
      product.categoryId = category._id.toString();
      product.marketId = market._id.toString();
      product.sourceStateId = market.stateId;
      product.status = ProductStatus.PUBLISHED;
      product.availabilityStatus = ProductAvailabilityStatus.AVAILABLE;
      product.publishedAt = now;
      product.publishedBy = req.user!.sub;
      product.lastAvailabilityConfirmedAt = now;
      product.availabilityValidUntil = await availabilityDeadline();
      product.commercialApproval = { approved: true, approvedBy: req.user!.sub, approvedAt: now };
    } else {
      product.status = requestedStatus;
    }
    product.sellingPrice = req.body.adjustedSellingPrice ?? product.sellingPrice;
    product.sellingPriceMinor = Math.round(Number(product.sellingPrice) * 100);
    product.basePriceMinor = Math.round(Number(product.costPrice) * 100);
    product.catalogVersion = Number(product.catalogVersion || 1) + 1;
    await products.save(product);
    await auditAdminAction(req, 'product.review', 'product', product.id, { status: product.status });
    publishProductUpdate(product);
    sendSuccess(res, publicProduct(product as any));
  };

  disable = async (req: Request, res: Response) => {
    const products = adminRepos.products();
    const product = await products.findOne({ where: { id: routeParam(req.params.id) } });
    if (!product) throw new HttpError(404, 'Product not found');
    product.status = ProductStatus.DISABLED;
    await products.save(product);
    await auditAdminAction(req, 'product.disable', 'product', product.id);
    publishProductUpdate(product);
    sendSuccess(res, publicProduct(product as any));
  };

  /**
   * Soft delete only — a Product's id is still referenced by historical
   * OrderItems/Negotiations, so the document is kept and just hidden from
   * every admin/public query via deletedAt. Only allowed once a product is
   * already Disabled, so nothing live or customer-visible can be deleted
   * out from under an active listing.
   */
  remove = async (req: Request, res: Response) => {
    const products = adminRepos.products();
    const product = await products.findOne({ where: { id: routeParam(req.params.id) } });
    if (!product) throw new HttpError(404, 'Product not found');
    if (product.status !== ProductStatus.DISABLED) {
      throw new HttpError(409, 'A product must be disabled before it can be deleted', undefined, 'INVALID_STATE_TRANSITION');
    }
    await Product.updateOne({ _id: product.id }, { $set: { deletedAt: new Date() } });
    await auditAdminAction(req, 'product.delete', 'product', product.id, { title: product.title });
    publishProductUpdate({ ...product, catalogVersion: Number(product.catalogVersion || 1) + 1 });
    sendSuccess(res, { id: product.id, deleted: true });
  };

  private async statsData() {
    const cached = adminProductStatsCache.get('summary');
    if (cached) return cached;
    const products = adminRepos.products();
    const [total, approved, pendingApproval, lowStock, soldOut] = await Promise.all([
      products.count(),
      products.count({ where: { status: ProductStatus.APPROVED } }),
      products.count({ where: { status: ProductStatus.PENDING_APPROVAL } }),
      products.model.countDocuments({ quantity: { $gt: 0, $lt: 10 } }),
      products.count({ where: { status: ProductStatus.SOLD_OUT } }),
    ]);
    return adminProductStatsCache.set('summary', { total, approved, pendingApproval, lowStock, soldOut });
  }
}
