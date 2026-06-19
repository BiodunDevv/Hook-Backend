import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booth } from '@modules/booths/entities/booth.entity';

@Injectable()
export class BoothsAdminService {
  private readonly logger = new Logger(BoothsAdminService.name);

  constructor(
    @InjectRepository(Booth) private boothRepo: Repository<Booth>,
  ) {}

  async getBooths(page = 1, limit = 20) {
    const [data, total] = await this.boothRepo.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getAnalytics() {
    const total = await this.boothRepo.count();
    const active = await this.boothRepo.count({ where: { isActive: true } });
    return { total, active, inactive: total - active };
  }

  async getBooth(id: string) {
    const booth = await this.boothRepo.findOne({ where: { id } });
    if (!booth) throw new NotFoundException('Booth not found');
    return booth;
  }

  async toggleStatus(id: string) {
    const booth = await this.boothRepo.findOne({ where: { id } });
    if (!booth) throw new NotFoundException('Booth not found');
    booth.isActive = !booth.isActive;
    await this.boothRepo.save(booth);
    return { id: booth.id, isActive: booth.isActive };
  }

  async createBooth(dto: { name: string; location: any }) {
    const booth = this.boothRepo.create(dto);
    return this.boothRepo.save(booth);
  }
}
