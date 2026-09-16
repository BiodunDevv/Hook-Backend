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
  try {
    const { sendOrderStatusEmail } = await import('@services/order-status-email.service');
    await sendOrderStatusEmail(orderId, status);
  } catch {
    // Fire-and-forget: a mail failure must never block a status transition.
  }
}
