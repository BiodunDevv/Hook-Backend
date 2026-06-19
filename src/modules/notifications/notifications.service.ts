import { Injectable, Logger } from '@nestjs/common';
import { SendGridService } from '@integrations/sendgrid/sendgrid.service';
import { TermiiService } from '@integrations/termii/termii.service';

type NotificationChannel = 'email' | 'sms' | 'push';
type NotificationEvent =
  | 'order.confirmed'
  | 'order.shipped'
  | 'order.delivered'
  | 'auth.otp'
  | 'vendor.approved'
  | 'settlement.paid';

interface NotificationPayload {
  event: NotificationEvent;
  channel: NotificationChannel[];
  to: string; // email or phone
  data: Record<string, string>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private sendGridService: SendGridService,
    private termiiService: TermiiService,
  ) {}

  async send(payload: NotificationPayload) {
    const results: any[] = [];

    for (const channel of payload.channel) {
      try {
        if (channel === 'email') {
          const result = await this.sendGridService.sendTemplate(
            this.mapEventToTemplate(payload.event),
            payload.to,
            payload.data,
          );
          results.push({ channel: 'email', ...result });
        } else if (channel === 'sms') {
          const result = await this.termiiService.sendSms(
            payload.to,
            this.buildSmsMessage(payload.event, payload.data),
          );
          results.push({ channel: 'sms', ...result });
        }
      } catch (err: any) {
        this.logger.error(`Notification error [${channel}]: ${err.message}`);
        results.push({ channel, error: err.message });
      }
    }

    return results;
  }

  async sendOrderConfirmation(email: string, phone: string, orderCode: string) {
    return this.send({
      event: 'order.confirmed',
      channel: ['email', 'sms'],
      to: email,
      data: { orderCode },
    });
  }

  async sendDeliveryUpdate(email: string, orderCode: string, driverName: string) {
    return this.send({
      event: 'order.shipped',
      channel: ['email'],
      to: email,
      data: { orderCode, driverName },
    });
  }

  async sendOtp(email: string, code: string, channel: 'email' | 'sms' = 'email') {
    return this.send({
      event: 'auth.otp',
      channel: [channel],
      to: email,
      data: { code },
    });
  }

  private mapEventToTemplate(event: NotificationEvent): any {
    const map: Record<NotificationEvent, string> = {
      'order.confirmed': 'order_confirmed',
      'order.shipped': 'order_shipped',
      'order.delivered': 'order_delivered',
      'auth.otp': 'otp',
      'vendor.approved': 'welcome',
      'settlement.paid': 'welcome',
    };
    return map[event] || 'welcome';
  }

  private buildSmsMessage(event: NotificationEvent, data: Record<string, string>): string {
    const messages: Record<string, string> = {
      'order.confirmed': `Hook: Order ${data.orderCode} confirmed! We'll notify you when it ships.`,
      'order.shipped': `Hook: ${data.orderCode} is out for delivery by ${data.driverName || 'your driver'}!`,
      'order.delivered': `Hook: ${data.orderCode} delivered! Enjoy 🎉`,
      'auth.otp': `Hook code: ${data.code}. Valid 10 min.`,
    };
    return messages[event] || 'Notification from Hook';
  }
}
