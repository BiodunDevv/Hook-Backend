import { ScopeType } from '@lib/constants';
import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface Permission extends BaseEntity {
  key: string;
  domain: string;
  description: string;
  isActive: boolean;
}

export interface Role extends BaseEntity {
  key: string;
  name: string;
  description: string;
  permissionKeys: string[];
  defaultScopeType: ScopeType;
  isSystem: boolean;
  isActive: boolean;
}

const permissionSchema = createSchema<Permission>({
  key: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
  domain: { type: String, required: true, trim: true, index: true },
  description: { type: String, required: true, trim: true },
  isActive: { type: Boolean, default: true, index: true },
});

const roleSchema = createSchema<Role>({
  key: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  permissionKeys: { type: [String], default: [] },
  defaultScopeType: { type: String, enum: Object.values(ScopeType), required: true },
  isSystem: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true, index: true },
});

export const Permission = createModel<Permission>('Permission', permissionSchema);
export const Role = createModel<Role>('Role', roleSchema);
