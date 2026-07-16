import { Request, Response } from 'express';
import { ProductStatus } from '@lib/constants';
import { getPagination, paginated } from '@lib/api-utils';
import { mongoIn } from '@lib/mongo-repository';
import { AppDataSource } from '@config/data-source';
import { Booth } from '@models/booths/booth.model';
import { BoothInventory } from '@models/booths/booth-inventory.model';
import { HttpError } from '@utils/http';
import { Category } from '@models/categories/category.model';
import { OperationalState } from '@models/operations/operational-state.model';
import { Product } from '@models/products/product.model';
import { Vendor } from '@models/vendors/vendor.model';
import { normalizeStateCode } from '@services/operational-state.service';
import { sendSuccess } from '@utils/http';
import { BoothAccessService } from '@services/booth-access.service';

const routeParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value || '';

export class PublicController {
  private readonly products = AppDataSource.getRepository(Product);
  private readonly categories = AppDataSource.getRepository(Category);
  private readonly vendors = AppDataSource.getRepository(Vendor);
  private readonly booths = AppDataSource.getRepository(Booth);
  private readonly operationalStates = AppDataSource.getRepository(OperationalState);
  private readonly boothInventory = AppDataSource.getRepository(BoothInventory);
  private readonly boothAccess = new BoothAccessService();

  // Real per-vendor approved-product counts — grouped in memory to avoid N+1 queries,
  // same in-memory-join pattern used by categories.controller.ts / products.controller.ts.
  private async attachProductCounts<T extends { id: string }>(vendorRows: T[]): Promise<(T & { productCount: number })[]> {
    if (!vendorRows.length) return [];
    const vendorIds = vendorRows.map((vendor) => vendor.id);
    const approvedProducts = await this.products.find({
      where: { status: ProductStatus.APPROVED, vendorId: mongoIn(vendorIds) },
    });
    const counts = new Map<string, number>();
    for (const product of approvedProducts as any[]) {
      counts.set(product.vendorId, (counts.get(product.vendorId) || 0) + 1);
    }
    return vendorRows.map((vendor) => ({ ...vendor, productCount: counts.get(vendor.id) || 0 }));
  }

  getProducts = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const where: Record<string, unknown> = { status: ProductStatus.APPROVED };
    if (typeof req.query.categoryId === 'string') where.categoryId = req.query.categoryId;
    if (typeof req.query.vendorId === 'string') where.vendorId = req.query.vendorId;
    const q = typeof req.query.q === 'string' ? req.query.q.toLowerCase() : '';
    const minPrice = typeof req.query.minPrice === 'string' ? Number(req.query.minPrice) : undefined;
    const maxPrice = typeof req.query.maxPrice === 'string' ? Number(req.query.maxPrice) : undefined;
    const all = await this.products.find({ where, relations: { vendor: true, category: true }, order: { createdAt: 'DESC' } });
    const filtered = all.filter((product: any) => {
      if (q && ![product.title, product.description].some((value) => String(value || '').toLowerCase().includes(q))) return false;
      if (minPrice !== undefined && Number(product.sellingPrice) < minPrice) return false;
      if (maxPrice !== undefined && Number(product.sellingPrice) > maxPrice) return false;
      return true;
    });
    sendSuccess(res, paginated(filtered.slice(skip, skip + limit), filtered.length, page, limit));
  };

  getProduct = async (req: Request, res: Response) => {
    sendSuccess(res, await this.products.findOne({
      where: { id: routeParam(req.params.id) },
      relations: { vendor: true, category: true },
    }));
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

  getBooths = async (_req: Request, res: Response) => {
    sendSuccess(res, await this.booths.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    }));
  };

  getBooth = async (req: Request, res: Response) => {
    sendSuccess(res, await this.booths.findOne({ where: { id: routeParam(req.params.id), isActive: true } }));
  };

  scanBooth = async (req: Request, res: Response) => {
    const publicId = routeParam(req.params.publicId);
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    sendSuccess(res, await this.boothAccess.resolveQr(publicId, token));
  };

  resolveBooth = async (req: Request, res: Response) => {
    sendSuccess(res, await this.boothAccess.resolveCode(req.body.code));
  };

  boothSession = async (req: Request, res: Response) => {
    sendSuccess(res, await this.boothAccess.resolveSession(req.body.boothSessionToken));
  };

  boothProduct = async (req: Request, res: Response) => {
    sendSuccess(res, await this.boothAccess.resolveProduct(req.body.boothSessionToken, routeParam(req.params.productId)));
  };

  getVendors = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const where: Record<string, unknown> = { isApproved: true, isActive: true };
    const stateCode = normalizeStateCode(req.query.stateCode);
    if (stateCode) where.stateCode = stateCode;

    const [data, total] = await this.vendors.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
    const withCounts = await this.attachProductCounts(data as any[]);
    sendSuccess(res, paginated(withCounts, total, page, limit));
  };

  getVendor = async (req: Request, res: Response) => {
    sendSuccess(res, await this.vendors.findOne({
      where: { id: routeParam(req.params.id), isApproved: true, isActive: true },
      relations: { products: true },
    }));
  };

  homeFeed = async (req: Request, res: Response) => {
    const vendorWhere: Record<string, unknown> = { isApproved: true, isActive: true };
    const stateCode = normalizeStateCode(req.query.stateCode);
    if (stateCode) vendorWhere.stateCode = stateCode;

    const [featuredProducts, vendors, categories, booths] = await Promise.all([
      this.products.find({ where: { status: ProductStatus.APPROVED }, relations: { vendor: true, category: true }, take: 12, order: { createdAt: 'DESC' } }),
      this.vendors.find({ where: vendorWhere, take: 8, order: { createdAt: 'DESC' } }),
      this.categories.find({ where: { isActive: true }, take: 12, order: { sortOrder: 'ASC', name: 'ASC' } }),
      this.booths.find({ where: { isActive: true }, take: 6, order: { createdAt: 'DESC' } }),
    ]);
    const vendorsWithCounts = await this.attachProductCounts(vendors as any[]);
    sendSuccess(res, { featuredProducts, vendors: vendorsWithCounts, categories, booths });
  };

  getOperatingStates = async (_req: Request, res: Response) => {
    const states = await this.operationalStates.find({
      where: { isEnabled: true },
      order: { sortOrder: 'ASC' },
    });
    sendSuccess(res, (states as any[]).map((state) => ({ code: state.code, name: state.name })));
  };

  getNearbyBooths = async (_req: Request, res: Response) => {
    sendSuccess(res, await this.booths.find({ where: { isActive: true }, take: 20 }));
  };

  search = async (req: Request, res: Response) => {
    const q = String(req.query.q || req.query.query || '').trim();
    if (!q) return sendSuccess(res, { products: [], vendors: [] });

    const [products, vendors] = await Promise.all([
      this.products.find({ where: { status: ProductStatus.APPROVED }, take: 100 }),
      this.vendors.find({ where: { isApproved: true }, take: 100 }),
    ]);

    const term = q.toLowerCase();
    return sendSuccess(res, {
      products: products.filter((product: any) => [product.title, product.description].some((value) => String(value || '').toLowerCase().includes(term))).slice(0, 20),
      vendors: vendors.filter((vendor: any) => String(vendor.businessName || '').toLowerCase().includes(term)).slice(0, 20),
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
