import { Request } from 'express';
import { AppDataSource } from '@config/data-source';
import { AdminAuditLog } from '@models/admin/admin-audit-log.model';

export async function auditAdminAction(
  req: Request,
  action: string,
  resourceType: string,
  resourceId?: string,
  metadata?: Record<string, unknown>,
) {
  if (!req.user) return;
  try {
    await AppDataSource.getRepository(AdminAuditLog).save(AppDataSource.getRepository(AdminAuditLog).create({
      action,
      resourceType,
      resourceId,
      performedBy: req.user.sub,
      performedByEmail: req.user.email,
      ipAddress: req.ip,
      status: 'success',
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    } as any));
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') console.error('Audit log failed', error);
  }
}
