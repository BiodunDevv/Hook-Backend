import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FieldAgent } from './entities/field-agent.entity';

@Injectable()
export class FieldAgentService {
  private readonly logger = new Logger(FieldAgentService.name);

  constructor(
    @InjectRepository(FieldAgent)
    private agentRepo: Repository<FieldAgent>,
  ) {}

  async assign(agentId: string, assignedMarket: string, coverageArea?: FieldAgent['coverageArea']) {
    const agent = this.agentRepo.create({ agentId, assignedMarket, coverageArea });
    return this.agentRepo.save(agent);
  }

  async findByAgent(agentId: string) {
    const agent = await this.agentRepo.findOne({ where: { agentId }, relations: {
  booths: true
} });
    if (!agent) throw new NotFoundException('Field agent record not found');
    return agent;
  }

  async updateStats(agentId: string, stats: Partial<FieldAgent['stats']>) {
    const agent = await this.findByAgent(agentId);
    agent.stats = { ...agent.stats, ...stats } as any;
    return this.agentRepo.save(agent);
  }

  async findAll() {
    return this.agentRepo.find({ relations: {
  agent: true,
  booths: true
} });
  }
}
