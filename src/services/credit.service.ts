import { CommerceSettings } from '@models/commerce/commerce.model';
import { CreditLedger, type CreditEntryType } from '@models/promotions/credit-ledger.model';
import { HttpError } from '@utils/http';

const DEFAULT_SPEND_CAP_PERCENT = 20;
const DEFAULT_WELCOME_BONUS_MINOR = 30000;

export class CreditService {
  /** Balance is always derived from the ledger, never stored. */
  async balance(userId: string) {
    const [row] = await CreditLedger.aggregate<{ total: number }>([
      { $match: { userId, deletedAt: { $exists: false } } },
      { $group: { _id: null, total: { $sum: '$amountMinor' } } },
    ]);
    return Math.max(0, Number(row?.total || 0));
  }

  /**
   * Every new customer starts with a credit balance. Keyed on the user id, so
   * the four different account-creation paths (password signup, Google, Apple,
   * legacy OTP) can all call this without risking a double grant.
   */
  async grantWelcomeBonus(userId: string) {
    // Guard on the entry TYPE rather than only the idempotency key: the
    // backfill script credits existing accounts under its own key, so a
    // key-only check would pay those users a second time the first time they
    // pass through a signup path.
    const existing = await CreditLedger.exists({ userId, type: 'welcome_bonus' });
    if (existing) return undefined;

    const settings = await CommerceSettings.findOne({ key: 'commerce' })
      .select('welcomeBonusMinor')
      .lean();
    const amountMinor = Number(settings?.welcomeBonusMinor ?? DEFAULT_WELCOME_BONUS_MINOR);
    if (amountMinor <= 0) return undefined;
    return this.record({
      userId,
      type: 'welcome_bonus',
      amountMinor,
      idempotencyKey: `welcome:${userId}`,
      note: 'Welcome to Hook',
    });
  }

  async spendCapPercent() {
    const settings = await CommerceSettings.findOne({ key: 'commerce' })
      .select('creditSpendCapPercent')
      .lean();
    const percent = Number(settings?.creditSpendCapPercent ?? DEFAULT_SPEND_CAP_PERCENT);
    return Math.min(Math.max(percent, 0), 100);
  }

  /**
   * How much of this order credits may cover: the balance, capped at a share
   * of the subtotal so a large balance cannot wipe out a small order.
   */
  async spendableFor(userId: string, subtotalMinor: number) {
    const [balance, percent] = await Promise.all([this.balance(userId), this.spendCapPercent()]);
    const cap = Math.floor((subtotalMinor * percent) / 100);
    return Math.max(0, Math.min(balance, cap));
  }

  async history(userId: string, limit = 50) {
    return CreditLedger.find({ userId, deletedAt: { $exists: false } })
      .select('type amountMinor orderId referralId note createdAt')
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 200))
      .lean({ virtuals: true });
  }

  /**
   * Writes one ledger entry. The unique idempotencyKey is what makes a retried
   * webhook or a replayed checkout confirm safe — a duplicate write is
   * swallowed rather than double-crediting.
   */
  async record(input: {
    userId: string;
    type: CreditEntryType;
    amountMinor: number;
    idempotencyKey: string;
    orderId?: string;
    referralId?: string;
    actorId?: string;
    note?: string;
  }) {
    try {
      return await CreditLedger.create(input);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        return CreditLedger.findOne({ idempotencyKey: input.idempotencyKey }).lean({ virtuals: true });
      }
      throw error;
    }
  }

  async spend(input: { userId: string; amountMinor: number; orderId: string; idempotencyKey: string }) {
    if (input.amountMinor <= 0) return undefined;
    const balance = await this.balance(input.userId);
    if (balance < input.amountMinor) {
      throw new HttpError(409, 'Your Hook Credits balance changed. Review checkout again.', undefined, 'CREDIT_BALANCE_CHANGED');
    }
    return this.record({
      userId: input.userId,
      type: 'order_spend',
      amountMinor: -Math.abs(input.amountMinor),
      orderId: input.orderId,
      idempotencyKey: `spend:${input.idempotencyKey}`,
      note: 'Applied to order',
    });
  }

  /** Returns credits when an order they paid for is cancelled. */
  async refund(input: { userId: string; amountMinor: number; orderId: string }) {
    if (input.amountMinor <= 0) return undefined;
    return this.record({
      userId: input.userId,
      type: 'order_refund',
      amountMinor: Math.abs(input.amountMinor),
      orderId: input.orderId,
      idempotencyKey: `refund:${input.orderId}`,
      note: 'Returned from a cancelled order',
    });
  }
}
