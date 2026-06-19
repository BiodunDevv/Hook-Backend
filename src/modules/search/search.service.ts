import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Product } from '@modules/products/entities/product.entity';
import { Vendor } from '@modules/vendors/entities/vendor.entity';
import { ProductStatus } from '@common/constants';

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(Product) private productRepo: Repository<Product>,
    @InjectRepository(Vendor) private vendorRepo: Repository<Vendor>,
  ) {}

  async searchAll(query: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [products, total] = await this.productRepo.findAndCount({
      where: [
        { title: ILike(`%${query}%`), status: ProductStatus.APPROVED },
        { description: ILike(`%${query}%`), status: ProductStatus.APPROVED },
      ],
      relations: ['category', 'vendor'],
      skip,
      take: limit,
      order: { orderCount: 'DESC' },
    });

    const vendors = await this.vendorRepo.find({
      where: { businessName: ILike(`%${query}%`), isApproved: true },
    });

    return {
      products: { data: products, total, page, limit, totalPages: Math.ceil(total / limit) },
      vendors,
      suggestions: this.generateSuggestions(query),
    };
  }

  async searchSuggestions(query: string) {
    const products = await this.productRepo.find({
      where: { title: ILike(`%${query}%`), status: ProductStatus.APPROVED },
      select: ['title', 'slug'],
      take: 8,
    });
    return products.map(p => ({ label: p.title, value: p.slug }));
  }

  private generateSuggestions(query: string): string[] {
    const suggestions = ['Sneakers', 'Bags', 'Shirts', 'Dresses', 'Accessories', 'Native wear', 'Corporate casual'];
    return suggestions.filter(s => s.toLowerCase().includes(query.toLowerCase())).slice(0, 5);
  }
}
