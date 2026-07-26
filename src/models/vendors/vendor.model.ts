import { VendorTier } from '@lib/constants';
import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface Vendor extends BaseEntity {
  businessName: string;
  businessEmail?: string;
  businessPhone?: string;
  businessAddress?: string;
  description?: string;
  imageUrl?: string;
  socialLinks?: Record<string, string>;
  tier: VendorTier;
  isApproved: boolean;
  approvedAt?: Date;
  commissionPercentage: number;
  paystackSubaccountCode?: string;
  nombaMerchantId?: string;
  bankDetails?: { bankName: string; accountNumber: string; accountName: string; bankCode: string };
  stateCode?: string;
  stateName?: string;
  imsType?: string;
  imsConfig?: Record<string, unknown>;
  isActive: boolean;
  ownerId: string;
  owner?: any;
  products?: any[];
  settlements?: any[];
}

const VendorSchema = createSchema<Vendor>({
  businessName: { type: String, required: true, trim: true },
  businessEmail: { type: String, trim: true, lowercase: true },
  businessPhone: { type: String, trim: true },
  businessAddress: { type: String },
  description: { type: String },
  imageUrl: { type: String },
  socialLinks: { type: Object },
  tier: { type: String, enum: Object.values(VendorTier), default: VendorTier.TIER_3, index: true },
  isApproved: { type: Boolean, default: false, index: true },
  approvedAt: { type: Date },
  commissionPercentage: { type: Number, default: 15 },
  paystackSubaccountCode: { type: String },
  nombaMerchantId: { type: String },
  bankDetails: { type: Object },
  stateCode: { type: String, uppercase: true, trim: true, index: true },
  stateName: { type: String, trim: true },
  imsType: { type: String },
  imsConfig: { type: Object },
  isActive: { type: Boolean, default: true, index: true },
  ownerId: { type: String, required: true },
  deletedAt: { type: Date },
});

VendorSchema.index({ ownerId: 1 }, { unique: true });
VendorSchema.index({ isActive: 1, isApproved: 1 });
VendorSchema.index({ stateCode: 1, isActive: 1 });

export const Vendor = createModel<Vendor>('Vendor', VendorSchema);
