import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booth } from './entities/booth.entity';

@Injectable()
export class BoothsService {
  constructor(
    @InjectRepository(Booth) private boothRepo: Repository<Booth>,
  ) {}

  async create(dto: Partial<Booth>) {
    const booth = this.boothRepo.create(dto);
    return this.boothRepo.save(booth);
  }

  async findAllActive() {
    return this.boothRepo.find({ where: { isActive: true } });
  }

  async findOne(id: string) {
    const booth = await this.boothRepo.findOne({ where: { id } });
    if (!booth) throw new NotFoundException('Booth not found');
    return booth;
  }

  async findNearest(lat: number, lng: number, limit = 10) {
    // PostgreSQL earth distance — simplified for now
    return this.boothRepo.createQueryBuilder('booth')
      .where('booth.isActive = true')
      .orderBy('SQRT(POWER(booth.location->lat - :lat, 2) + POWER(booth.location->lng - :lng, 2))')
      .setParameters({ lat, lng })
      .limit(limit)
      .getMany();
  }

  async update(id: string, dto: Partial<Booth>) {
    const booth = await this.findOne(id);
    Object.assign(booth, dto);
    return this.boothRepo.save(booth);
  }

  async updateFeaturedProducts(id: string, productIds: string[]) {
    const booth = await this.findOne(id);
    booth.featuredProductIds = productIds;
    return this.boothRepo.save(booth);
  }
}
