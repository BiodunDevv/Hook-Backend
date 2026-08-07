import { Request, Response } from 'express';
import { ProductStatus } from '@lib/constants';
import { getPagination, paginated } from '@lib/api-utils';
import { Category } from '@models/categories/category.model';
import { OperationalState } from '@models/operations/operational-state.model';
import { Product } from '@models/products/product.model';
import { sendSuccess } from '@utils/http';
import { publicProduct } from '@lib/public-resource';

const routeParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value || '';

const PRODUCT_FIELDS = 'publicId hookId title slug description costPrice sellingPrice discountedPrice minAcceptablePrice sellingPriceMinor discountMinor currency quantity reservedQuantity colors sizes images status categoryId createdAt updatedAt';

function safeProduct(product: any) {
  if (!product) return product;
  const { _id, ...safe } = product;
  if (safe.category) {
    const { _id: categoryId, ...category } = safe.category;
    safe.category = { ...category, id: category.publicId || category.id || categoryId?.toString?.() };
  }
  return publicProduct(safe);
}

async function attachCategories(products: any[]) {
  if (!products.length) return products;
  const categoryIds = [...new Set(products.map((product) => String(product.categoryId || '')).filter(Boolean))];
  const objectIds = categoryIds.filter((value) => /^[a-f\d]{24}$/i.test(value));
  const categories = await Category.find({
    $or: [
      { publicId: { $in: categoryIds } },
      ...(objectIds.length ? [{ _id: { $in: objectIds } }] : []),
    ],
  }).select('publicId name slug iconUrl').lean({ virtuals: true });
  const map = new Map<string, any>();
  (categories as any[]).forEach((category) => {
    const { _id, ...safeCategory } = category;
    const value = { ...safeCategory, id: safeCategory.publicId || safeCategory.id || _id?.toString?.() };
    map.set(String(_id), value);
    if (category.publicId) map.set(String(category.publicId), value);
  });
  return products.map((product) => ({ ...product, category: map.get(String(product.categoryId)) }));
}

function searchExpression(value: string) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

export class PublicController {
  getProducts = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const where: Record<string, any> = { status: ProductStatus.APPROVED };
    if (typeof req.query.categoryId === 'string') where.categoryId = req.query.categoryId;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const minPrice = typeof req.query.minPrice === 'string' ? Number(req.query.minPrice) : undefined;
    const maxPrice = typeof req.query.maxPrice === 'string' ? Number(req.query.maxPrice) : undefined;
    if (q) where.$or = [{ title: searchExpression(q) }, { description: searchExpression(q) }];
    if (Number.isFinite(minPrice)) where.sellingPrice = { ...(where.sellingPrice || {}), $gte: minPrice };
    if (Number.isFinite(maxPrice)) where.sellingPrice = { ...(where.sellingPrice || {}), $lte: maxPrice };
    const [rows, total] = await Promise.all([
      Product.find(where).select(PRODUCT_FIELDS).sort({ createdAt: -1 }).skip(skip).limit(limit).lean({ virtuals: true }),
      Product.countDocuments(where),
    ]);
    const products = await attachCategories(rows as any[]);
    sendSuccess(res, paginated(products.map(safeProduct), total, page, limit));
  };

  getProduct = async (req: Request, res: Response) => {
    const identifier = routeParam(req.params.id);
    const identity = /^[a-f\d]{24}$/i.test(identifier)
      ? { $or: [{ _id: identifier }, { publicId: identifier }, { hookId: identifier }, { slug: identifier }] }
      : { $or: [{ publicId: identifier }, { hookId: identifier }, { slug: identifier }] };
    const product = await Product.findOne(identity).select(PRODUCT_FIELDS).lean({ virtuals: true });
    const [withCategory] = await attachCategories(product ? [product] : []);
    sendSuccess(res, safeProduct(withCategory));
  };

  getCategories = async (_req: Request, res: Response) => {
    const categories = await Category.find({ isActive: true, deletedAt: { $exists: false } })
      .select('publicId name slug iconUrl description sortOrder isActive parentId')
      .sort({ name: 1 })
      .lean({ virtuals: true });
    sendSuccess(res, categories.map((category: any) => safeProduct(category)));
  };

  getCategoryTree = async (_req: Request, res: Response) => {
    const categories = await Category.find({ isActive: true, deletedAt: { $exists: false } })
      .select('publicId name slug iconUrl description sortOrder isActive parentId')
      .sort({ sortOrder: 1, name: 1 })
      .lean({ virtuals: true });
    const map = new Map<string, any>();
    const rows = (categories as any[]).map((category) => {
      const { _id, ...safe } = category;
      const value = { ...safe, id: safe.publicId || safe.id || _id?.toString?.(), children: [] };
      map.set(String(_id), value);
      if (category.publicId) map.set(String(category.publicId), value);
      return value;
    });
    rows.forEach((category) => {
      const parent = category.parentId ? map.get(String(category.parentId)) : undefined;
      if (parent) parent.children.push(category);
    });
    sendSuccess(res, rows.filter((category) => !category.parentId));
  };

  getCategory = async (req: Request, res: Response) => {
    const identifier = routeParam(req.params.id);
    const identity = /^[a-f\d]{24}$/i.test(identifier)
      ? { $or: [{ _id: identifier }, { publicId: identifier }, { slug: identifier }] }
      : { $or: [{ publicId: identifier }, { slug: identifier }] };
    const category = await Category.findOne(identity).select('publicId name slug iconUrl description sortOrder isActive parentId').lean({ virtuals: true });
    sendSuccess(res, safeProduct(category));
  };

  homeFeed = async (_req: Request, res: Response) => {
    const [featuredProducts, categories] = await Promise.all([
      Product.find({ status: ProductStatus.APPROVED }).select(PRODUCT_FIELDS).sort({ createdAt: -1 }).limit(12).lean({ virtuals: true }),
      Category.find({ isActive: true, deletedAt: { $exists: false } }).select('publicId name slug iconUrl sortOrder').sort({ sortOrder: 1, name: 1 }).limit(12).lean({ virtuals: true }),
    ]);
    const products = await attachCategories(featuredProducts as any[]);
    sendSuccess(res, { featuredProducts: products.map(safeProduct), categories: categories.map((category: any) => safeProduct(category)) });
  };

  getOperatingStates = async (_req: Request, res: Response) => {
    const states = await OperationalState.find({ isEnabled: true }).select('code name').sort({ sortOrder: 1 }).lean();
    sendSuccess(res, (states as any[]).map((state) => ({ code: state.code, name: state.name })));
  };

  search = async (req: Request, res: Response) => {
    const q = String(req.query.q || req.query.query || '').trim();
    if (!q) return sendSuccess(res, { products: [] });
    const products = await Product.find({ status: ProductStatus.APPROVED, $or: [{ title: searchExpression(q) }, { description: searchExpression(q) }] })
      .select(PRODUCT_FIELDS)
      .sort({ createdAt: -1 })
      .limit(20)
      .lean({ virtuals: true });
    const withCategories = await attachCategories(products as any[]);
    return sendSuccess(res, {
      products: withCategories.map(safeProduct),
    });
  };

  suggestions = async (req: Request, res: Response) => {
    const q = String(req.query.q || req.query.query || '').trim();
    if (!q) return sendSuccess(res, []);

    const products = await Product.find({ status: ProductStatus.APPROVED, title: searchExpression(q) })
      .select('title')
      .sort({ createdAt: -1 })
      .limit(8)
      .lean();
    return sendSuccess(res, products.map((product) => product.title));
  };
}
