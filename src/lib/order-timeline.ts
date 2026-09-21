import { Order } from '@models/orders/order.model';

/**
 * The single way to append an order timeline entry.
 *
 * Before this existed, 16 transition sites wrote the timeline inline using two
 * different idioms — `updateOne` + `$push` in the fulfilment service, and
 * whole-array reassignment on a loaded document in the payment/POD services —
 * and two different actor keys (`actor` vs `actorType`). The reader
 * (`timelineFor()`) only consumes `status` and `at`, so the divergence was
 * invisible, but it meant there was no single place to hang the per-step
 * customer email off.
 *
 * Both idioms remain necessary: a caller that already holds a hydrated
 * document and is about to `save()` it must not issue a competing write, so
 * `timelineEntry()` builds the entry for that case while `pushOrderTimeline()`
 * performs the write for callers that only have an id.
 */

export type TimelineActor = string | { accountId?: string; id?: string } | undefined;

function actorId(actor: TimelineActor) {
  if (!actor) return 'SYSTEM';
  if (typeof actor === 'string') return actor;
  return String(actor.accountId || actor.id || 'SYSTEM');
}

/** Builds an entry for callers that will persist the document themselves. */
export function timelineEntry(status: string, actor?: TimelineActor, extra?: Record<string, unknown>) {
  return { status: String(status).toUpperCase(), actor: actorId(actor), at: new Date(), ...(extra || {}) };
}

/**
 * Appends to a document already in memory, returning the new array. Use with
 * the reassignment idiom: `order.timeline = appendTimeline(order, ...)`.
 */
export function appendTimeline(order: { timeline?: Array<Record<string, unknown>> }, status: string, actor?: TimelineActor, extra?: Record<string, unknown>) {
  return [...(order.timeline || []), timelineEntry(status, actor, extra)];
}

/**
 * Writes the entry directly for callers holding only an order id. Returns the
 * entry so a caller can pass it to the notification/email side without
 * rebuilding it (and so the timestamps match exactly).
 */
export async function pushOrderTimeline(orderId: unknown, status: string, actor?: TimelineActor, extra?: Record<string, unknown>) {
  const entry = timelineEntry(status, actor, extra);
  await Order.updateOne({ _id: orderId }, { $push: { timeline: entry } });
  await notifyStatus(orderId, entry.status);
  return entry;
}

/**
 * Emails the customer about a transition. Imported lazily because the email
 * service reaches back into the order models, and a top-level import here
 * would close a require cycle through every service that writes a timeline.
 */
export async function notifyStatus(orderId: unknown, status: string) {
  await pushOrderStatus(orderId, status);
  try {
    const { sendOrderStatusEmail } = await import('@services/order-status-email.service');
    await sendOrderStatusEmail(orderId, status);
  } catch {
    // Fire-and-forget: a mail failure must never block a status transition.
  }
}

/** What the customer is told, by order or shipment status. Statuses not listed send no push. */
const STATUS_PUSH: Record<string, { type: string; key: string; title: string; body: string }> = {
  IN_FULFILMENT: { type: 'order_in_fulfilment', key: 'sourcing', title: "We're sourcing your order", body: 'Our team is collecting your items from the market now.' },
  READY_FOR_DISPATCH: { type: 'order_packed', key: 'packed', title: 'Your order is packed', body: 'It is sealed and ready for its courier.' },
  PICKED_UP: { type: 'order_shipped', key: 'shipped', title: 'Your order is on its way', body: 'The courier has collected your parcel.' },
  IN_TRANSIT: { type: 'order_shipped', key: 'shipped', title: 'Your order is on its way', body: 'Your parcel is moving to you.' },
  PARTIALLY_IN_TRANSIT: { type: 'order_shipped', key: 'shipped', title: 'Part of your order is on its way', body: 'The rest will follow.' },
  OUT_FOR_DELIVERY: { type: 'order_out_for_delivery', key: 'out-for-delivery', title: 'Out for delivery', body: 'Your parcel arrives today. Keep your phone close.' },
  DELIVERED: { type: 'order_delivered', key: 'delivered', title: 'Your order was delivered', body: 'Enjoy your purchase. Tell us how it went.' },
  ON_HOLD: { type: 'order_updated', key: 'on-hold', title: 'Your order is on hold', body: 'Open the order to see what we need from you.' },
  RETURN_IN_PROGRESS: { type: 'return_update', key: 'return', title: 'Your return is in progress', body: 'We will keep you updated.' },
  REFUNDED: { type: 'refund_processed', key: 'refunded', title: 'Your refund was issued', body: 'It is on its way back to you.' },
};

/**
 * The customer's phone hears about each meaningful status. The event key is
 * per order and per kind of update (all transit statuses share one), so a
 * status that repeats, or is reached by two code paths, never buzzes twice.
 */
async function pushOrderStatus(orderId: unknown, status: string) {
  const entry = STATUS_PUSH[status];
  if (!entry) return;
  try {
    const order = (await Order.findById(orderId).select('publicId userId').lean()) as { publicId?: string; userId?: string } | null;
    if (!order?.userId || !order.publicId) return;
    const { createCommerceNotification } = await import('@services/commerce-notification.service');
    await createCommerceNotification({
      // DELIVERED reuses the key the manual delivery path already writes.
      eventKey: `order:${order.publicId}:${entry.key}`,
      userId: order.userId,
      title: entry.title,
      body: entry.body,
      type: entry.type,
      data: { orderId: order.publicId },
    });
  } catch {
    // A push must never block a status transition.
  }
}
