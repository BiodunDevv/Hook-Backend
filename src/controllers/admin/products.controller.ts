import { Request, Response } from 'express';
import { ProductStatus, UserRole } from '@lib/constants';
import { auditAdminAction } from '@lib/audit';
import { HttpError, sendCreated, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';
import { publicProduct } from '@lib/public-resource';

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'product';
}

const MANAGER_ROLES: UserRole[] = [UserRole.SUPPORT, UserRole.ADMIN];

// categoryId → managers, computed once per request (no N+1)
async function categoryManagersMap(): Promise<Map<string, any[]>> {
  const users = await adminRepos.users().find({});
  const map = new Map<string, any[]>();
  for (const user of users as any[]) {
    if (!MANAGER_ROLES.includes(user.role) || !user.isActive) continue;
    for (const categoryId of user.assignedCategoryIds || []) {
      const bucket = map.get(categoryId) || [];
      bucket.push({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone || null,
        role: user.role,
      });
      map.set(categoryId, bucket);
    }
  }
  return map;
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
    const where: Record<string, unknown> = {};
    if (typeof req.query.status === 'string') where.status = req.query.status;
    if (typeof req.query.categoryId === 'string') where.categoryId = req.query.categoryId;
    const all = await adminRepos.products().find({ where, relations: { category: true }, order: { createdAt: 'DESC' } });
    const filtered = all.filter((product: any) => {
      if (req.query.stock === 'low' && !(product.quantity > 0 && product.quantity < 10)) return false;
      if (req.query.stock === 'out' && product.quantity !== 0) return false;
      if (search && ![product.title, product.hookId].some((value) => String(value || '').toLowerCase().includes(search))) return false;
      return true;
    });
    const managers = await categoryManagersMap();
    const data = filtered.slice(skip, skip + limit).map((product: any) => ({
      ...product,
      managers: managers.get(product.categoryId) || [],
    }));
    const stats = await this.statsData();
    sendSuccess(res, { ...paginated(data.map(publicProduct), filtered.length, page, limit), stats });
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
    const products = adminRepos.products();
    const [total, approved, pendingApproval, lowStock, soldOut] = await Promise.all([
      products.count(),
      products.count({ where: { status: ProductStatus.APPROVED } }),
      products.count({ where: { status: ProductStatus.PENDING_APPROVAL } }),
      products.model.countDocuments({ quantity: { $gt: 0, $lt: 10 } }),
      products.count({ where: { status: ProductStatus.SOLD_OUT } }),
    ]);
    return { total, approved, pendingApproval, lowStock, soldOut };
  }
}
