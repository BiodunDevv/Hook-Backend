import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@models/base.model';

@Entity('admin_audit_logs')
@Index(['action', 'createdAt'])
@Index(['performedBy'])
@Index(['resourceType', 'resourceId'])
export class AdminAuditLog extends BaseEntity {
  @Column({ type: 'varchar', length: 50 })
  action!: string; // 'financial.view', 'settlement.trigger', 'settlement.view'

  @Column({ type: 'varchar', length: 50 })
  resourceType!: string; // 'financials', 'settlement'

  @Column({ type: 'varchar', length: 100, nullable: true })
  resourceId?: string;

  @Column({ type: 'varchar', length: 100 })
  performedBy!: string; // admin user ID

  @Column({ type: 'varchar', length: 255, nullable: true })
  performedByEmail?: string;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress?: string;

  @Column({ type: 'text', nullable: true })
  details?: string; // JSON string of contextual data

  @Column({ type: 'varchar', length: 50, nullable: true })
  status?: string; // 'success', 'failure', 'denied'

  @Column({ type: 'text', nullable: true })
  metadata?: string;
}
