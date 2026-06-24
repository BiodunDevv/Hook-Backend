import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '@modules/products/entities/product.entity';
import { ProductStatus } from '@common/constants';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(Product) private productRepo: Repository<Product>,
  ) {}

  async getProductsForReview(page = 1, limit = 20) {
    const [data, total] = await this.productRepo.findAndCount({
      where: { status: ProductStatus.PENDING_APPROVAL },
      relations: {
  vendor: true,
  category: true
},
      order: { createdAt: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit), queueSize: total };
  }

  async reviewProduct(productId: string, status: ProductStatus, note?: string, adjustedPrice?: number) {
    const product = await this.productRepo.findOne({ where: { id: productId }, relations: {
  vendor: true
} });
    if (!product) throw new NotFoundException('Product not found');
    product.status = status;
    if (adjustedPrice !== undefined) product.sellingPrice = adjustedPrice;
    await this.productRepo.save(product);
    this.logger.log(`Product ${product.title} ${status === ProductStatus.APPROVED ? 'approved' : 'rejected'}`);
    return product;
  }

  async getProductCatalog(page = 1, limit = 20, status?: ProductStatus, vendorId?: string) {
    const where: any = {};
    if (status) where.status = status;
    if (vendorId) where.vendorId = vendorId;

    const [data, total] = await this.productRepo.findAndCount({
      where,
      relations: {
  vendor: true,
  category: true
},
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
