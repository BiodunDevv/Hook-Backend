import { Coupon } from '@models/promotions/coupon.model';
import { CouponRedemption } from '@models/promotions/coupon-redemption.model';
import { nextPublicId } from '@services/public-id.service';
import { HttpError } from '@utils/http';

export type CouponContext = {
  userId: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
};

export type CouponResult = {
  couponId: string;
  code: string;
  type: 'percentage' | 'fixed' | 'free_delivery';
  discountMinor: number;
  /** free_delivery discounts the shipping line, not the item subtotal. */
  appliesToDelivery: boolean;
};

function identity(identifier: string) {
  return /^[a-f\d]{24}$/i.test(identifier)
    ? { $or: [{ _id: identifier }, { publicId: identifier }] }
    : { $or: [{ publicId: identifier }, { code: identifier.toUpperCase() }] };
}

export class CouponService {
  /**
   * Validates a code against this basket and returns what it is worth.
   * MongoRepository's identifierFields() does not know about `code`, so the
   * lookup here is an explicit query rather than a repo id resolve.
   */
  async validate(code: string, context: CouponContext): Promise<CouponResult> {
    const normalized = String(code || '').trim().toUpperCase();
    if (!normalized) throw new HttpError(400, 'Enter a coupon code', undefined, 'COUPON_INVALID');

    const coupon = await Coupon.findOne({ code: normalized, deletedAt: { $exists: false } }).lean({ virtuals: true });
    if (!coupon) throw new HttpError(404, 'That coupon code is not valid', undefined, 'COUPON_INVALID');
    if (coupon.status !== 'active') {
      throw new HttpError(409, 'That coupon is no longer active', undefined, 'COUPON_INACTIVE');
    }

    const now = new Date();
    if (coupon.startsAt && now < new Date(coupon.startsAt)) {
      throw new HttpError(409, 'That coupon is not available yet', undefined, 'COUPON_NOT_STARTED');
    }
    if (coupon.endsAt && now > new Date(coupon.endsAt)) {
      throw new HttpError(409, 'That coupon has expired', undefined, 'COUPON_EXPIRED');
    }
    if (coupon.minSubtotalMinor && context.subtotalMinor < coupon.minSubtotalMinor) {
      throw new HttpError(
        409,
        `Spend at least ${(coupon.minSubtotalMinor / 100).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 })} to use this coupon`,
        undefined,
        'COUPON_MINIMUM_NOT_MET',
      );
    }
    if (coupon.totalUsageLimit && Number(coupon.usedCount || 0) >= coupon.totalUsageLimit) {
      throw new HttpError(409, 'That coupon has been fully claimed', undefined, 'COUPON_EXHAUSTED');
    }

    const usedByUser = await CouponRedemption.countDocuments({
      couponId: String(coupon._id),
      userId: context.userId,
      status: 'applied',
    });
    if (usedByUser >= Number(coupon.perUserLimit || 1)) {
      throw new HttpError(409, 'You have already used this coupon', undefined, 'COUPON_ALREADY_USED');
    }

    const appliesToDelivery = coupon.type === 'free_delivery';
    let discountMinor: number;
    if (coupon.type === 'percentage') {
      discountMinor = Math.round((context.subtotalMinor * Number(coupon.value)) / 100);
      if (coupon.maxDiscountMinor) discountMinor = Math.min(discountMinor, coupon.maxDiscountMinor);
      discountMinor = Math.min(discountMinor, context.subtotalMinor);
    } else if (coupon.type === 'fixed') {
      discountMinor = Math.min(Number(coupon.value), context.subtotalMinor);
    } else {
      discountMinor = context.deliveryFeeMinor;
    }

    return {
      couponId: String(coupon._id),
      code: coupon.code,
      type: coupon.type,
      discountMinor: Math.max(0, discountMinor),
      appliesToDelivery,
    };
  }

