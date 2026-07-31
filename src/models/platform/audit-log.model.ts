import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface PlatformAuditLog extends BaseEntity {
  publicId: string;
  actorType: string;
  actorId: string;
  actorPublicId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  entityPublicId?: string;
  stateId?: string;
  hubId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

const schema = createSchema<PlatformAuditLog>({
  publicId: { type: String, required: true, unique: true, index: true },
  actorType: { type: String, required: true, index: true },
  actorId: { type: String, required: true, index: true },
  actorPublicId: { type: String, index: true },
  action: { type: String, required: true, index: true },
  entityType: { type: String, required: true, index: true },
  entityId: { type: String, index: true },
  entityPublicId: { type: String, index: true },
  stateId: { type: String, index: true },
  hubId: { type: String, index: true },
  before: { type: Object },
  after: { type: Object },
  reason: { type: String },
  requestId: { type: String, required: true, index: true },
  ipAddress: { type: String },
  userAgent: { type: String },
});

schema.index({ createdAt: -1, action: 1 });

// Audit records are immutable through application model methods.
schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'], function denyMutation() {
  throw new Error('Audit records are append-only');
});

export const PlatformAuditLog = createModel<PlatformAuditLog>('PlatformAuditLog', schema);
