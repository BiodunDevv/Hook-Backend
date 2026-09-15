import { Order } from '@models/orders/order.model';
import { CouponService } from '@services/coupon.service';
import { CreditService } from '@services/credit.service';

const coupons = new CouponService();
const credits = new CreditService();

/**
 * Gives back whatever a cancelled order consumed: Hook Coin returns to the
 * wallet, and the coupon redemption is released so the code can be used again
 * and stops counting against its total-usage limit.
 *
 * Called from every path that cancels an order. Both operations are
 * idempotent — the credit refund is keyed on the order id and the coupon
 * release only acts on redemptions still marked 'applied' — so cancelling
 * twice, or a retried call, never pays out twice.
 *
 * Never throws: a cancellation must still succeed even if restoring the
 * incentives fails, or the customer would be left unable to cancel at all.
 */
export async function restoreOrderIncentives(orderIdentifier: string) {
  try {
    const order = await Order.findOne({
      $or: [{ _id: orderIdentifier }, { publicId: orderIdentifier }, { orderCode: orderIdentifier }],
    })
      .select('_id publicId userId creditsAppliedMinor')
      .lean();
    if (!order) return { creditsReturnedMinor: 0, couponsReleased: 0 };

    const orderId = String(order._id);
    const creditsAppliedMinor = Number(order.creditsAppliedMinor || 0);

    if (creditsAppliedMinor > 0 && order.userId) {
      await credits.refund({
        userId: String(order.userId),
        amountMinor: creditsAppliedMinor,
        orderId,
      });
    }

    // Redemptions are stored against the order's _id at checkout time.
    const couponsReleased = await coupons.release(orderId);

    return { creditsReturnedMinor: creditsAppliedMinor, couponsReleased };
  } catch (error) {
    console.error('[order] restoring incentives failed', orderIdentifier, error);
    return { creditsReturnedMinor: 0, couponsReleased: 0 };
  }
}
