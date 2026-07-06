import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface AdminAuditLog extends BaseEntity {
  action: string;
  resourceType: string;
  resourceId?: string;
  performedBy: string;
  performedByEmail?: string;
  ipAddress?: string;
  details?: string;
  status?: string;
  metadata?: string;
}

const AdminAuditLogSchema = createSchema<AdminAuditLog>({
  action: { type: String, required: true, index: true },
  resourceType: { type: String, required: true },
  resourceId: { type: String },
  performedBy: { type: String, required: true, index: true },
  performedByEmail: { type: String },
  ipAddress: { type: String },
  details: { type: String },
  status: { type: String },
  metadata: { type: String },
  deletedAt: { type: Date },
});

AdminAuditLogSchema.index({ resourceType: 1, resourceId: 1 });

export const AdminAuditLog = createModel<AdminAuditLog>('AdminAuditLog', AdminAuditLogSchema);
