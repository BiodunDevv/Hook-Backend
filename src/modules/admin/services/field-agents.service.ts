import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FieldAgent } from '@modules/field-agent/entities/field-agent.entity';

@Injectable()
export class FieldAgentsService {
  private readonly logger = new Logger(FieldAgentsService.name);

  constructor(
    @InjectRepository(FieldAgent) private fieldAgentRepo: Repository<FieldAgent>,
  ) {}

  async getFieldAgents(page = 1, limit = 20) {
    const [data, total] = await this.fieldAgentRepo.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getFieldAgent(id: string) {
    const agent = await this.fieldAgentRepo.findOne({
      where: { id },
    });
    if (!agent) throw new NotFoundException('Field agent not found');
    return agent;
  }

  async toggleAgentStatus(id: string) {
    const agent = await this.fieldAgentRepo.findOne({ where: { id } });
    if (!agent) throw new NotFoundException('Field agent not found');
    agent.isActive = !agent.isActive;
    await this.fieldAgentRepo.save(agent);
    return { id: agent.id, isActive: agent.isActive };
  }
}
