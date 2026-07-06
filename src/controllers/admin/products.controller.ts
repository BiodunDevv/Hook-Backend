import { Request, Response } from 'express';
import { ProductStatus } from '@lib/constants';
import { HttpError, sendCreated, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'product';
}

export class AdminProductsController {
  reviewQueue = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const [data, total] = await adminRepos.products().findAndCount({
      where: { status: ProductStatus.PENDING_APPROVAL },
      relations: { vendor: true, category: true },
      order: { createdAt: 'ASC' },
      skip,
      take: limit,
    });
    sendSuccess(res, { ...paginated(data, total, page, limit), queueSize: total });
  };

  list = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : undefined;
    const where: Record<string, unknown> = {};
    if (typeof req.query.status === 'string') where.status = req.query.status;
    if (typeof req.query.vendorId === 'string') where.vendorId = req.query.vendorId;
    if (typeof req.query.categoryId === 'string') where.categoryId = req.query.categoryId;
    const all = await adminRepos.products().find({ where, relations: { vendor: true, category: true }, order: { createdAt: 'DESC' } });
    const filtered = all.filter((product: any) => {
      if (req.query.stock === 'low' && !(product.quantity > 0 && product.quantity < 10)) return false;
      if (req.query.stock === 'out' && product.quantity !== 0) return false;
      if (search && ![product.title, product.vendor?.businessName].some((value) => String(value || '').toLowerCase().includes(search))) return false;
      return true;
    });
    const data = filtered.slice(skip, skip + limit);
    const stats = await this.statsData();
    sendSuccess(res, { ...paginated(data, filtered.length, page, limit), stats });
  };

  stats = async (_req: Request, res: Response) => {
    sendSuccess(res, await this.statsData());
  };

  detail = async (req: Request, res: Response) => {
    const product = await adminRepos.products().findOne({
      where: { id: routeParam(req.params.id) },
      relations: { vendor: true, category: true, orderItems: true, negotiations: true },
    });
    if (!product) throw new HttpError(404, 'Product not found');
    sendSuccess(res, product);
  };

  create = async (req: Request, res: Response) => {
    const vendors = adminRepos.vendors();
    const categories = adminRepos.categories();
    const products = adminRepos.products();
    const [vendor, category] = await Promise.all([
      vendors.findOne({ where: { id: req.body.vendorId } }),
      categories.findOne({ where: { id: req.body.categoryId } }),
    ]);
    if (!vendor) throw new HttpError(404, 'Vendor not found');
    if (!category) throw new HttpError(404, 'Category not found');
    const baseSlug = slugify(req.body.title);
    const product = await products.save(products.create({
      ...req.body,
      slug: `${baseSlug}-${Date.now().toString().slice(-6)}`,
      hookId: `HK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    } as any)) as any;
    sendCreated(res, await products.findOne({ where: { id: product.id }, relations: { vendor: true, category: true } }));
  };

  update = async (req: Request, res: Response) => {
    const products = adminRepos.products();
    const product = await products.findOne({ where: { id: routeParam(req.params.id) } });
    if (!product) throw new HttpError(404, 'Product not found');
    if (req.body.vendorId) {
      const vendor = await adminRepos.vendors().findOne({ where: { id: req.body.vendorId } });
      if (!vendor) throw new HttpError(404, 'Vendor not found');
    }
    if (req.body.categoryId) {
      const category = await adminRepos.categories().findOne({ where: { id: req.body.categoryId } });
      if (!category) throw new HttpError(404, 'Category not found');
    }
    Object.assign(product, req.body);
    if (req.body.title && !req.body.slug) product.slug = `${slugify(req.body.title)}-${Date.now().toString().slice(-6)}`;
    await products.save(product);
    sendSuccess(res, await products.findOne({ where: { id: product.id }, relations: { vendor: true, category: true } }));
  };

  review = async (req: Request, res: Response) => {
    const products = adminRepos.products();
    const product = await products.findOne({ where: { id: routeParam(req.params.id) } });
    if (!product) throw new HttpError(404, 'Product not found');
    product.status = req.body.status || product.status;
    product.sellingPrice = req.body.adjustedSellingPrice ?? product.sellingPrice;
    await products.save(product);
    sendSuccess(res, product);
  };

  disable = async (req: Request, res: Response) => {
    const products = adminRepos.products();
    const product = await products.findOne({ where: { id: routeParam(req.params.id) } });
    if (!product) throw new HttpError(404, 'Product not found');
    product.status = ProductStatus.DISABLED;
    await products.save(product);
    sendSuccess(res, product);
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
