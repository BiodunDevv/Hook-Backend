import { BaseEntity, createModel, createSchema } from '@models/base.model';

/**
 * A pre-launch signup. `pendingCreditMinor` is set when an admin gifts the
 * waitlist before this email has an account yet — CreditService.grantWaitlistBonus
 * picks it up the moment that email actually signs up. `redeemedByUserId` /
 * `creditGrantedAt` track whichever happens first: the account existing, or
 * the credit landing.
 */
export interface WaitlistEntry extends BaseEntity {
  publicId: string;
  email: string;
  name: string;
  pendingCreditMinor?: number;
  giftReason?: string;
  redeemedByUserId?: string;
  redeemedAt?: Date;
  creditGrantedAt?: Date;
  /** When they ticked the marketing-consent checkbox at signup — required to join at all. */
  consentedAt: Date;
  /** A one-click-unsubscribe secret, distinct from publicId (which is sequential and guessable). */
  unsubscribeToken: string;
  unsubscribedAt?: Date;
}

const schema = createSchema<WaitlistEntry>({
  publicId: { type: String, required: true, unique: true, index: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  pendingCreditMinor: { type: Number, min: 0 },
  giftReason: { type: String, maxlength: 300 },
  redeemedByUserId: { type: String, index: true },
  redeemedAt: { type: Date },
  creditGrantedAt: { type: Date },
  consentedAt: { type: Date, required: true },
  unsubscribeToken: { type: String, required: true, unique: true, index: true },
  unsubscribedAt: { type: Date },
  deletedAt: { type: Date },
});

export const WaitlistEntry = createModel<WaitlistEntry>('WaitlistEntry', schema);
