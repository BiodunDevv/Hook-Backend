import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface PublicIdCounter extends BaseEntity {
  prefix: string;
  year: number;
  sequence: number;
  repairedAt?: Date;
  repairedBy?: string;
}

const schema = createSchema<PublicIdCounter>({
  prefix: { type: String, required: true, uppercase: true, trim: true },
  year: { type: Number, required: true },
  sequence: { type: Number, required: true, default: 0, min: 0 },
  repairedAt: { type: Date },
  repairedBy: { type: String },
});

schema.index({ prefix: 1, year: 1 }, { unique: true });

export const PublicIdCounter = createModel<PublicIdCounter>('PublicIdCounter', schema);
