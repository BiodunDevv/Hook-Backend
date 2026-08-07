import { Request, Response } from 'express';
import { ProductStatus, UserRole } from '@lib/constants';
import { auditAdminAction } from '@lib/audit';
import { HttpError, sendCreated, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';
import { publicProduct } from '@lib/public-resource';
import { Product } from '@models/products/product.model';
import { Category } from '@models/categories/category.model';
import { User } from '@models/users/user.model';
import { adminCategoryManagersCache, adminProductStatsCache } from '@lib/ttl-cache';

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'product';
}

const MANAGER_ROLES: UserRole[] = [UserRole.SUPPORT, UserRole.ADMIN];

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
      where: { status: ProductStatus.PENDING_APPROVAL },
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
    const where: Record<string, any> = {};
    if (typeof req.query.status === 'string') where.status = req.query.status;
    if (typeof req.query.categoryId === 'string') where.categoryId = req.query.categoryId;
    if (req.query.stock === 'low') where.quantity = { $gt: 0, $lt: 10 };
    if (req.query.stock === 'out') where.quantity = 0;
    if (search) {
      const expression = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      where.$or = [{ title: expression }, { hookId: expression }, { publicId: expression }];
    }
    const listFields = 'publicId hookId title slug description costPrice sellingPrice discountedPrice minAcceptablePrice sellingPriceMinor discountMinor currency quantity reservedQuantity colors sizes images status categoryId vendorId source viewCount orderCount averageRating createdAt updatedAt';
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
      where: { id: routeParam(req.params.id) },
      relations: { category: true, orderItems: true, negotiations: true },
    });
    if (!product) throw new HttpError(404, 'Product not found');
    const managers = await categoryManagersMap();
    sendSuccess(res, publicProduct({ ...product, categoryManagers: managers.get(product.categoryId) || [] }));
  };

  create = async (req: Request, res: Response) => {
    const categories = adminRepos.categories();
    const products = adminRepos.products();
    const category = await categories.findOne({ where: { id: req.body.categoryId } });
    if (!category) throw new HttpError(404, 'Category not found');
    const baseSlug = slugify(req.body.title);
    const body = { ...req.body };
    delete body.vendorId;
    const product = await products.save(products.create({
      ...body,
      source: 'admin',
      slug: `${baseSlug}-${Date.now().toString().slice(-6)}`,
      hookId: `HK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    } as any)) as any;
    await auditAdminAction(req, 'product.create', 'product', product.id, { title: product.title });
    sendCreated(res, publicProduct(await products.findOne({ where: { id: product.id }, relations: { category: true } }) as any));
  };

  update = async (req: Request, res: Response) => {
    const products = adminRepos.products();
    const product = await products.findOne({ where: { id: routeParam(req.params.id) } });
    if (!product) throw new HttpError(404, 'Product not found');
    if (req.body.categoryId) {
      const category = await adminRepos.categories().findOne({ where: { id: req.body.categoryId } });
      if (!category) throw new HttpError(404, 'Category not found');
    }
    const updates = { ...req.body };
    delete updates.vendorId;
    delete updates.source;
    Object.assign(product, updates);
    if (req.body.title && !req.body.slug) product.slug = `${slugify(req.body.title)}-${Date.now().toString().slice(-6)}`;
    await products.save(product);
    await auditAdminAction(req, 'product.update', 'product', product.id, { fields: Object.keys(req.body) });
    sendSuccess(res, publicProduct(await products.findOne({ where: { id: product.id }, relations: { category: true } }) as any));
  };

  review = async (req: Request, res: Response) => {
    const products = adminRepos.products();
    const product = await products.findOne({ where: { id: routeParam(req.params.id) } });
    if (!product) throw new HttpError(404, 'Product not found');
    product.status = req.body.status || product.status;
    product.sellingPrice = req.body.adjustedSellingPrice ?? product.sellingPrice;
    await products.save(product);
    await auditAdminAction(req, 'product.review', 'product', product.id, { status: product.status });
    sendSuccess(res, publicProduct(product as any));
  };

  disable = async (req: Request, res: Response) => {
    const products = adminRepos.products();
    const product = await products.findOne({ where: { id: routeParam(req.params.id) } });
    if (!product) throw new HttpError(404, 'Product not found');
    product.status = ProductStatus.DISABLED;
    await products.save(product);
    await auditAdminAction(req, 'product.disable', 'product', product.id);
    sendSuccess(res, publicProduct(product as any));
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
