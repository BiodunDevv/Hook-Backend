import { Notification } from "@models/notifications/notification.model";

export async function createCommerceNotification(input: {
  eventKey: string;
  userId: string;
  title: string;
  body: string;
  type: string;
  data?: Record<string, unknown>;
}) {
  return Notification.findOneAndUpdate(
    { eventKey: input.eventKey },
    { $setOnInsert: { ...input, isRead: false } },
    { upsert: true, returnDocument: "after" },
  );
}
