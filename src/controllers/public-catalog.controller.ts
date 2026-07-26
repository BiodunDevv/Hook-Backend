import { Request, Response } from 'express';
import { ProductStatus } from '@lib/constants';
import { Category } from '@models/categories/category.model';
import { OperationState } from '@models/platform/geography.model';
import { Market } from '@models/platform/network.model';
import { Product } from '@models/products/product.model';
import { publicProductRepresentation } from '@services/commercial-catalog.service';
import { routeParam } from '@lib/api-utils';
import { HttpError, sendSuccess } from '@utils/http';

async function internalId(model: any, identifier?: string, extraFields: string[] = []) {
  if (!identifier) return undefined;
  const query = /^[a-f\d]{24}$/i.test(identifier)
    ? { $or: [{ _id: identifier }, { publicId: identifier }] }
    : { $or: [{ publicId: identifier }, ...extraFields.map((field) => ({ [field]: identifier }))] };
  const record = await model.findOne(query).select('_id').lean();
  if (!record) throw new HttpError(404, 'Filter record not found', undefined, 'NOT_FOUND');
  return record._id.toString();
}

function baseFilter() {
  return {
    status: ProductStatus.PUBLISHED,
    publishedAt: { $lte: new Date() },
    deletedAt: { $exists: false },
  };
}

export class PublicCatalogController {
  products = async (req: Request, res: Response) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 50);
    const filter: Record<string, any> = baseFilter();
    const [stateId, marketId, categoryId] = await Promise.all([
      internalId(OperationState, String(req.query.stateId || req.query.stateCode || '') || undefined, ['code']),
      internalId(Market, String(req.query.marketId || '') || undefined),
      internalId(Category, String(req.query.categoryId || '') || undefined),
    ]);
    if (stateId) filter.sourceStateId = stateId;
    if (marketId) filter.marketId = marketId;
    if (categoryId) filter.categoryId = categoryId;
    if (req.query.cursor) filter._id = { $lt: req.query.cursor };
    if (req.query.minPriceMinor || req.query.maxPriceMinor) {
      filter.$expr = {
        $and: [
          ...(req.query.minPriceMinor
            ? [{ $gte: [{ $subtract: ['$sellingPriceMinor', { $ifNull: ['$discountMinor', 0] }] }, Number(req.query.minPriceMinor)] }]
            : []),
          ...(req.query.maxPriceMinor
            ? [{ $lte: [{ $subtract: ['$sellingPriceMinor', { $ifNull: ['$discountMinor', 0] }] }, Number(req.query.maxPriceMinor)] }]
            : []),
        ],
      };
    }
    if (req.query.q) filter.$text = { $search: String(req.query.q) };
    const sort: Record<string, 1 | -1> = req.query.sort === 'price_asc'
      ? { sellingPriceMinor: 1 as const, _id: -1 as const }
      : req.query.sort === 'price_desc'
        ? { sellingPriceMinor: -1 as const, _id: -1 as const }
        : { publishedAt: -1 as const, _id: -1 as const };
    const rows = await Product.find(filter).sort(sort).limit(limit + 1).lean({ virtuals: true });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    sendSuccess(res, {
      data: await Promise.all(page.map(publicProductRepresentation)),
      nextCursor: hasMore && page.length ? page[page.length - 1]._id.toString() : null,
      hasMore,
    });
  };

  product = async (req: Request, res: Response) => {
    const id = routeParam(req.params.id);
    const product = await Product.findOne({
      ...(/^[a-f\d]{24}$/i.test(id)
        ? { $or: [{ _id: id }, { publicId: id }, { slug: id }] }
        : { $or: [{ publicId: id }, { slug: id }] }),
      ...baseFilter(),
    }).lean({ virtuals: true });
    if (!product) throw new HttpError(404, 'Product not found', undefined, 'NOT_FOUND');
    sendSuccess(res, await publicProductRepresentation(product));
  };

  categories = async (_req: Request, res: Response) => {
    const categories = await Category.find({ isActive: true, deletedAt: { $exists: false } })
      .select('publicId name slug iconUrl description sortOrder parentId attributeSchema')
      .sort({ sortOrder: 1, name: 1 })
      .lean({ virtuals: true });
    sendSuccess(res, categories.map((item: any) => ({
      publicId: item.publicId,
      name: item.name,
      slug: item.slug,
      iconUrl: item.iconUrl || null,
      description: item.description || '',
      sortOrder: item.sortOrder || 0,
      attributeSchema: item.attributeSchema || [],
    })));
  };

  search = async (req: Request, res: Response) => this.products(req, res);

  home = async (req: Request, res: Response) => {
    const stateIdentifier = String(req.query.stateId || req.query.stateCode || '') || undefined;
    const stateId = await internalId(OperationState, stateIdentifier, ['code']);
    const filter: Record<string, unknown> = baseFilter();
    if (stateId) filter.sourceStateId = stateId;
    const [featured, categories, markets] = await Promise.all([
      Product.find(filter).sort({ publishedAt: -1 }).limit(12).lean({ virtuals: true }),
      Category.find({ isActive: true, deletedAt: { $exists: false } }).sort({ sortOrder: 1 }).limit(12).lean({ virtuals: true }),
      Market.find({ status: 'active', ...(stateId ? { stateId } : {}) }).select('publicId name stateId cityId address').limit(10).lean({ virtuals: true }),
    ]);
    sendSuccess(res, {
      featuredProducts: await Promise.all(featured.map(publicProductRepresentation)),
      categories: categories.map((item: any) => ({
        publicId: item.publicId,
        name: item.name,
        slug: item.slug,
        iconUrl: item.iconUrl || null,
      })),
      markets: markets.map((item: any) => ({
        publicId: item.publicId,
        name: item.name,
        address: item.address || null,
      })),
    });
  };
}
