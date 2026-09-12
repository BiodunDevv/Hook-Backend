import { AccountType, ScopeType } from '@lib/constants';
import { User } from '@models/users/user.model';
import { Negotiation } from '@models/negotiations/negotiation.model';
import { Product } from '@models/products/product.model';
import { Market } from '@models/platform/network.model';
import { resolveAccessContext, type AccessContext } from './access-control.service';
import { createCommerceNotification } from './commerce-notification.service';

export function canReceiveNegotiationAlert(access: AccessContext, stateId?: string, hubId?: string) {
  if (!access.roleKeys.includes('SUPER_ADMIN') && !access.permissions.includes('ai_negotiation.view')) return false;
  if (access.scopeType === ScopeType.GLOBAL) return true;
  if (!stateId || !access.stateIds.includes(stateId)) return false;
  return access.scopeType !== ScopeType.HUB || Boolean(hubId && access.hubIds.includes(hubId));
}
let processing = false;
/** The pending bit is a durable session outbox, set atomically at creation.
 * Per-recipient unique event keys make partial batch delivery safe to replay. */
export async function deliverNegotiationStartNotifications() {
  if (processing) return;
  processing = true;
  try {
    const sessions = await Negotiation.find({ startNotificationPending: true }).sort({ createdAt: 1 }).limit(20).lean();
    if (!sessions.length) return;
    const admins = await User.find({ accountType: AccountType.STAFF }).select('_id').lean();
    for (const session of sessions) {
      try {
        const product = await Product.findById(session.productId).select('title marketId sourceStateId').lean();
        const market = product?.marketId ? await Market.findOne({ $or: [{ publicId: product.marketId }, ...(/^[a-f\d]{24}$/i.test(product.marketId) ? [{ _id: product.marketId }] : [])] }).select('name stateId hubId').lean() : null;
        for (const admin of admins) {
          let access: AccessContext;
          try { access = await resolveAccessContext(admin._id.toString()); } catch { continue; }
          if (!canReceiveNegotiationAlert(access, session.sourceStateId || product?.sourceStateId || market?.stateId, market?.hubId)) continue;
          await createCommerceNotification({
            eventKey: `negotiation:${session.publicId}:started:${admin._id}`, userId: admin._id.toString(),
            title: 'New negotiation started', body: `${product?.title || 'Product'}${market?.name ? ` · ${market.name}` : ''} · ${session.status}`,
            type: 'negotiation_started', data: { negotiationId: session.publicId, href: `/dashboard/ai-negotiation/${session.publicId}` },
          });
        }
        await Negotiation.updateOne({ _id: session._id, startNotificationPending: true }, { $set: { startNotificationPending: false } });
      } catch { console.warn(JSON.stringify({ event: 'negotiation.notification_delivery_failed', negotiationId: session.publicId })); }
    }
  } finally { processing = false; }
}
