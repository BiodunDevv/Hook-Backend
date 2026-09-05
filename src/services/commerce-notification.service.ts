import { Notification } from "@models/notifications/notification.model";
import { publishRealtime } from "@services/realtime.service";

export async function createCommerceNotification(input: {
  eventKey: string;
  userId: string;
  title: string;
  body: string;
  type: string;
  data?: Record<string, unknown>;
}) {
  const notification = await Notification.findOneAndUpdate(
    { eventKey: input.eventKey },
    { $setOnInsert: { ...input, isRead: false } },
    { upsert: true, returnDocument: "after" },
  );
  publishRealtime({ type: "notification.created", entityId: input.eventKey, version: 1 }, { accountId: input.userId });
  return notification;
}
