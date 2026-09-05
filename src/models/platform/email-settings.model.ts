import { BaseEntity, createModel, createSchema } from '@models/base.model';

export interface EmailSettings extends BaseEntity {
  key: 'email';
  supportEmail?: string;
  hookOpsEmail?: string;
  brevoFromEmail?: string;
  brevoFromName?: string;
  appName?: string;
  appUrl?: string;
  updatedBy?: string;
}

const emailSettingsSchema = createSchema<EmailSettings>({
  key: { type: String, enum: ['email'], unique: true, default: 'email' },
  supportEmail: { type: String },
  hookOpsEmail: { type: String },
  brevoFromEmail: { type: String },
  brevoFromName: { type: String },
  appName: { type: String },
  appUrl: { type: String },
  updatedBy: { type: String },
});

export const EmailSettings = createModel<EmailSettings>('EmailSettings', emailSettingsSchema);
