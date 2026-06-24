import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, FindOptionsWhere } from 'typeorm';
import { Product } from './entities/product.entity';
import { CreateProductDto, UpdateProductDto, ProductFilterDto } from './dto/product.dto';
import { ProductStatus, UserRole } from '@common/constants';
import { PaginationQueryDto } from '@common/dto/pagination.dto';
import { paginated } from '@common/dto/api-response.dto';
import { generateHookId } from '@common/helpers';
import { JwtPayload } from '@common/interfaces';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(Product)
    private productRepo: Repository<Product>,
  ) {}

  async create(dto: CreateProductDto, user: JwtPayload) {
    const slug = dto.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const product = this.productRepo.create({
      ...dto,
      slug: `${slug}-${Date.now()}`,
      vendorId: user.sub,
      status: user.role === UserRole.ADMIN ? ProductStatus.APPROVED : ProductStatus.PENDING_APPROVAL,
    });
    return this.productRepo.save(product);
  }

  async findAll(filter: ProductFilterDto, pagination: PaginationQueryDto) {
    const where: FindOptionsWhere<Product> = {};

    if (filter.status) where.status = filter.status;
    if (filter.categoryId) where.categoryId = filter.categoryId;
    if (filter.vendorId) where.vendorId = filter.vendorId;
    if (filter.search) where.title = Like(`%${filter.search}%`);
    if (filter.minPrice || filter.maxPrice) {
      // Would use QueryBuilder for range queries
    }

    const [data, total] = await this.productRepo.findAndCount({
      where,
      relations: {
  category: true,
  vendor: true
},
      order: { [pagination.sortBy || 'createdAt']: pagination.sortOrder || 'DESC' },
      skip: ((pagination.page || 1) - 1) * (pagination.limit || 20),
      take: pagination.limit || 20,
    });

    return paginated({
      data,
      meta: {
        page: pagination.page || 1,
        limit: pagination.limit || 20,
        total,
        totalPages: Math.ceil(total / (pagination.limit || 20)),
        hasNext: (pagination.page || 1) * (pagination.limit || 20) < total,
        hasPrevious: (pagination.page || 1) > 1,
      },
    });
  }

  async findOne(id: string) {
    const product = await this.productRepo.findOne({
      where: { id },
      relations: {
  category: true,
  vendor: true
},
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
    const product = await this.findOne(id);
    Object.assign(product, dto);
    return this.productRepo.save(product);
  }

  async updateStatus(id: string, status: ProductStatus) {
    const product = await this.findOne(id);
    product.status = status;
    return this.productRepo.save(product);
  }

  async remove(id: string) {
    const product = await this.findOne(id);
    await this.productRepo.softRemove(product);
    return { deleted: true };
  }

  // Field agent: bulk create with Hook IDs
  async bulkCreateFromField(products: CreateProductDto[], market: string) {
    const saved: Product[] = [];
    let seq = await this.productRepo.count() + 1;

    for (const dto of products) {
      const slug = dto.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const product = this.productRepo.create({
        ...dto,
        slug: `${slug}-${Date.now()}-${seq}`,
        hookId: generateHookId(market, dto.title, seq),
        status: ProductStatus.PENDING_APPROVAL,
      });
      saved.push(await this.productRepo.save(product));
      seq++;
    }
    return saved;
  }
}
