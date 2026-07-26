import { Request, Response } from 'express';
import { ProductStatus } from '@lib/constants';
import { getPagination, paginated } from '@lib/api-utils';
import { AppDataSource } from '@config/data-source';
import { Category } from '@models/categories/category.model';
import { OperationalState } from '@models/operations/operational-state.model';
import { Product } from '@models/products/product.model';
import { sendSuccess } from '@utils/http';
import { publicProduct } from '@lib/public-resource';

const routeParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value || '';

export class PublicController {
  private readonly products = AppDataSource.getRepository(Product);
  private readonly categories = AppDataSource.getRepository(Category);
  private readonly operationalStates = AppDataSource.getRepository(OperationalState);

  getProducts = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const where: Record<string, unknown> = { status: ProductStatus.APPROVED };
    if (typeof req.query.categoryId === 'string') where.categoryId = req.query.categoryId;
    const q = typeof req.query.q === 'string' ? req.query.q.toLowerCase() : '';
    const minPrice = typeof req.query.minPrice === 'string' ? Number(req.query.minPrice) : undefined;
    const maxPrice = typeof req.query.maxPrice === 'string' ? Number(req.query.maxPrice) : undefined;
    const all = await this.products.find({ where, relations: { category: true }, order: { createdAt: 'DESC' } });
    const filtered = all.filter((product: any) => {
      if (q && ![product.title, product.description].some((value) => String(value || '').toLowerCase().includes(q))) return false;
      if (minPrice !== undefined && Number(product.sellingPrice) < minPrice) return false;
      if (maxPrice !== undefined && Number(product.sellingPrice) > maxPrice) return false;
      return true;
    });
    sendSuccess(res, paginated(filtered.slice(skip, skip + limit).map((product) => publicProduct(product as any)), filtered.length, page, limit));
  };

  getProduct = async (req: Request, res: Response) => {
    sendSuccess(res, publicProduct(await this.products.findOne({
      where: { id: routeParam(req.params.id) },
      relations: { category: true },
    }) as any));
  };

  getCategories = async (_req: Request, res: Response) => {
    sendSuccess(res, await this.categories.find({ order: { name: 'ASC' } }));
  };

  getCategoryTree = async (_req: Request, res: Response) => {
    const categories = await this.categories.find({ relations: { children: true }, order: { sortOrder: 'ASC', name: 'ASC' } });
    sendSuccess(res, categories.filter((category) => !category.parentId));
  };

  getCategory = async (req: Request, res: Response) => {
    sendSuccess(res, await this.categories.findOne({ where: { id: routeParam(req.params.id) } }));
  };

  homeFeed = async (_req: Request, res: Response) => {
    const [featuredProducts, categories] = await Promise.all([
      this.products.find({ where: { status: ProductStatus.APPROVED }, relations: { category: true }, take: 12, order: { createdAt: 'DESC' } }),
      this.categories.find({ where: { isActive: true }, take: 12, order: { sortOrder: 'ASC', name: 'ASC' } }),
    ]);
    sendSuccess(res, { featuredProducts: featuredProducts.map((product) => publicProduct(product as any)), categories });
  };

  getOperatingStates = async (_req: Request, res: Response) => {
    const states = await this.operationalStates.find({
      where: { isEnabled: true },
      order: { sortOrder: 'ASC' },
    });
    sendSuccess(res, (states as any[]).map((state) => ({ code: state.code, name: state.name })));
  };

  search = async (req: Request, res: Response) => {
    const q = String(req.query.q || req.query.query || '').trim();
    if (!q) return sendSuccess(res, { products: [] });
    const products = await this.products.find({ where: { status: ProductStatus.APPROVED }, take: 100 });

    const term = q.toLowerCase();
    return sendSuccess(res, {
      products: products
        .filter((product: any) => [product.title, product.description].some((value) => String(value || '').toLowerCase().includes(term)))
        .slice(0, 20)
        .map((product) => publicProduct(product as any)),
    });
  };

  suggestions = async (req: Request, res: Response) => {
    const q = String(req.query.q || req.query.query || '').trim();
    if (!q) return sendSuccess(res, []);

    const products = await this.products.find({
      where: { status: ProductStatus.APPROVED },
      take: 100,
    });
    const term = q.toLowerCase();
    return sendSuccess(res, products
      .filter((product: any) => String(product.title || '').toLowerCase().includes(term))
      .slice(0, 8)
      .map((product) => product.title));
  };
}
