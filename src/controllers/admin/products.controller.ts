import { Request, Response } from 'express';
import { ProductStatus } from '@lib/constants';
import { HttpError, sendSuccess } from '@utils/http';
import { adminRepos, getPagination, paginated, routeParam } from './admin.helpers';

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
    const qb = adminRepos.products()
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.vendor', 'vendor')
      .leftJoinAndSelect('product.category', 'category')
      .orderBy('product.createdAt', 'DESC')
      .skip(skip)
      .take(limit);
    if (typeof req.query.status === 'string') qb.andWhere('product.status = :status', { status: req.query.status });
    if (typeof req.query.vendorId === 'string') qb.andWhere('product.vendorId = :vendorId', { vendorId: req.query.vendorId });
    if (typeof req.query.search === 'string') qb.andWhere('product.title ILIKE :search', { search: `%${req.query.search}%` });
    const [data, total] = await qb.getManyAndCount();
    sendSuccess(res, paginated(data, total, page, limit));
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
}
