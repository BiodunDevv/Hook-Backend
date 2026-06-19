import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Negotiation } from '@modules/negotiation/entities/negotiation.entity';

@Injectable()
export class AINegotiationService {
  constructor(
    @InjectRepository(Negotiation) private negRepo: Repository<Negotiation>,
  ) {}

  async getNegotiations(page = 1, limit = 20) {
    const [data, total] = await this.negRepo.findAndCount({
      relations: ['user', 'product'],
      order: { updatedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const accepted = data.filter(n => n.status === 'accepted').length;
    const conversionRate = data.length > 0 ? (accepted / data.length) * 100 : 0;
    return { data, total, accepted, conversionRate: Math.round(conversionRate * 100) / 100, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
