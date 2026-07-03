import { Request, Response } from 'express';
import { ILike } from 'typeorm';
import { ProductStatus } from '@lib/constants';
import { getPagination, paginated } from '@lib/api-utils';
import { AppDataSource } from '@config/data-source';
import { Booth } from '@models/booths/booth.model';
import { Category } from '@models/categories/category.model';
import { Product } from '@models/products/product.model';
import { Vendor } from '@models/vendors/vendor.model';
import { sendSuccess } from '@utils/http';

const routeParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value || '';

export class PublicController {
  private readonly products = AppDataSource.getRepository(Product);
  private readonly categories = AppDataSource.getRepository(Category);
  private readonly vendors = AppDataSource.getRepository(Vendor);
  private readonly booths = AppDataSource.getRepository(Booth);

  getProducts = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const qb = this.products
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.vendor', 'vendor')
      .leftJoinAndSelect('product.category', 'category')
      .where('product.status = :status', { status: ProductStatus.APPROVED })
      .orderBy('product.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    if (typeof req.query.categoryId === 'string') {
      qb.andWhere('product.categoryId = :categoryId', { categoryId: req.query.categoryId });
    }
    if (typeof req.query.vendorId === 'string') {
      qb.andWhere('product.vendorId = :vendorId', { vendorId: req.query.vendorId });
    }
    if (typeof req.query.q === 'string') {
      qb.andWhere('(product.title ILIKE :q OR product.description ILIKE :q)', { q: `%${req.query.q}%` });
    }
    if (typeof req.query.minPrice === 'string') {
      qb.andWhere('product.sellingPrice >= :minPrice', { minPrice: Number(req.query.minPrice) });
    }
    if (typeof req.query.maxPrice === 'string') {
      qb.andWhere('product.sellingPrice <= :maxPrice', { maxPrice: Number(req.query.maxPrice) });
    }

    const [data, total] = await qb.getManyAndCount();
    sendSuccess(res, paginated(data, total, page, limit));
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

  getVendors = async (req: Request, res: Response) => {
    const { page, limit, skip } = getPagination(req.query);
    const [data, total] = await this.vendors.findAndCount({
      where: { isApproved: true, isActive: true },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
    sendSuccess(res, paginated(data, total, page, limit));
  };

  getVendor = async (req: Request, res: Response) => {
    sendSuccess(res, await this.vendors.findOne({
      where: { id: routeParam(req.params.id), isApproved: true, isActive: true },
      relations: { products: true },
    }));
  };

  homeFeed = async (_req: Request, res: Response) => {
    const [featuredProducts, vendors, categories, booths] = await Promise.all([
      this.products.find({ where: { status: ProductStatus.APPROVED }, relations: { vendor: true, category: true }, take: 12, order: { createdAt: 'DESC' } }),
      this.vendors.find({ where: { isApproved: true, isActive: true }, take: 8, order: { createdAt: 'DESC' } }),
      this.categories.find({ where: { isActive: true }, take: 12, order: { sortOrder: 'ASC', name: 'ASC' } }),
      this.booths.find({ where: { isActive: true }, take: 6, order: { createdAt: 'DESC' } }),
    ]);
    sendSuccess(res, { featuredProducts, vendors, categories, booths });
  };

  getNearbyBooths = async (_req: Request, res: Response) => {
    sendSuccess(res, await this.booths.find({ where: { isActive: true }, take: 20 }));
  };

  search = async (req: Request, res: Response) => {
    const q = String(req.query.q || req.query.query || '').trim();
    if (!q) return sendSuccess(res, { products: [], vendors: [] });

    const [products, vendors] = await Promise.all([
      this.products.find({
        where: { title: ILike(`%${q}%`), status: ProductStatus.APPROVED },
        take: 20,
      }),
      this.vendors.find({
        where: { businessName: ILike(`%${q}%`), isApproved: true },
        take: 20,
      }),
    ]);

    return sendSuccess(res, { products, vendors });
  };

  suggestions = async (req: Request, res: Response) => {
    const q = String(req.query.q || req.query.query || '').trim();
    if (!q) return sendSuccess(res, []);

    const products = await this.products.find({
      where: { title: ILike(`%${q}%`) },
      select: { id: true, title: true },
      take: 8,
    });
    return sendSuccess(res, products.map((product) => product.title));
  };
}
