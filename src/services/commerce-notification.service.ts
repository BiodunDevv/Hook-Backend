import { Notification } from "@models/notifications/notification.model";
import { publishRealtime } from "@services/realtime.service";
import { sendPushToUser } from "@services/push.service";

export async function createCommerceNotification(input: {
  eventKey: string;
  userId: string;
  title: string;
  body: string;
  type: string;
  data?: Record<string, unknown>;
}) {
  const result = await Notification.findOneAndUpdate(
    { eventKey: input.eventKey },
    { $setOnInsert: { ...input, isRead: false } },
    { upsert: true, returnDocument: "after", includeResultMetadata: true },
  );
  publishRealtime({ type: "notification.created", entityId: input.eventKey, version: 1 }, { accountId: input.userId });
  // Push only when this call created the notification. Callers run inside
  // at-least-once outbox consumers, so a replay must not buzz the phone again.
  if (!result.lastErrorObject?.updatedExisting) {
    void sendPushToUser(input.userId, {
      title: input.title,
      body: input.body,
      data: { type: input.type, ...(input.data || {}) },
    }).catch(() => undefined);
  }
  return result.value;
}
