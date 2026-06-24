import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './entities/category.entity';
import { JwtPayload } from '@common/interfaces';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private catRepo: Repository<Category>,
  ) {}

  async findAll() {
    return this.catRepo.find({
      where: { isActive: true },
      relations: {
  children: true
},
      order: { sortOrder: 'ASC' },
    });
  }

  async findOne(id: string) {
    const cat = await this.catRepo.findOne({
      where: { id },
      relations: {
  children: true,
  parent: true
},
    });
    if (!cat) throw new NotFoundException('Category not found');
    return cat;
  }

  async create(dto: { name: string; iconUrl?: string; parentId?: string; sortOrder?: number }) {
    const slug = dto.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const cat = this.catRepo.create({ ...dto, slug });
    return this.catRepo.save(cat);
  }

  async update(id: string, dto: Partial<Category>) {
    const cat = await this.findOne(id);
    Object.assign(cat, dto);
    return this.catRepo.save(cat);
  }

  async remove(id: string) {
    const cat = await this.findOne(id);
    await this.catRepo.softRemove(cat);
    return { deleted: true };
  }
}
