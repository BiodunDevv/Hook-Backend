import { BoothType } from '@lib/constants';
import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface Booth extends BaseEntity {
  name: string;
  description?: string;
  boothType: BoothType;
  location: { address: string; lat: number; lng: number; stateCode?: string; stateName?: string };
  operatingHours?: { weekday: { open: string; close: string }; weekend?: { open: string; close: string } };
  isActive: boolean;
  featuredProductIds: string[];
  previewImageUrl?: string;
  fieldAgentId?: string;
  attendantUserId?: string;
  fieldAgent?: any;
  qrTokenHash?: string;
  qrPublicId?: string;
  qrRotatedAt?: Date;
  qrVersion: number;
  accessCodeDigest?: string;
  accessCodeVersion: number;
  accessCodeRotatedAt?: Date;
  lastCredentialRotationActorId?: string;
}

const BoothSchema = createSchema<Booth>({
  name: { type: String, required: true },
  description: { type: String },
  boothType: { type: String, enum: Object.values(BoothType), default: BoothType.PHYGITAL },
  location: { type: Object, required: true },
  operatingHours: { type: Object },
  isActive: { type: Boolean, default: true, index: true },
  featuredProductIds: [{ type: String }],
  previewImageUrl: { type: String },
  fieldAgentId: { type: String, index: true },
  attendantUserId: { type: String, index: true },
  qrTokenHash: { type: String, unique: true, sparse: true, select: false },
  qrPublicId: { type: String, unique: true, sparse: true, index: true },
  qrRotatedAt: { type: Date },
  qrVersion: { type: Number, default: 1 },
  accessCodeDigest: { type: String, unique: true, sparse: true, index: true, select: false },
  accessCodeVersion: { type: Number, default: 1 },
  accessCodeRotatedAt: { type: Date },
  lastCredentialRotationActorId: { type: String },
  deletedAt: { type: Date },
});

BoothSchema.index({ 'location.stateCode': 1, isActive: 1 });

export const Booth = createModel<Booth>('Booth', BoothSchema);
