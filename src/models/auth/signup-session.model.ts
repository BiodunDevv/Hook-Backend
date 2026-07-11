import { BaseEntity, createModel, createSchema } from '@models/base.model';

export type SignupStep = 'password_created' | 'email_verified' | 'profile_completed';

export interface SignupSession extends BaseEntity {
  email: string;
  passwordHash: string;
  sessionTokenHash: string;
  isEmailVerified: boolean;
  currentStep: SignupStep;
  guestId?: string;
  expiresAt: Date;
}

const SignupSessionSchema = createSchema<SignupSession>({
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true },
  sessionTokenHash: { type: String, required: true, unique: true, index: true },
  isEmailVerified: { type: Boolean, default: false },
  currentStep: { type: String, default: 'password_created' },
  guestId: { type: String, trim: true, index: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  deletedAt: { type: Date },
});

SignupSessionSchema.index({ email: 1, currentStep: 1 });

export const SignupSession = createModel<SignupSession>('SignupSession', SignupSessionSchema);
