import { UserRole } from '@lib/constants';
import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface User extends BaseEntity {
  email: string;
  phone?: string;
  password?: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  avatarUrl?: string;
  address?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
  permissions?: string[];
  assignedCategoryIds?: string[];
  isActive: boolean;
  lastLoginAt?: Date;
  refreshToken?: string;
}

const UserSchema = createSchema<User>({
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  phone: { type: String, sparse: true, trim: true },
  password: { type: String },
  firstName: { type: String, default: '' },
  lastName: { type: String, default: '' },
  role: { type: String, enum: Object.values(UserRole), default: UserRole.SHOPPER, index: true },
  isEmailVerified: { type: Boolean, default: false },
  isPhoneVerified: { type: Boolean, default: false },
  avatarUrl: { type: String },
  address: { type: Object },
  preferences: { type: Object },
  permissions: { type: [String], default: [] },
  assignedCategoryIds: { type: [String], default: [] },
  isActive: { type: Boolean, default: true, index: true },
  lastLoginAt: { type: Date },
  refreshToken: { type: String, index: true },
  deletedAt: { type: Date },
});

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ role: 1, isActive: 1 });

export const User = createModel<User>('User', UserSchema);
