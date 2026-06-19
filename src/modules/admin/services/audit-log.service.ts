import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminAuditLog } from '../entities/admin-audit-log.entity';

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectRepository(AdminAuditLog) private auditRepo: Repository<AdminAuditLog>,
  ) {}

  async log(params: {
    action: string;
    resourceType: string;
    resourceId?: string;
    performedBy: string;
    performedByEmail?: string;
    ipAddress?: string;
    details?: Record<string, any>;
    status?: 'success' | 'failure' | 'denied';
  }): Promise<void> {
    try {
      const entry = this.auditRepo.create({
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        performedBy: params.performedBy,
        performedByEmail: params.performedByEmail,
        ipAddress: params.ipAddress,
        details: params.details ? JSON.stringify(params.details) : undefined,
        status: params.status || 'success',
      });
      await this.auditRepo.save(entry);
    } catch (error) {
      // Don't let audit logging failure break the main operation
      this.logger.error(`Failed to write audit log: ${(error as Error).message}`);
    }
  }

  async getAuditTrail(
    resourceType?: string,
    action?: string,
    page = 1,
    limit = 50,
  ) {
    const where: any = {};
    if (resourceType) where.resourceType = resourceType;
    if (action) where.action = action;

    const [data, total] = await this.auditRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: data.map((entry) => ({
        id: entry.id,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        performedBy: entry.performedBy,
        performedByEmail: entry.performedByEmail,
        ipAddress: entry.ipAddress,
        status: entry.status,
        timestamp: entry.createdAt,
        details: entry.details ? JSON.parse(entry.details) : null,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
