import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Settlement } from './entities/settlement.entity';
import { SettlementStatus, ESCROW_HOLD_HOURS } from '@common/constants';

@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    @InjectRepository(Settlement) private settlementRepo: Repository<Settlement>,
  ) {}

  async create(dto: Partial<Settlement>) {
    const settlement = this.settlementRepo.create(dto);
    return this.settlementRepo.save(settlement);
  }

  async findByVendor(vendorId: string) {
    return this.settlementRepo.find({
      where: { vendorId },
      order: { createdAt: 'DESC' },
    });
  }

  async getSummary(vendorId: string) {
    const settlements = await this.settlementRepo.find({ where: { vendorId } });
    return {
      pending: settlements.filter(s => s.status === SettlementStatus.PENDING_ESCROW).reduce((sum, s) => sum + s.netAmount, 0),
      cleared: settlements.filter(s => s.status === SettlementStatus.CLEARED).reduce((sum, s) => sum + s.netAmount, 0),
      paid: settlements.filter(s => s.status === SettlementStatus.PAID).reduce((sum, s) => sum + s.netAmount, 0),
      total: settlements.reduce((sum, s) => sum + s.netAmount, 0),
    };
  }

  // Cron: release escrow for settlements past 24h
  @Cron(CronExpression.EVERY_HOUR)
  async releaseEscrow() {
    const cutoff = new Date(Date.now() - ESCROW_HOLD_HOURS * 60 * 60 * 1000);
    const result = await this.settlementRepo.update(
      { status: SettlementStatus.PENDING_ESCROW, escrowReleaseAt: LessThan(cutoff) },
      { status: SettlementStatus.CLEARED, escrowReleasedAt: new Date() },
    );
    if (result.affected && result.affected > 0) {
      this.logger.log(`Released ${result.affected} settlements from escrow`);
    }
  }
}
