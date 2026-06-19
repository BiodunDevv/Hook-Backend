import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TermiiService {
  private readonly logger = new Logger(TermiiService.name);
  private readonly baseUrl = 'https://api.termii.com/v1';
  private readonly apiKey: string;
  private readonly senderId: string;

  constructor(private configService: ConfigService) {
    this.apiKey = configService.get<string>('TERMII_API_KEY') || '';
    this.senderId = configService.get<string>('TERMII_SENDER_ID') || 'HookNG';
  }

  async sendSms(to: string, message: string) {
    try {
      const res = await fetch(`${this.baseUrl}/sms/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.apiKey,
          to,
          from: this.senderId,
          sms: message,
          type: 'plain',
          channel: 'generic',
        }),
      });
      return res.json();
    } catch (err: any) {
      this.logger.error(`Termii SMS error: ${err.message}`);
    }
  }

  async sendOtp(phone: string, code: string) {
    return this.sendSms(phone, `Your Hook verification code is: ${code}. Valid for 10 minutes.`);
  }

  async sendDeliveryAlert(phone: string, orderCode: string, driverName: string) {
    return this.sendSms(
      phone,
      `Your Hook order ${orderCode} is out for delivery by ${driverName}. Track live in the app.`,
    );
  }
}