  /** Same as validate() but yields undefined instead of throwing. */
  async tryValidate(code: string | undefined, context: CouponContext) {
    if (!code) return undefined;
    return this.validate(code, context);
  }

  /**
   * Books the redemption at order-confirm time. The unique idempotencyKey
   * makes a replayed confirm a no-op rather than a second usage.
   */
  async redeem(input: {
    couponId: string;
    couponCode: string;
    userId: string;
    orderId: string;
    discountMinor: number;
    idempotencyKey: string;
  }) {
    try {
      const redemption = await CouponRedemption.create({
        publicId: await nextPublicId('couponRedemption'),
        couponId: input.couponId,
        couponCode: input.couponCode,
        userId: input.userId,
        orderId: input.orderId,
        discountMinor: input.discountMinor,
        status: 'applied',
        idempotencyKey: `coupon:${input.idempotencyKey}`,
      });
      await Coupon.updateOne({ _id: input.couponId }, { $inc: { usedCount: 1 } });
      return redemption;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        return CouponRedemption.findOne({ idempotencyKey: `coupon:${input.idempotencyKey}` }).lean({ virtuals: true });
      }
      throw error;
    }
  }

  /** Frees the usage back up when the order it was applied to is cancelled. */
  async release(orderId: string) {
    const redemptions = await CouponRedemption.find({ orderId, status: 'applied' }).lean();
    for (const redemption of redemptions) {
      const claimed = await CouponRedemption.findOneAndUpdate(
        { _id: redemption._id, status: 'applied' },
        { $set: { status: 'released', releasedAt: new Date() } },
      ).lean();
      if (claimed) await Coupon.updateOne({ _id: redemption.couponId }, { $inc: { usedCount: -1 } });
    }
    return redemptions.length;
  }

  async list() {
    return Coupon.find({ deletedAt: { $exists: false } }).sort({ createdAt: -1 }).lean({ virtuals: true });
  }

  async get(identifier: string) {
    const coupon = await Coupon.findOne({ ...identity(identifier), deletedAt: { $exists: false } }).lean({ virtuals: true });
    if (!coupon) throw new HttpError(404, 'Coupon not found', undefined, 'NOT_FOUND');
    return coupon;
  }

  async redemptions(identifier: string, options: { skip?: number; take?: number } = {}) {
    const coupon = await this.get(identifier);
    const filter = { couponId: String(coupon._id) };
    const [data, total] = await Promise.all([
      CouponRedemption.find(filter)
        .sort({ createdAt: -1 })
        .skip(options.skip || 0)
        .limit(options.take || 20)
        .lean({ virtuals: true }),
      CouponRedemption.countDocuments(filter),
    ]);
    return { data, total };
  }

  async create(input: Record<string, unknown>, actorId: string) {
    const code = String(input.code).trim().toUpperCase();
    const existing = await Coupon.findOne({ code, deletedAt: { $exists: false } }).lean();
    if (existing) throw new HttpError(409, `A coupon with code "${code}" already exists`, undefined, 'CONFLICT');
    return Coupon.create({
      ...input,
      code,
      publicId: await nextPublicId('coupon'),
      createdBy: actorId,
    });
  }

  async update(identifier: string, input: Record<string, unknown>) {
    const coupon = await this.get(identifier);
    if (input.code) {
      const code = String(input.code).trim().toUpperCase();
      const clash = await Coupon.findOne({ code, _id: { $ne: coupon._id }, deletedAt: { $exists: false } }).lean();
      if (clash) throw new HttpError(409, `A coupon with code "${code}" already exists`, undefined, 'CONFLICT');
      input.code = code;
    }
    return Coupon.findByIdAndUpdate(coupon._id, { $set: input }, { returnDocument: 'after' }).lean({ virtuals: true });
  }

  async remove(identifier: string) {
    const coupon = await this.get(identifier);
    await Coupon.updateOne({ _id: coupon._id }, { $set: { deletedAt: new Date() } });
    return { id: coupon.publicId || String(coupon._id), deleted: true };
  }
}
