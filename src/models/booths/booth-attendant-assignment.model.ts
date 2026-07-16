import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface BoothAttendantAssignment extends BaseEntity {
  boothId: string;
  attendantUserId: string;
  attendantName: string;
  attendantEmail: string;
  attendantPhone: string;
  assignedAt: Date;
  releasedAt?: Date;
  assignedBy: string;
  releasedBy?: string;
}

const schema = createSchema<BoothAttendantAssignment>({
  boothId: { type: String, required: true, index: true },
  attendantUserId: { type: String, required: true, index: true },
  attendantName: { type: String, required: true },
  attendantEmail: { type: String, required: true, lowercase: true, trim: true },
  attendantPhone: { type: String, required: true },
  assignedAt: { type: Date, required: true, default: Date.now },
  releasedAt: { type: Date },
  assignedBy: { type: String, required: true },
  releasedBy: { type: String },
  deletedAt: { type: Date },
});
schema.index({ boothId: 1, releasedAt: 1 });
export const BoothAttendantAssignment = createModel<BoothAttendantAssignment>('BoothAttendantAssignment', schema);
